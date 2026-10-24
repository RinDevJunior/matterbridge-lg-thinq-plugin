import type { ThinqConnectPayload, ThinqConnectResource } from './thinqConnectApiClient.js';

export type WasherPowerCommand = 'POWER_ON' | 'POWER_OFF';

export type WasherCycleCommand = 'START' | 'STOP';

/** Explicit allowlists: an unknown or new Connect state must never default to Running. */
export const RUNNING_STATES: ReadonlySet<string> = new Set([
	'RUNNING',
	'SOAKING',
	'DETECTING',
	'RINSING',
	'DETERGENT_AMOUNT',
	'DRYING',
	'PREWASH',
	'STEAM_SOFTENING',
	'SPINNING',
	'DISPENSING',
	'ADD_DRAIN',
]);

export const PAUSED_STATES: ReadonlySet<string> = new Set(['PAUSE', 'RINSE_HOLD']);

export const STOPPED_STATES: ReadonlySet<string> = new Set([
	'POWER_OFF',
	'INITIAL',
	'END',
	'RESERVED',
	'REFRESHING',
	'FROZEN_PREVENT_INITIAL',
	'FROZEN_PREVENT_RUNNING',
	'FROZEN_PREVENT_PAUSE',
]);

/** States from which START is accepted; widen only after a live test. */
export const WASHER_START_READY_STATES: ReadonlySet<string> = new Set(['INITIAL']);

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

export function locationNameOf(node: unknown): string | undefined {
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

/** `undefined` when unreadable; the API itself answers 2301 if remote control is off. */
export function readWasherRemoteControlEnabled(
	state: ThinqConnectPayload | undefined,
	locationName: string | undefined,
): boolean | undefined {
	const block = selectWasherBlock(state, locationName);
	if (!isPlainObject(block)) {
		return undefined;
	}
	const enabled = findKey(block, 'remoteControlEnabled');
	return typeof enabled === 'boolean' ? enabled : undefined;
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

export function buildWasherOperationPayload(
	command: WasherPowerCommand | WasherCycleCommand,
	locationName: string,
): ThinqConnectResource {
	return { location: { locationName }, operation: { washerOperationMode: command } };
}

export type WasherCycleDecision =
	{ kind: 'allow' } | { kind: 'noop'; reason: string } | { kind: 'refuse'; reason: string };

/** Pure guard for START/STOP; every doubt resolves to refuse, never to allow. */
export function evaluateWasherCycleCommand(
	command: WasherCycleCommand,
	mode: WasherOperationModeProfile | undefined,
	currentState: string | undefined,
	remoteControlEnabled: boolean | undefined,
): WasherCycleDecision {
	const refuse = (reason: string): WasherCycleDecision => ({ kind: 'refuse', reason });

	if (!mode) {
		return refuse('Profile has no washerOperationMode (not a washer, or not exposed).');
	}
	if (!mode.writable) {
		return refuse('washerOperationMode is not writable for this device.');
	}
	if (!mode.allowedValues.includes(command)) {
		const allowed = mode.allowedValues.length > 0 ? mode.allowedValues.join(', ') : 'none';
		return refuse(`Profile does not list "${command}" as writable (allowed: ${allowed}).`);
	}
	if (currentState === undefined) {
		return refuse('Washer state is unknown; refusing to send.');
	}

	if (command === 'START') {
		if (RUNNING_STATES.has(currentState)) {
			return { kind: 'noop', reason: 'Washer is already running.' };
		}
		if (PAUSED_STATES.has(currentState)) {
			return refuse(
				'Washer is paused. Start would be a resume, which ThinQ Connect does not offer. Resume on the washer itself.',
			);
		}
		if (currentState === 'ERROR') {
			return refuse('Washer reports an error. Clear it on the washer first.');
		}
		if (currentState === 'POWER_OFF') {
			return refuse(
				'Washer is powered off. Turn it on first, then load laundry and choose a cycle. The plugin never powers it on for you.',
			);
		}
	} else if (!RUNNING_STATES.has(currentState) && !PAUSED_STATES.has(currentState)) {
		return { kind: 'noop', reason: `Washer is not running (state ${currentState}); nothing to stop.` };
	}

	if (remoteControlEnabled === false) {
		return refuse('Remote start is off on the washer. Enable remote control on the washer first.');
	}
	if (command === 'START' && !WASHER_START_READY_STATES.has(currentState)) {
		return refuse(`Washer state ${currentState} is not ready to start (only INITIAL is accepted).`);
	}
	return { kind: 'allow' };
}

const WASHER_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
	'2301': 'Remote start is off on the washer. Enable remote control on the washer first.',
	'2302': 'The washer cannot accept this command in its current state.',
	'2303': 'The washer reports an error. Clear it on the washer first.',
	'2304': 'The washer is powered off. Turn it on first.',
	'2305': "The washer's current mode or cycle does not allow this. Choose a cycle on the washer.",
	'2207': 'ThinQ rejected the command format (2207). Nothing ran. Report this with the debug log.',
	'2208': 'The washer failed to carry out the command.',
	'2209': 'The washer did not answer in time. The command may or may not have run; the real state is re-read shortly.',
	'2205': 'The washer is in an invalid status for this command.',
	'1223': 'The washer is in an invalid status for this command.',
	'1222': 'The washer is offline.',
	'1306': 'Too many requests to LG. Wait a minute and try again.',
	'2210': 'LG asked to retry; try again in a moment.',
	'2212': 'LG asked to retry; try again in a moment.',
	'1103': 'Personal Access Token is invalid or expired. Create a new token.',
	'1218': 'Personal Access Token is invalid or expired. Create a new token.',
};

/** Plain-language text for a failed washer command; unknown or missing code returns `fallback`. */
export function describeWasherCommandFailure(resultCode: string | undefined, fallback: string): string {
	return (resultCode === undefined ? undefined : WASHER_FAILURE_MESSAGES[resultCode]) ?? fallback;
}
