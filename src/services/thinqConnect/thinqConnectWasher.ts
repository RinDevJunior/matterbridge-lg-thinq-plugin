import type { ThinqConnectPayload, ThinqConnectResource } from './thinqConnectApiClient.js';

export type WasherPowerCommand = 'POWER_ON' | 'POWER_OFF';

export interface WasherOperationModeProfile {
	writable: boolean;
	allowedValues: string[];
}

const MAX_FIND_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringItems(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Depth-first search for the first value stored under `key`. */
function findKey(node: unknown, key: string, depth = 0): unknown {
	if (depth > MAX_FIND_DEPTH || typeof node !== 'object' || node === null) {
		return undefined;
	}
	if (!Array.isArray(node) && key in node) {
		return (node as Record<string, unknown>)[key];
	}
	for (const child of Array.isArray(node) ? node : Object.values(node)) {
		const found = findKey(child, key, depth + 1);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function locationNameOf(node: unknown): string | undefined {
	if (!isPlainObject(node) || !isPlainObject(node.location)) {
		return undefined;
	}
	const { locationName } = node.location;
	return typeof locationName === 'string' && locationName !== '' ? locationName : undefined;
}

function findLocationName(node: unknown, depth = 0): string | undefined {
	if (depth > MAX_FIND_DEPTH || typeof node !== 'object' || node === null) {
		return undefined;
	}
	const own = locationNameOf(node);
	if (own !== undefined) {
		return own;
	}
	for (const child of Array.isArray(node) ? node : Object.values(node)) {
		const found = findLocationName(child, depth + 1);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

export function findProfileLocationName(profile: ThinqConnectPayload | undefined): string | undefined {
	return findLocationName(profile);
}

export function readWasherOperationModeProfile(
	profile: ThinqConnectPayload | undefined,
): WasherOperationModeProfile | undefined {
	const node = findKey(profile, 'washerOperationMode');
	if (!isPlainObject(node)) {
		return undefined;
	}
	const value = isPlainObject(node.value) ? node.value : undefined;
	return {
		writable: stringItems(node.mode).includes('w'),
		allowedValues: stringItems(value?.w),
	};
}

function selectWasherBlock(state: ThinqConnectPayload | undefined, locationName: string | undefined): unknown {
	if (!Array.isArray(state)) {
		return state;
	}
	const match = locationName === undefined ? undefined : state.find((entry) => locationNameOf(entry) === locationName);
	return match ?? state[0];
}

export function readWasherCurrentState(
	state: ThinqConnectPayload | undefined,
	locationName: string | undefined,
): string | undefined {
	const block = selectWasherBlock(state, locationName);
	if (!isPlainObject(block)) {
		return undefined;
	}
	const currentState = findKey(block, 'currentState');
	return typeof currentState === 'string' ? currentState : undefined;
}

/** Remaining cycle time in seconds from the same block as `currentState`; `undefined` when unreadable. */
export function readWasherRemainingSeconds(
	state: ThinqConnectPayload | undefined,
	locationName: string | undefined,
): number | undefined {
	const block = selectWasherBlock(state, locationName);
	if (!isPlainObject(block) || !isPlainObject(block.timer)) {
		return undefined;
	}
	const { remainHour, remainMinute } = block.timer;
	const hour =
		typeof remainHour === 'number' && Number.isFinite(remainHour) && remainHour >= 0 ? remainHour : undefined;
	const minute =
		typeof remainMinute === 'number' && Number.isFinite(remainMinute) && remainMinute >= 0 ? remainMinute : undefined;
	if (hour === undefined && minute === undefined) {
		return undefined;
	}
	return (hour ?? 0) * 3600 + (minute ?? 0) * 60;
}

export function isWasherPoweredOn(currentState: string | undefined): boolean | undefined {
	return currentState === undefined ? undefined : currentState !== 'POWER_OFF';
}

export function buildWasherPowerPayload(
	command: WasherPowerCommand,
	locationName: string | undefined,
): ThinqConnectResource {
	const operation = { washerOperationMode: command };
	return locationName === undefined ? { operation } : { location: { locationName }, operation };
}

/** Returns a human-readable refusal reason, or `undefined` when the power command is allowed. */
export function evaluateWasherPowerGuards(
	command: WasherPowerCommand,
	mode: WasherOperationModeProfile | undefined,
	currentState: string | undefined,
): string | undefined {
	if (!mode) {
		return 'Profile has no washerOperationMode (not a washer, or not exposed).';
	}
	if (!mode.writable) {
		return 'washerOperationMode is not writable for this device.';
	}
	if (!mode.allowedValues.includes(command)) {
		const allowed = mode.allowedValues.length > 0 ? mode.allowedValues.join(', ') : 'none';
		return `Profile does not list "${command}" as writable (allowed: ${allowed}).`;
	}
	if (currentState === undefined) {
		return 'Washer state is unknown; refusing to send.';
	}
	if (currentState === 'RUNNING' || currentState === 'PAUSE') {
		return `Washer is ${currentState}; refusing to interrupt a cycle.`;
	}
	return undefined;
}
