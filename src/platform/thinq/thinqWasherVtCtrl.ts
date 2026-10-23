import type { ThinqCommandPayload } from '../../services/thinq/thinqApiClient.js';
import { changedWasherFieldKeys, isRecord, parseWasherField, type WasherFields } from './thinqWasherFields.js';
import { extractWasherOspWakeupCommand } from './thinqWasherStopCommandResolver.js';

export const WASHER_VT_SEND_NAMES = [
	'vt-course',
	'vt-start',
	'vt-pause',
	'vt-power-on',
	'vt-resume',
	'vt-power-off',
] as const;
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
	readonly body: WasherVtBody;
	readonly mayStartCycle: boolean;
}

export interface WasherVtOutcomeInput {
	readonly resultCode: string | undefined;
	readonly changedKeys: readonly string[];
}

export const WASHER_POLL_ATTEMPTS = 10;
export const WASHER_POLL_INTERVAL_MS = 500;
export const WASHER_VT_SEND_TIMEOUT_MS = 10_000;
export const WASHER_VT_POWER_POLL_ATTEMPTS = 16;
export const WASHER_VT_START_LOCKOUT_MS = 120_000;

export type WasherVtBody = ThinqCommandPayload & { ctrlKey: string };

const WASHER_VT_ACK_SEARCH_DEPTH = 6;

export const WASHER_VT_RUNNING_STATES: readonly string[] = [
	'DETECTING',
	'ADD_DRAIN',
	'DETERGENT_AMOUNT',
	'SOAK',
	'SOAKING',
	'PREWASH',
	'RUNNING',
	'RINSING',
	'RINSEHOLD',
	'SPINNING',
	'DRYING',
	'REFRESHING',
	'SOFTENING',
	'DETERGENT_INPUT',
	'SOFTENER_INPUT',
	'DISPENSING',
	'CLOTHING_RECOGNITION',
	'POLLUTION_DETECTING',
	'CHECKING_TURBIDITY',
	'DISPLAY_LOADSIZE',
	'COOLING',
	'COOLDOWN',
	'STEAMSOFTENING',
	'WASH_REFRESHING',
	'TUB_CLEANING',
	'CONFIRM_START_FOR_CONTROL',
];

/** Fail closed: any state not listed here (including unknown ones) is treated as a cycle in progress. */
export const WASHER_VT_IDLE_STATES: readonly string[] = ['INITIAL', 'END', 'COMPLETE', 'POWEROFF', 'ERROR'];

export const WASHER_VT_POWER_OFF_SAFE_STATES: readonly string[] = WASHER_VT_IDLE_STATES.filter(
	(state) => state !== 'POWEROFF',
);

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
	if (name === 'vt-resume') {
		return [{ cmd: 'wmControl', value: 'RESUME', type: 'ABSOLUTE' }];
	}
	if (name === 'vt-power-on') {
		return [{ cmd: 'power', value: 'POWER_ON', type: 'ABSOLUTE' }];
	}
	if (name === 'vt-power-off') {
		return [{ cmd: 'power', value: 'POWER_OFF', type: 'ABSOLUTE' }];
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

function isWasherVtSupportedModel(model: Record<string, unknown>): boolean {
	const config = model.Config;
	if (!isRecord(config) || config.uniProtocol !== true) {
		return false;
	}
	const controlWifi = model.ControlWifi;
	const vtEntry = isRecord(controlWifi) ? controlWifi.vtCtrl : undefined;
	return isRecord(vtEntry) && vtEntry.command === 'Set';
}

function buildVtDataSetList(cells: WasherVtCell[]): Record<string, unknown> {
	return {
		ctrlTarget: ['UNDEFINE'],
		reqDevType: 'APP',
		productType: 'NORMAL',
		vtData: { UNDEFINE: cells },
	};
}

/** Variant A body. Model-free: the caller has already checked the model supports vtCtrl. */
export function buildWasherVtBody(
	name: WasherVtSendName,
	courseId: string | undefined,
	options: WasherVtOptions,
): WasherVtBody {
	return {
		ctrlKey: 'vtCtrl',
		command: 'Set',
		dataSetList: buildVtDataSetList(buildWasherVtCells(name, courseId, options)),
	};
}

/** The model's own `ControlWifi.ospWakeup` as a request body (what switches an off washer on); `undefined` when the model has none. */
export function buildWasherOspWakeBody(model: Record<string, unknown>): WasherVtBody | undefined {
	const part = extractWasherOspWakeupCommand(model);
	if (part === undefined) {
		return undefined;
	}
	return {
		ctrlKey: 'ospWakeup',
		...(part.command === undefined ? {} : { command: part.command }),
		...(part.dataKey === undefined ? {} : { dataKey: part.dataKey }),
		...('dataValue' in part ? { dataValue: part.dataValue } : {}),
		...(part.dataSetList === undefined ? {} : { dataSetList: part.dataSetList }),
	};
}

/** Fail closed (`undefined`) when `Config.uniProtocol` is not true, `ControlWifi.vtCtrl` is missing or not `Set`, or vt-course has no course. */
export function buildWasherVtRequest(
	name: WasherVtSendName,
	model: Record<string, unknown>,
	input: { courseId?: string; options?: WasherVtOptions; variant: WasherVtVariant },
): WasherVtRequest | undefined {
	if (!isWasherVtSupportedModel(model)) {
		return undefined;
	}
	if (name === 'vt-course' && input.courseId === undefined) {
		return undefined;
	}

	const body = buildWasherVtBody(name, input.courseId, input.options ?? {});
	return {
		name,
		body: input.variant === 'a' ? body : { ...body, dataSetList: { vtCtrl: body.dataSetList } },
		mayStartCycle: name === 'vt-start' || name === 'vt-resume',
	};
}

function sawValue(value: unknown): string {
	return value === undefined ? 'missing' : JSON.stringify(value);
}

export type WasherVtRefusalCode =
	| 'STATE_UNREADABLE'
	| 'OFFLINE'
	| 'ONLINE_UNKNOWN'
	| 'POWER_ON_NOT_POWEROFF'
	| 'ALREADY_POWEROFF'
	| 'INTERRUPT_NEEDED'
	| 'CHILD_LOCK'
	| 'ERROR_PRESENT'
	| 'PAUSE_NOT_RUNNING'
	| 'RESUME_NOT_PAUSED'
	| 'COURSE_WASHER_POWEROFF'
	| 'COURSE_NOT_INITIAL'
	| 'COURSE_REMOTE_ON'
	| 'START_NOT_INITIAL'
	| 'DOOR_OPEN'
	| 'START_REMOTE_OFF'
	| 'NO_COURSE_STAGED';

export interface WasherVtRefusal {
	readonly code: WasherVtRefusalCode;
	readonly state?: string;
	readonly seen?: string;
}

/** Returns the refusal (code plus the values needed to word it), or `undefined` when the guard passes. */
export function checkWasherVtGuard(
	name: WasherVtSendName,
	fields: WasherFields,
	online: boolean | undefined,
	allowInterrupt = false,
): WasherVtRefusal | undefined {
	const state = parseWasherField(fields, 'state');
	if (typeof state !== 'string') {
		return { code: 'STATE_UNREADABLE' };
	}
	if (online !== true) {
		return { code: online === false ? 'OFFLINE' : 'ONLINE_UNKNOWN' };
	}

	if (name === 'vt-power-on') {
		return state === 'POWEROFF' ? undefined : { code: 'POWER_ON_NOT_POWEROFF', state };
	}

	if (name === 'vt-power-off') {
		if (state === 'POWEROFF') {
			return { code: 'ALREADY_POWEROFF', state };
		}
		if (WASHER_VT_POWER_OFF_SAFE_STATES.includes(state) || allowInterrupt) {
			return undefined;
		}
		return { code: 'INTERRUPT_NEEDED', state };
	}

	const childLock = parseWasherField(fields, 'childLock');
	if (childLock !== 'CHILDLOCK_OFF') {
		return { code: 'CHILD_LOCK', state, seen: sawValue(childLock) };
	}
	const error = parseWasherField(fields, 'error');
	if (error !== 'ERROR_NO') {
		return { code: 'ERROR_PRESENT', state, seen: sawValue(error) };
	}

	if (name === 'vt-pause') {
		return WASHER_VT_RUNNING_STATES.includes(state) ? undefined : { code: 'PAUSE_NOT_RUNNING', state };
	}
	if (name === 'vt-resume') {
		return state === 'PAUSE' ? undefined : { code: 'RESUME_NOT_PAUSED', state };
	}

	const remoteStart = parseWasherField(fields, 'remoteStart');
	if (name === 'vt-course') {
		if (state !== 'INITIAL') {
			return { code: state === 'POWEROFF' ? 'COURSE_WASHER_POWEROFF' : 'COURSE_NOT_INITIAL', state };
		}
		return remoteStart === 'REMOTE_START_OFF'
			? undefined
			: { code: 'COURSE_REMOTE_ON', state, seen: sawValue(remoteStart) };
	}

	if (state !== 'INITIAL') {
		return { code: 'START_NOT_INITIAL', state };
	}
	const doorClose = parseWasherField(fields, 'doorClose');
	const doorLock = parseWasherField(fields, 'doorLock');
	if (doorClose !== 'DOORCLOSE_ON' && doorLock !== 'DOORLOCK_ON') {
		return { code: 'DOOR_OPEN', state, seen: `doorClose=${sawValue(doorClose)}, doorLock=${sawValue(doorLock)}` };
	}
	if (remoteStart !== 'REMOTE_START_ON') {
		return { code: 'START_REMOTE_OFF', state };
	}
	const course = parseWasherField(fields, 'course');
	if (typeof course !== 'string' || course === '' || course === 'NOT_SELECTED') {
		return { code: 'NO_COURSE_STAGED', state, seen: sawValue(course) };
	}
	return undefined;
}

/** CLI wording; byte-identical to the pre-extraction guard texts. */
export function formatWasherVtRefusalForCli(refusal: WasherVtRefusal): string {
	const { code, state, seen } = refusal;
	switch (code) {
		case 'STATE_UNREADABLE':
			return 'cannot confirm washer state (washerDryer.state is absent or unreadable).';
		case 'OFFLINE':
			return 'washer is offline in the ThinQ cloud.';
		case 'ONLINE_UNKNOWN':
			return 'online status unknown.';
		case 'POWER_ON_NOT_POWEROFF':
			return `washer state is ${state}; vt-power-on needs POWEROFF.`;
		case 'ALREADY_POWEROFF':
			return 'washer is already POWEROFF; nothing to power off.';
		case 'INTERRUPT_NEEDED':
			return `washer state is ${state}; vt-power-off here abandons the cycle (water may stay in the drum, the door may stay locked). Add --allow-interrupt to confirm.`;
		case 'CHILD_LOCK':
			return `child lock is on or unreadable (saw ${seen}); turn it off on the washer first.`;
		case 'ERROR_PRESENT':
			return `washer reports an error (saw ${seen}); clear it on the washer first.`;
		case 'PAUSE_NOT_RUNNING':
			return `washer state is ${state}; vt-pause needs a running cycle.`;
		case 'RESUME_NOT_PAUSED':
			return `washer state is ${state}; vt-resume needs PAUSE.`;
		case 'COURSE_WASHER_POWEROFF':
			return 'washer is POWEROFF; power it on first (vt-power-on) and wait for INITIAL.';
		case 'COURSE_NOT_INITIAL':
			return `washer state is ${state}; vt-course needs INITIAL.`;
		case 'COURSE_REMOTE_ON':
			return `Remote Control must be OFF on the washer (saw ${seen}); the app only offers "Send to washer" when it is off.`;
		case 'START_NOT_INITIAL':
			return `washer state is ${state}; vt-start needs INITIAL.`;
		case 'DOOR_OPEN':
			return `door is not closed (saw ${seen}); close the door.`;
		case 'START_REMOTE_OFF':
			return 'Remote Control is OFF on the washer; press the Remote Control button for 3 seconds first.';
		case 'NO_COURSE_STAGED':
			return `no course is staged (washerDryer.course = ${seen}); run vt-course first.`;
	}
}

const WASHER_OFF_HOME_TEXT = 'The washer is off. Turn it on first.';
const WASHER_OFF_REFUSALS: readonly WasherVtRefusalCode[] = [
	'START_NOT_INITIAL',
	'COURSE_NOT_INITIAL',
	'PAUSE_NOT_RUNNING',
	'RESUME_NOT_PAUSED',
];

/** Home (Matter controller) wording. */
export function formatWasherVtRefusalForHome(refusal: WasherVtRefusal): string {
	const { code, state } = refusal;
	if (state === 'POWEROFF' && WASHER_OFF_REFUSALS.includes(code)) {
		return WASHER_OFF_HOME_TEXT;
	}
	switch (code) {
		case 'STATE_UNREADABLE':
			return 'Cannot read the washer state from LG. Try again in a minute.';
		case 'OFFLINE':
			return 'The washer is offline in the LG cloud. Check its Wi-Fi.';
		case 'ONLINE_UNKNOWN':
			return 'LG did not say whether the washer is online. Try again in a minute.';
		case 'POWER_ON_NOT_POWEROFF':
			return 'The washer is already on.';
		case 'ALREADY_POWEROFF':
			return 'The washer is already off.';
		case 'INTERRUPT_NEEDED':
			if (state === 'PAUSE') {
				return 'The washer is paused. Turning it off would cancel the wash. Allow cancelling in the plugin settings.';
			}
			return `The washer is ${state}. Turning it off would cancel the wash. Pause it, or allow cancelling in the plugin settings.`;
		case 'CHILD_LOCK':
			return 'Child lock is on. Turn it off on the washer first.';
		case 'ERROR_PRESENT':
			return 'The washer shows an error. Clear it on the washer first.';
		case 'COURSE_WASHER_POWEROFF':
			return WASHER_OFF_HOME_TEXT;
		case 'PAUSE_NOT_RUNNING':
			return `Pause works only while the washer is running (it is ${state}).`;
		case 'RESUME_NOT_PAUSED':
			return `Resume works only while the washer is paused (it is ${state}).`;
		case 'COURSE_NOT_INITIAL':
		case 'START_NOT_INITIAL':
			return `The washer is ${state}. Start works only when it is ready.`;
		case 'COURSE_REMOTE_ON':
		case 'START_REMOTE_OFF':
			return 'Press the Remote Control button on the washer for 3 seconds, then tap Start again.';
		case 'DOOR_OPEN':
			return 'The washer door is not closed. Close it first.';
		case 'NO_COURSE_STAGED':
			return 'No course is selected on the washer. Pick a Selected Wash Course in the plugin settings.';
	}
}

/** Returns the refusal reason (ending in a period), or `undefined` when the guard passes. */
export function evaluateWasherVtGuard(
	name: WasherVtSendName,
	fields: WasherFields,
	online: boolean | undefined,
	allowInterrupt = false,
): string | undefined {
	const refusal = checkWasherVtGuard(name, fields, online, allowInterrupt);
	return refusal === undefined ? undefined : formatWasherVtRefusalForCli(refusal);
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

/** Post-send confirmation from a fresh read. vt-course is confirmed with `isWasherVtCourseApplied` instead. */
export function isWasherVtExpectedState(name: WasherVtSendName, fields: WasherFields): boolean {
	const state = parseWasherField(fields, 'state');
	if (typeof state !== 'string') {
		return false;
	}
	switch (name) {
		case 'vt-power-on':
			return state !== 'POWEROFF';
		case 'vt-power-off':
			return state === 'POWEROFF';
		case 'vt-pause':
			return state === 'PAUSE';
		case 'vt-resume':
			return state !== 'PAUSE' && state !== 'POWEROFF';
		case 'vt-start':
			return state !== 'INITIAL' && state !== 'POWEROFF';
		case 'vt-course':
			return false;
	}
}

/** True when the washer's course equals the plan and every plan option key equals its value. */
export function isWasherVtCourseApplied(fields: WasherFields, courseId: string, options: WasherVtOptions): boolean {
	if (parseWasherField(fields, 'course') !== courseId) {
		return false;
	}
	return WASHER_VT_OPTION_KEYS.every((key) => {
		const value = options[key];
		return value === undefined || parseWasherField(fields, key) === value;
	});
}

/** `cmd=code` entries of the reply whose code is neither `0` (applied) nor `17` (cell already held the value). */
export function rejectedWasherVtCells(reply: unknown): string[] {
	return extractWasherVtReturnCodes(reply).filter((entry) => {
		const code = entry.slice(entry.lastIndexOf('=') + 1);
		return code !== '0' && code !== '17';
	});
}

/** Generic app-style poll: up to `attempts` times sleep then read; stops at the first read where `isDone` is true. */
export async function pollWasherUntil<T>(
	read: () => Promise<T>,
	isDone: (value: T) => boolean,
	sleepFn: (ms: number) => Promise<void>,
	attempts: number,
	intervalMs: number,
): Promise<{ value: T | undefined; done: boolean; polls: number }> {
	let value: T | undefined;
	let polls = 0;
	while (polls < attempts) {
		await sleepFn(intervalMs);
		polls += 1;
		try {
			value = await read();
		} catch {
			continue;
		}
		if (isDone(value)) {
			return { value, done: true, polls };
		}
	}
	return { value, done: false, polls };
}
