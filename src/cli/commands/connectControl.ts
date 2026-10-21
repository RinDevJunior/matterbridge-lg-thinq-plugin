import { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiError } from '../../errors/index.js';
import {
	ThinqConnectApiClient,
	type ThinqConnectPayload,
	type ThinqConnectResource,
} from '../../services/thinqConnect/thinqConnectApiClient.js';
import type { CliPatSession } from '../types.js';
import { type ConnectProbeSummary, formatConnectProbeSummary, summarizeConnectProbe } from './connectProbe.js';

export const CONNECT_CONTROL_ALLOWED_VALUES = ['POWER_ON', 'START'] as const;
export type ConnectControlValue = (typeof CONNECT_CONTROL_ALLOWED_VALUES)[number];

export interface ConnectControlOptions {
	deviceId?: string;
	send?: string;
	yes: boolean;
	waitSeconds: number;
}

const MAX_LOCATION_FIND_DEPTH = 6;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function isPlainObject(value: unknown): value is ThinqConnectResource {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findLocationName(root: unknown, depth = 0): string | undefined {
	if (depth > MAX_LOCATION_FIND_DEPTH) {
		return undefined;
	}
	if (isPlainObject(root)) {
		const location = root['location'];
		if (isPlainObject(location) && typeof location['locationName'] === 'string' && location['locationName'] !== '') {
			return location['locationName'];
		}
	}
	const children: unknown[] = Array.isArray(root) ? root : isPlainObject(root) ? Object.values(root) : [];
	for (const child of children) {
		const found = findLocationName(child, depth + 1);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function isConnectControlValue(value: string): value is ConnectControlValue {
	return (CONNECT_CONTROL_ALLOWED_VALUES as readonly string[]).includes(value);
}

export function parseConnectControlValue(raw: string | undefined): { value: ConnectControlValue } | { error: string } {
	if (raw === undefined || raw.trim() === '') {
		return { error: `Missing --send. Allowed: ${CONNECT_CONTROL_ALLOWED_VALUES.join(', ')}` };
	}
	const normalized = raw.trim().toUpperCase();
	if (isConnectControlValue(normalized)) {
		return { value: normalized };
	}
	if (normalized === 'STOP' || normalized === 'POWER_OFF') {
		return {
			error: `"${normalized}" is not enabled in this step. Allowed: ${CONNECT_CONTROL_ALLOWED_VALUES.join(', ')}`,
		};
	}
	return { error: `Unknown value "${raw}". Allowed: ${CONNECT_CONTROL_ALLOWED_VALUES.join(', ')}` };
}

export function buildConnectControlPayload(value: ConnectControlValue, locationName?: string): ThinqConnectResource {
	const operation = { washerOperationMode: value };
	return locationName === undefined ? { operation } : { location: { locationName }, operation };
}

export function evaluateConnectControlGuards(
	value: ConnectControlValue,
	summary: ConnectProbeSummary,
): string | undefined {
	const washerMode = summary.washerOperationMode;
	if (!washerMode) {
		return 'Profile has no washerOperationMode (not a washer, or not exposed).';
	}
	if (!washerMode.writable) {
		return 'washerOperationMode is not writable for this device.';
	}
	if (!washerMode.allowedValues.includes(value)) {
		const allowed = washerMode.allowedValues.length > 0 ? washerMode.allowedValues.join(', ') : 'none';
		return `Profile does not list "${value}" as writable (allowed: ${allowed}).`;
	}
	const currentState = summary.currentState;
	if (currentState === 'RUNNING' || currentState === 'PAUSE') {
		return `Washer is ${currentState}; refusing to interrupt a cycle.`;
	}
	return undefined;
}

export async function cmdConnectControl(
	session: CliPatSession,
	options: ConnectControlOptions,
	logger: AnsiLogger,
): Promise<void> {
	console.log(`Country: ${session.country}`);

	if (!options.deviceId) {
		console.error('Missing --device-id');
		process.exitCode = 1;
		return;
	}
	const deviceId = options.deviceId;

	const parsed = parseConnectControlValue(options.send);
	if ('error' in parsed) {
		console.error(parsed.error);
		process.exitCode = 1;
		return;
	}

	let client: ThinqConnectApiClient;
	try {
		client = new ThinqConnectApiClient(session.personalAccessToken, session.country, logger);
	} catch (error) {
		console.error('Control failed:', errorMessage(error));
		process.exitCode = 1;
		return;
	}

	// Sequential on purpose: ThinQ Connect rate-limits bursts (code 1306).
	let profile: ThinqConnectPayload;
	let state: ThinqConnectPayload;
	try {
		profile = await client.getDeviceProfile(deviceId);
		state = await client.getDeviceState(deviceId);
	} catch (error) {
		console.error(`Cannot read profile/state: ${errorMessage(error)}`);
		process.exitCode = 1;
		return;
	}

	const summary = summarizeConnectProbe(profile, state);
	console.log(`Device: ${deviceId}`);
	console.log('Before:');
	for (const line of formatConnectProbeSummary(summary)) {
		console.log(line);
	}

	const locationName = findLocationName(profile);
	if (locationName === undefined) {
		console.log('Location: no locationName in profile; sending without location.');
	}
	const payload = buildConnectControlPayload(parsed.value, locationName);

	console.log(`Request: POST /devices/${deviceId}/control  (x-conditional-control: true)`);
	console.log(`Body: ${JSON.stringify(payload)}`);

	const refusal = evaluateConnectControlGuards(parsed.value, summary);
	if (refusal) {
		console.log(`Refused: ${refusal}`);
		process.exitCode = 1;
		return;
	}

	if (!options.yes) {
		console.log('Dry run: nothing sent. Re-run with --yes to send.');
		return;
	}

	console.log('Sending...');
	try {
		const response = await client.controlDevice(deviceId, payload);
		console.log('Accepted by LG.');
		if (Object.keys(response).length > 0) {
			console.log(`Response: ${JSON.stringify(response)}`);
		}
	} catch (error) {
		console.log(`Control FAILED: ${errorMessage(error)}`);
		if (error instanceof ThinqConnectApiError) {
			const resultCode = error.metadata?.['resultCode'];
			if (typeof resultCode === 'string') {
				console.log(`LG result code: ${resultCode}`);
			}
		}
		process.exitCode = 1;
	}

	if (options.waitSeconds > 0) {
		await new Promise((resolve) => setTimeout(resolve, options.waitSeconds * 1000));
	}

	try {
		const afterState = await client.getDeviceState(deviceId);
		console.log('After:');
		for (const line of formatConnectProbeSummary(summarizeConnectProbe(profile, afterState))) {
			console.log(line);
		}
	} catch (error) {
		console.log(`After: state ERROR ${errorMessage(error)}`);
		process.exitCode = 1;
	}
}
