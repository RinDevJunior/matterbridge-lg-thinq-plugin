import { AnsiLogger } from 'matterbridge/logger';

import { type ThinqDevice, toThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import { getWasherModelOptionValues } from '../../platform/thinq/thinqWasherDownloadCommandResolver.js';
import type { CliSession } from '../types.js';
import {
	createWasherClient,
	findWasherTarget,
	formatWasherFieldLines,
	isRecord,
	maskDeviceId,
	readWasherFields,
} from './washerCommon.js';

const CONFIG_KEYS = [
	'defaultCourse',
	'courseType',
	'smartCourseType',
	'downloadedCourseType',
	'powerOffDownload',
	'cloudCourse',
	'autoRemoteStart',
	'maxDownloadCourseNum',
	'uniProtocol',
] as const;

export interface WasherStatusOptions {
	readonly deviceId: string | undefined;
	readonly model: boolean;
}

/** Builds `WasherStatusOptions` from the flat `parseArgs` record. Read-only; no send flags exist. */
export function parseWasherStatusOptions(args: Record<string, string>): WasherStatusOptions {
	const deviceArg = args.device;
	return {
		deviceId: deviceArg && deviceArg !== 'true' ? deviceArg : undefined,
		model: args.model === 'true',
	};
}

/**
 * Prints the model's `ControlWifi` templates (command + data), the relevant `Config` flags and the default
 * course's spin/temp options. Never prints `modelJsonUri` or any URL.
 */
export function formatWasherModelLines(model: Record<string, unknown>): string[] {
	const lines: string[] = [];

	const controlWifi = model.ControlWifi;
	lines.push('--- ControlWifi ---');
	if (isRecord(controlWifi)) {
		for (const [key, entry] of Object.entries(controlWifi)) {
			if (!isRecord(entry)) {
				continue;
			}
			lines.push(`${key}: command=${JSON.stringify(entry.command)} data=${JSON.stringify(entry.data)}`);
		}
	} else {
		lines.push('(no ControlWifi)');
	}

	const config: Record<string, unknown> = isRecord(model.Config) ? model.Config : {};
	lines.push('--- Config ---');
	for (const key of CONFIG_KEYS) {
		if (config[key] !== undefined) {
			lines.push(`${key} = ${JSON.stringify(config[key])}`);
		}
	}

	const defaultCourse = config.defaultCourse;
	if (typeof defaultCourse === 'string') {
		lines.push(`--- Default course (${defaultCourse}) options ---`);
		for (const key of ['spin', 'temp'] as const) {
			const values = getWasherModelOptionValues(model, defaultCourse, key);
			lines.push(`${key} selectable: ${values ? values.join(', ') : '(none)'}`);
		}
	}

	return lines;
}

export async function cmdWasherStatus(
	session: CliSession,
	options: WasherStatusOptions,
	logger: AnsiLogger,
): Promise<void> {
	const client = createWasherClient(session, logger);
	const devices: ThinqDevice[] = (await client.getListDevices()).map(toThinqDevice);

	const target = findWasherTarget(devices, options.deviceId);
	if (!target) {
		console.error(
			options.deviceId
				? `Device "${maskDeviceId(options.deviceId)}" was not found. Discovered device ids:`
				: 'No washer found. Discovered device ids:',
		);
		for (const device of devices) {
			console.log(`  ${maskDeviceId(device.id)}  type=${device.type}  name=${device.name}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log(
		`Device: ${target.name} (${maskDeviceId(target.id)}) type=${target.type} model=${target.modelName || 'unknown'}`,
	);
	for (const line of formatWasherFieldLines(readWasherFields(target))) {
		console.log(line);
	}

	if (!options.model) {
		return;
	}

	if (!target.modelJsonUri) {
		console.error('Device has no modelJsonUri; cannot read the model.');
		process.exitCode = 1;
		return;
	}

	const model = await client.getDeviceModel(target.modelJsonUri);
	for (const line of formatWasherModelLines(model)) {
		console.log(line);
	}
}
