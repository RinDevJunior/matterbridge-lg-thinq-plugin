import { AnsiLogger } from 'matterbridge/logger';

import {
	ThinqConnectApiClient,
	type ThinqConnectDevice,
	type ThinqConnectResource,
} from '../../services/thinqConnect/thinqConnectApiClient.js';
import type { CliPatSession } from '../types.js';

export interface ConnectProbeOptions {
	deviceId?: string;
	raw: boolean;
}

export interface ConnectProbeSummary {
	profileGroups: string[];
	washerOperationMode?: { modes: string[]; writable: boolean; allowedValues: string[] };
	remoteControlEnabled?: { modes: string[] };
	currentOperationMode?: string;
	currentRemoteControlEnabled?: boolean;
	currentState?: string;
}

const MAX_FIND_DEPTH = 6;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function isPlainObject(value: unknown): value is ThinqConnectResource {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringItems(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function findKey(root: unknown, key: string, depth = 0): unknown {
	if (depth > MAX_FIND_DEPTH) {
		return undefined;
	}
	if (isPlainObject(root) && Object.hasOwn(root, key)) {
		return root[key];
	}
	const children: unknown[] = Array.isArray(root) ? root : isPlainObject(root) ? Object.values(root) : [];
	for (const child of children) {
		const found = findKey(child, key, depth + 1);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function profileGroupNames(profile: ThinqConnectResource | undefined): string[] {
	if (!profile) {
		return [];
	}
	const root: unknown = profile['property'] ?? profile;
	if (isPlainObject(root)) {
		return Object.keys(root);
	}
	if (Array.isArray(root)) {
		const keys = new Set<string>();
		for (const item of root) {
			if (isPlainObject(item)) {
				for (const key of Object.keys(item)) {
					keys.add(key);
				}
			}
		}
		return [...keys].sort();
	}
	return [];
}

export function summarizeConnectProbe(
	profile: ThinqConnectResource | undefined,
	state: ThinqConnectResource | undefined,
): ConnectProbeSummary {
	const summary: ConnectProbeSummary = { profileGroups: profileGroupNames(profile) };

	const washerNode = findKey(profile, 'washerOperationMode');
	if (isPlainObject(washerNode)) {
		const modes = stringItems(washerNode['mode']);
		const value = washerNode['value'];
		const allowedValues = isPlainObject(value) ? stringItems(value['w']) : [];
		summary.washerOperationMode = { modes, writable: modes.includes('w'), allowedValues };
	}

	const remoteNode = findKey(profile, 'remoteControlEnabled');
	if (isPlainObject(remoteNode)) {
		summary.remoteControlEnabled = { modes: stringItems(remoteNode['mode']) };
	}

	const currentOperationMode = findKey(state, 'washerOperationMode');
	if (typeof currentOperationMode === 'string') {
		summary.currentOperationMode = currentOperationMode;
	}
	const currentRemoteControlEnabled = findKey(state, 'remoteControlEnabled');
	if (typeof currentRemoteControlEnabled === 'boolean') {
		summary.currentRemoteControlEnabled = currentRemoteControlEnabled;
	}
	const currentState = findKey(state, 'currentState');
	if (typeof currentState === 'string') {
		summary.currentState = currentState;
	}

	return summary;
}

export function formatConnectProbeSummary(summary: ConnectProbeSummary): string[] {
	const lines: string[] = [];

	const groups = summary.profileGroups.length > 0 ? summary.profileGroups.join(', ') : '(none)';
	lines.push(`  resource groups: ${groups}`);

	if (summary.washerOperationMode) {
		const { modes, writable, allowedValues } = summary.washerOperationMode;
		const modesText = modes.length > 0 ? modes.join(',') : 'none';
		const allowedText = allowedValues.length > 0 ? allowedValues.join(', ') : 'none';
		lines.push(
			`  washerOperationMode: writable=${writable ? 'yes' : 'no'} (mode: ${modesText}) allowed=${allowedText}`,
		);
	} else {
		lines.push('  washerOperationMode: not in profile (not a washer, or not exposed)');
	}

	const currentRemote = summary.currentRemoteControlEnabled;
	if (summary.remoteControlEnabled) {
		const modesText =
			summary.remoteControlEnabled.modes.length > 0 ? summary.remoteControlEnabled.modes.join(',') : 'none';
		const currentText = currentRemote !== undefined ? ` current=${String(currentRemote)}` : '';
		lines.push(`  remoteControlEnabled: profile mode=${modesText}${currentText}`);
	} else if (currentRemote !== undefined) {
		lines.push(`  remoteControlEnabled: current=${String(currentRemote)}`);
	}

	if (summary.currentState !== undefined) {
		lines.push(`  currentState: ${summary.currentState}`);
	}
	if (summary.currentOperationMode !== undefined) {
		lines.push(`  current washerOperationMode: ${summary.currentOperationMode}`);
	}

	return lines;
}

export async function cmdConnectProbe(
	session: CliPatSession,
	options: ConnectProbeOptions,
	logger: AnsiLogger,
): Promise<void> {
	console.log(`Country: ${session.country}`);

	let client: ThinqConnectApiClient;
	try {
		client = new ThinqConnectApiClient(session.personalAccessToken, session.country, logger);
	} catch (error) {
		console.error('Probe failed:', errorMessage(error));
		process.exitCode = 1;
		return;
	}

	let targets: ThinqConnectDevice[];
	if (options.deviceId) {
		targets = [{ deviceId: options.deviceId }];
	} else {
		try {
			targets = await client.getDevices();
		} catch (error) {
			console.error('Probe failed:', errorMessage(error));
			process.exitCode = 1;
			return;
		}
	}

	if (targets.length === 0) {
		console.log('No devices visible for this token.');
		return;
	}

	// Sequential on purpose: ThinQ Connect rate-limits bursts (code 1306).
	for (const device of targets) {
		const info = device.deviceInfo;
		console.log(
			`Device: ${info?.alias ?? '(no alias)'} [${info?.deviceType ?? 'unknown'}] ${info?.modelName ?? ''} (${device.deviceId})`,
		);

		let profile: ThinqConnectResource | undefined;
		let state: ThinqConnectResource | undefined;
		try {
			profile = await client.getDeviceProfile(device.deviceId);
		} catch (error) {
			console.log(`  profile: ERROR ${errorMessage(error)}`);
			process.exitCode = 1;
		}
		try {
			state = await client.getDeviceState(device.deviceId);
		} catch (error) {
			console.log(`  state: ERROR ${errorMessage(error)}`);
			process.exitCode = 1;
		}

		if (profile === undefined && state === undefined) {
			continue;
		}

		for (const line of formatConnectProbeSummary(summarizeConnectProbe(profile, state))) {
			console.log(line);
		}
		if (options.raw) {
			if (profile !== undefined) {
				console.log(`  raw profile: ${JSON.stringify(profile, null, 2)}`);
			}
			if (state !== undefined) {
				console.log(`  raw state: ${JSON.stringify(state, null, 2)}`);
			}
		}
	}
}
