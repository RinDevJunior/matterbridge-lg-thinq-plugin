import type { ThinqCommandPayload } from '../../services/thinq/thinqApiClient.js';
import { changedWasherFieldKeys, isRecord, parseWasherField, type WasherFields } from './washerCommon.js';

export const WASHER_VT_SEND_NAMES = ['vt-course', 'vt-start', 'vt-pause', 'vt-power-on'] as const;
export type WasherVtSendName = (typeof WASHER_VT_SEND_NAMES)[number];

export type WasherVtVariant = 'a' | 'b';
export const WASHER_VT_OPTION_KEYS = ['soilWash', 'rinse', 'spin', 'temp'] as const;
export type WasherVtOptionKey = (typeof WASHER_VT_OPTION_KEYS)[number];
export type WasherVtOptions = Partial<Record<WasherVtOptionKey, string>>;

export interface WasherVtCell {
	readonly cmd: string;
	readonly value: string;
	readonly type: 'ABSOLUTE';
}

export interface WasherVtRequest {
	readonly name: WasherVtSendName;
	readonly body: ThinqCommandPayload & { ctrlKey: string };
	readonly mayStartCycle: boolean;
}

export interface WasherVtOutcomeInput {
	readonly resultCode: string | undefined;
	readonly changedKeys: readonly string[];
}

export const WASHER_POLL_ATTEMPTS = 10;
export const WASHER_POLL_INTERVAL_MS = 500;

const WASHER_VT_ACK_SEARCH_DEPTH = 6;

const RUNNING_STATES: readonly string[] = [
	'DETECTING',
	'ADD_DRAIN',
	'DETERGENT_AMOUNT',
	'SOAK',
	'PREWASH',
	'RUNNING',
	'RINSING',
	'RINSEHOLD',
	'SPINNING',
	'DRYING',
	'REFRESHING',
];

export function isWasherVtSendName(value: string): value is WasherVtSendName {
	return (WASHER_VT_SEND_NAMES as readonly string[]).includes(value);
}

/** Maps the send to the `vtCtrl` cells the LG app sends: course + the option cells the caller passed, in fixed order. */
export function buildWasherVtCells(
	name: WasherVtSendName,
	courseId: string | undefined,
	options: WasherVtOptions,
): WasherVtCell[] {
	if (name === 'vt-start') {
		return [{ cmd: 'wmControl', value: 'START', type: 'ABSOLUTE' }];
	}
	if (name === 'vt-pause') {
		return [{ cmd: 'wmControl', value: 'PAUSE', type: 'ABSOLUTE' }];
	}
	if (name === 'vt-power-on') {
		return [{ cmd: 'power', value: 'POWER_ON', type: 'ABSOLUTE' }];
	}
	if (courseId === undefined) {
		return [];
	}
	const optionCells = WASHER_VT_OPTION_KEYS.flatMap((key): WasherVtCell[] => {
		const value = options[key];
		return value === undefined ? [] : [{ cmd: key, value, type: 'ABSOLUTE' }];
	});
	return [{ cmd: 'course', value: courseId, type: 'ABSOLUTE' }, ...optionCells];
}

/** Fail closed (`undefined`) when `Config.uniProtocol` is not true, `ControlWifi.vtCtrl` is missing or not `Set`, or vt-course has no course. */
export function buildWasherVtRequest(
	name: WasherVtSendName,
	model: Record<string, unknown>,
	input: { courseId?: string; options?: WasherVtOptions; variant: WasherVtVariant },
): WasherVtRequest | undefined {
	const config = model.Config;
	if (!isRecord(config) || config.uniProtocol !== true) {
		return undefined;
	}
	const controlWifi = model.ControlWifi;
	const vtEntry = isRecord(controlWifi) ? controlWifi.vtCtrl : undefined;
	if (!isRecord(vtEntry) || vtEntry.command !== 'Set') {
		return undefined;
	}
	if (name === 'vt-course' && input.courseId === undefined) {
		return undefined;
	}

	const cells = buildWasherVtCells(name, input.courseId, input.options ?? {});
	const vt = {
		ctrlTarget: ['UNDEFINE'],
		reqDevType: 'APP',
		productType: 'NORMAL',
		vtData: { UNDEFINE: cells },
	};
	const dataSetList = input.variant === 'a' ? vt : { vtCtrl: vt };
	return {
		name,
		body: { ctrlKey: 'vtCtrl', command: 'Set', dataSetList },
		mayStartCycle: name === 'vt-start',
	};
}

function sawValue(value: unknown): string {
	return value === undefined ? 'missing' : JSON.stringify(value);
}

/** Returns the refusal reason (ending in a period), or `undefined` when the guard passes. */
export function evaluateWasherVtGuard(
	name: WasherVtSendName,
	fields: WasherFields,
	online: boolean | undefined,
): string | undefined {
	const state = parseWasherField(fields, 'state');
	if (typeof state !== 'string') {
		return 'cannot confirm washer state (washerDryer.state is absent or unreadable).';
	}
	if (online !== true) {
		return online === false ? 'washer is offline in the ThinQ cloud.' : 'online status unknown.';
	}

	if (name === 'vt-power-on') {
		return state === 'POWEROFF' ? undefined : `washer state is ${state}; vt-power-on needs POWEROFF.`;
	}

	const childLock = parseWasherField(fields, 'childLock');
	if (childLock !== 'CHILDLOCK_OFF') {
		return `child lock is on or unreadable (saw ${sawValue(childLock)}); turn it off on the washer first.`;
	}
	const error = parseWasherField(fields, 'error');
	if (error !== 'ERROR_NO') {
		return `washer reports an error (saw ${sawValue(error)}); clear it on the washer first.`;
	}

	if (name === 'vt-pause') {
		return RUNNING_STATES.includes(state) ? undefined : `washer state is ${state}; vt-pause needs a running cycle.`;
	}

	const remoteStart = parseWasherField(fields, 'remoteStart');
	if (name === 'vt-course') {
		if (state !== 'INITIAL') {
			return state === 'POWEROFF'
				? 'washer is POWEROFF; power it on first (vt-power-on) and wait for INITIAL.'
				: `washer state is ${state}; vt-course needs INITIAL.`;
		}
		return remoteStart === 'REMOTE_START_OFF'
			? undefined
			: `Remote Control must be OFF on the washer (saw ${sawValue(remoteStart)}); the app only offers "Send to washer" when it is off.`;
	}

	if (state !== 'INITIAL') {
		return `washer state is ${state}; vt-start needs INITIAL.`;
	}
	const doorClose = parseWasherField(fields, 'doorClose');
	if (doorClose !== 'DOORCLOSE_ON') {
		return `door is not closed (saw ${sawValue(doorClose)}); close the door.`;
	}
	if (remoteStart !== 'REMOTE_START_ON') {
		return 'Remote Control is OFF on the washer; press the Remote Control button for 3 seconds first.';
	}
	const course = parseWasherField(fields, 'course');
	if (typeof course !== 'string' || course === '' || course === 'NOT_SELECTED') {
		return `no course is staged (washerDryer.course = ${sawValue(course)}); run vt-course first.`;
	}
	return undefined;
}

function ackCode(entry: unknown): string | undefined {
	if (!isRecord(entry)) {
		return undefined;
	}
	const code = entry.returnCode;
	return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

function collectVtAckEntries(ack: unknown, depth: number, found: string[]): void {
	if (depth > WASHER_VT_ACK_SEARCH_DEPTH) {
		return;
	}
	if (Array.isArray(ack)) {
		for (const item of ack) {
			const code = ackCode(item);
			if (code !== undefined) {
				found.push(`${isRecord(item) && typeof item.cmd === 'string' ? item.cmd : '?'}=${code}`);
			} else {
				collectVtAckEntries(item, depth + 1, found);
			}
		}
		return;
	}
	if (!isRecord(ack)) {
		return;
	}
	const ownCode = ackCode(ack);
	if (ownCode !== undefined) {
		found.push(`${typeof ack.cmd === 'string' ? ack.cmd : '?'}=${ownCode}`);
		return;
	}
	for (const [cmd, item] of Object.entries(ack)) {
		const code = ackCode(item);
		if (code !== undefined) {
			found.push(`${cmd}=${code}`);
		} else {
			collectVtAckEntries(item, depth + 1, found);
		}
	}
}

function collectVtAcks(node: unknown, depth: number, found: string[]): void {
	if (depth > WASHER_VT_ACK_SEARCH_DEPTH) {
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectVtAcks(item, depth + 1, found);
		}
		return;
	}
	if (!isRecord(node)) {
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'vtAck') {
			collectVtAckEntries(value, depth + 1, found);
		} else {
			collectVtAcks(value, depth + 1, found);
		}
	}
}

/** Every `returnCode` found under a `vtAck` key (depth <= 6) as `<cmd or ?>=<code>`; `[]` when none. */
export function extractWasherVtReturnCodes(reply: unknown): string[] {
	const found: string[] = [];
	collectVtAcks(reply, 0, found);
	return found;
}

/** Verdict lines; the first line always starts with `Verdict: `. Pure. */
export function classifyWasherVtOutcome(input: WasherVtOutcomeInput): string[] {
	const changed = input.changedKeys.length > 0;
	const keys = input.changedKeys.join(', ');
	const { resultCode } = input;

	if (resultCode === undefined) {
		return [
			changed
				? `Verdict: no resultCode in the reply, but the status changed (${keys}).`
				: 'Verdict: no resultCode in the reply and no tracked field changed.',
		];
	}
	if (resultCode === '0000') {
		return [
			changed
				? `Verdict: LG answered 0000 and the status changed (${keys}). The command was likely applied.`
				: 'Verdict: LG answered 0000 but no tracked field changed. Not proven applied (the earlier WMDownload on control did the same).',
		];
	}
	if (resultCode === '0111') {
		return [
			changed
				? `Verdict: LG answered 0111 (the washer answered late) but the status changed (${keys}). The LG app treats this as success, so the command was LIKELY applied. This is an inference, not proof.`
				: 'Verdict: LG answered 0111 and no tracked field changed. Likely NOT applied (the LG app would show "try again").',
		];
	}
	const lines = [`Verdict: LG answered ${resultCode}. Not applied.`];
	if (changed) {
		lines.push(`A tracked field changed anyway (${keys}); check the washer.`);
	}
	return lines;
}

/** Like the app: up to `attempts` times sleep then read; stops at the first read with a changed tracked key. */
export async function pollWasherFields(
	readFields: () => Promise<WasherFields>,
	before: WasherFields,
	sleepFn: (ms: number) => Promise<void>,
	attempts: number = WASHER_POLL_ATTEMPTS,
	intervalMs: number = WASHER_POLL_INTERVAL_MS,
): Promise<{ fields: WasherFields; changedKeys: string[]; polls: number }> {
	let fields = before;
	let changedKeys: string[] = [];
	let polls = 0;
	while (polls < attempts && changedKeys.length === 0) {
		await sleepFn(intervalMs);
		fields = await readFields();
		polls += 1;
		changedKeys = changedWasherFieldKeys(before, fields);
	}
	return { fields, changedKeys, polls };
}
