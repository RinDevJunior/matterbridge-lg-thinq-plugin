import { AnsiLogger } from 'matterbridge/logger';

import { isAirConditionerDevice, type ThinqDevice, toThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import { ThinqSession } from '../../services/thinq/session.js';
import { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import type { CliSession } from '../types.js';

const ENERGY_KEY = 'airState.energy.onCurrent';
const OPERATION_KEY = 'airState.operation';
const KEEP_ALIVE_WAIT_MS = 2000;

export interface EnergyOptions {
	readonly deviceId: string | undefined;
	readonly samples: number;
	readonly intervalSeconds: number;
	readonly keepAlive: boolean;
}

function parsePositiveNumber(name: string, raw: string | undefined, fallback: number, integer: boolean): number {
	if (raw === undefined) {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
		throw new Error(`Invalid --${name} value "${raw}": expected a positive ${integer ? 'integer' : 'number'}.`);
	}
	return value;
}

/** Builds `EnergyOptions` from the flat `parseArgs` record. Throws on invalid numeric values. */
export function parseEnergyOptions(args: Record<string, string>): EnergyOptions {
	const deviceArg = args['device'];
	return {
		deviceId: deviceArg && deviceArg !== 'true' ? deviceArg : undefined,
		samples: parsePositiveNumber('samples', args['samples'], 1, true),
		intervalSeconds: parsePositiveNumber('interval', args['interval'], 5, false),
		keepAlive: args['keep-alive'] === 'true',
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(value: unknown): string {
	return `${JSON.stringify(value)} (typeof ${typeof value})`;
}

function listDeviceIds(devices: ThinqDevice[]): void {
	if (devices.length === 0) {
		console.log('  (no devices discovered)');
		return;
	}
	for (const device of devices) {
		console.log(`  ${device.id}  type=${device.type}  name=${device.name}`);
	}
}

function printSample(device: ThinqDevice, index: number, total: number): void {
	const { snapshot } = device;
	const raw = snapshot.raw;

	console.log(`--- Sample ${index}/${total} @ ${new Date().toISOString()} ---`);
	console.log(`online (device):        ${device.online}`);
	console.log(`online (snapshot):      ${describe(raw['online'])}`);
	console.log(`${OPERATION_KEY}: ${describe(raw[OPERATION_KEY])}  -> isPowerOn=${snapshot.isPowerOn}`);

	const keys = Object.keys(raw)
		.filter((key) => {
			const lower = key.toLowerCase();
			return lower.startsWith('airstate.energy.') || lower.includes('energy') || lower.includes('power');
		})
		.sort();

	console.log('Energy/power related keys:');
	if (keys.length === 0) {
		console.log('  (none found)');
	}
	for (const key of keys) {
		console.log(`  ${key} = ${describe(raw[key])}`);
	}

	console.log(`${ENERGY_KEY}:`);
	if (!(ENERGY_KEY in raw)) {
		console.log('  key is ABSENT from this snapshot');
	} else {
		console.log(`  raw value:                 ${describe(raw[ENERGY_KEY])}`);
	}

	const watts = snapshot.powerConsumptionWatts;
	if (watts === undefined) {
		console.log('  powerConsumptionWatts:     undefined (plugin would NOT write activePower)');
	} else {
		console.log(`  powerConsumptionWatts:     ${watts} W`);
		console.log(`  activePower the plugin writes: ${Math.round(watts * 1000)} mW`);
	}
	console.log('');
}

export async function cmdEnergy(session: CliSession, options: EnergyOptions, logger: AnsiLogger): Promise<void> {
	const { userData, country, language } = session;

	const thinqSession = new ThinqSession(userData.accessToken, userData.refreshToken, userData.expiresAtEpochSeconds);
	const apiClient = new ThinqApiClient(thinqSession, country, language, logger);
	if (userData.userNumber) {
		apiClient.setUserNumber(userData.userNumber);
	}

	const fetchDevices = async (): Promise<ThinqDevice[]> => (await apiClient.getListDevices()).map(toThinqDevice);

	let devices = await fetchDevices();

	const target = options.deviceId
		? devices.find((device) => device.id === options.deviceId)
		: devices.find(isAirConditionerDevice);

	if (!target) {
		console.error(
			options.deviceId
				? `Device "${options.deviceId}" was not found. Discovered device ids:`
				: 'No AC device found. Discovered device ids:',
		);
		listDeviceIds(devices);
		process.exitCode = 1;
		return;
	}

	if (!isAirConditionerDevice(target)) {
		console.warn(`Warning: device ${target.id} is type ${target.type}, not AC; continuing anyway.`);
	}

	console.log(`Device: ${target.name} (${target.id}) type=${target.type} model=${target.modelName || 'unknown'}`);
	console.log(
		`Samples: ${options.samples}, interval: ${options.intervalSeconds}s, keep-alive: ${options.keepAlive ? 'yes' : 'no'}\n`,
	);

	if (options.keepAlive) {
		await apiClient.sendKeepAlive(target.id);
		console.log(
			`Keep-alive sent (allEventEnable, airState.mon.timeout=70). Waiting ${KEEP_ALIVE_WAIT_MS / 1000}s...\n`,
		);
		await sleep(KEEP_ALIVE_WAIT_MS);
		devices = await fetchDevices();
	}

	for (let i = 1; i <= options.samples; i++) {
		if (i > 1) {
			await sleep(options.intervalSeconds * 1000);
			devices = await fetchDevices();
		}

		const current = devices.find((device) => device.id === target.id);
		if (!current) {
			console.error(`Sample ${i}/${options.samples}: device ${target.id} is missing from the device list.`);
			process.exitCode = 1;
			continue;
		}
		printSample(current, i, options.samples);
	}
}
