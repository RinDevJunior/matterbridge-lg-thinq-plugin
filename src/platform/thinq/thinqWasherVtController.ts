import { AnsiLogger } from 'matterbridge/logger';

import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';
import {
	describeSendFailure,
	describeThinqResultCode,
	parseResultCode,
	parseWasherField,
	type WasherFields,
} from './thinqWasherFields.js';
import type { WasherCourseOptions } from './thinqWasherMatterPlan.js';
import {
	buildWasherVtBody,
	buildWasherVtCells,
	checkWasherVtGuard,
	extractWasherVtReturnCodes,
	formatWasherVtRefusalForHome,
	isWasherVtCourseApplied,
	isWasherVtExpectedState,
	pollWasherUntil,
	rejectedWasherVtCellKeys,
	rejectedWasherVtCells,
	WASHER_POLL_ATTEMPTS,
	WASHER_POLL_INTERVAL_MS,
	WASHER_VT_IDLE_STATES,
	WASHER_VT_OMIT_COURSE_CELL_DEFAULT,
	WASHER_VT_OPTION_KEYS,
	WASHER_VT_POWER_POLL_ATTEMPTS,
	WASHER_VT_RUNNING_STATES,
	WASHER_VT_SEEDED_REFUSED_VALUES,
	WASHER_VT_SEND_TIMEOUT_MS,
	WASHER_VT_START_LOCKOUT_MS,
	type WasherVtBody,
	type WasherVtOptionKey,
	type WasherVtOptions,
	type WasherVtRefusal,
	type WasherVtSendName,
} from './thinqWasherVtCtrl.js';
import type { WasherVtStagePlan } from './thinqWasherVtStagePlan.js';

export type WasherVtAction = 'power-on' | 'power-off' | 'start' | 'pause' | 'resume' | 'stop';
export type WasherVtOutcomeStatus = 'done' | 'noop' | 'staged' | 'refused' | 'failed' | 'unconfirmed';

export interface WasherVtOutcome {
	readonly status: WasherVtOutcomeStatus;
	readonly message: string;
	readonly snapshot?: ThinqSnapshot;
}

export type WasherVtChange =
	| { readonly kind: 'course'; readonly courseId: string }
	| { readonly kind: 'option'; readonly key: WasherVtOptionKey; readonly value: string };

export interface WasherVtReading {
	readonly fields: WasherFields;
	readonly online: boolean | undefined;
	readonly snapshot: ThinqSnapshot;
}

export interface WasherVtPorts {
	readReading(): Promise<WasherVtReading | undefined>;
	send(body: WasherVtBody): Promise<unknown>;
	sleep(ms: number): Promise<void>;
	now(): number;
}

export interface WasherVtControllerOptions {
	readonly allowCancelCycle: boolean;
	readonly stagePlan: WasherVtStagePlan | undefined;
	/** The model's own `ospWakeup` body; `vtCtrl POWER_ON` does not wake a washer in POWEROFF (LG answers 0111). */
	readonly wakeBody?: WasherVtBody | undefined;
	readonly sendTimeoutMs?: number;
	readonly pollAttempts?: number;
	readonly powerPollAttempts?: number;
	readonly pollIntervalMs?: number;
	readonly startLockoutMs?: number;
	/** Per-course allowed values. Omitted = the controller refuses every `applyChanges`. */
	readonly resolveCourseOptions?: ((courseId: string) => WasherCourseOptions | undefined) | undefined;
	/**
	 * Option A: omit the `course` cell and send only the requested cells when the course is not changing.
	 * Default `WASHER_VT_OMIT_COURSE_CELL_DEFAULT`. Tests set it explicitly; nothing wires it from config.
	 */
	readonly omitCourseCellWhenUnchanged?: boolean;
}

interface WasherVtSelection {
	readonly courseId: string;
	readonly options: WasherVtOptions;
}

/** What a send puts in the body: `courseId: undefined` means the `course` cell is left out (Option A). */
interface WasherVtSendStage {
	readonly courseId: string | undefined;
	readonly options: WasherVtOptions;
}

interface SendResult {
	readonly outcome: WasherVtOutcome;
	readonly reply: unknown;
}

const MSG_BUSY = 'Another washer command is still running. Wait a few seconds.';
const MSG_NOT_FOUND = 'The washer was not found in the LG account.';
const MSG_UNREADABLE = 'Cannot read the washer state from LG. Try again in a minute.';
const MSG_LOCKOUT =
	'A Start was sent a moment ago and the washer has not confirmed it. Check the washer before trying again.';
const MSG_NO_WAKE =
	'This washer model has no wake-up command, so Home cannot switch it on. Use the power button on the washer.';
const MSG_NO_COURSE = 'The washer has no wash course selected. Pick a course on the washer first.';
const MSG_NO_OPTIONS = 'This washer model does not describe its wash courses, so Home cannot change them.';
const MSG_KEY_NOT_ON_COURSE = 'The selected wash course has no such setting.';
const MSG_VALUE_NOT_ALLOWED = 'The selected wash course does not allow that setting.';
const MSG_REMOTE_OFF = 'Press the Remote Control button on the washer for 3 seconds, then tap Start again.';
const MSG_VALUE_REFUSED_BY_WASHER = 'The washer does not accept that setting. Pick a different value.';
const MSG_CARRIED_VALUE_REFUSED =
	'The washer will not keep its current temperature or spin setting, so this change would reset it. Change that setting in Home first, then try again.';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function stateOf(fields: WasherFields): string | undefined {
	const state = parseWasherField(fields, 'state');
	return typeof state === 'string' ? state : undefined;
}

function withoutKeys(cells: WasherVtOptions, keys: readonly WasherVtOptionKey[]): WasherVtOptions {
	const kept: WasherVtOptions = {};
	for (const key of WASHER_VT_OPTION_KEYS) {
		const value = cells[key];
		if (value !== undefined && !keys.includes(key)) {
			kept[key] = value;
		}
	}
	return kept;
}

export class WasherVtController {
	private inFlight = false;
	private startLockedUntil = 0;
	private homeSelection: WasherVtSelection | undefined;
	/** Values this washer refused at runtime, on top of the seeded list. Per instance, never persisted. */
	private readonly learnedRefusedValues = new Map<WasherVtOptionKey, Set<string>>();

	private readonly sendTimeoutMs: number;
	private readonly pollAttempts: number;
	private readonly powerPollAttempts: number;
	private readonly pollIntervalMs: number;
	private readonly startLockoutMs: number;
	private readonly omitCourseCellWhenUnchanged: boolean;

	public constructor(
		private readonly label: string,
		private readonly ports: WasherVtPorts,
		private readonly logger: AnsiLogger,
		private readonly options: WasherVtControllerOptions,
	) {
		this.sendTimeoutMs = options.sendTimeoutMs ?? WASHER_VT_SEND_TIMEOUT_MS;
		this.pollAttempts = options.pollAttempts ?? WASHER_POLL_ATTEMPTS;
		this.powerPollAttempts = options.powerPollAttempts ?? WASHER_VT_POWER_POLL_ATTEMPTS;
		this.pollIntervalMs = options.pollIntervalMs ?? WASHER_POLL_INTERVAL_MS;
		this.startLockoutMs = options.startLockoutMs ?? WASHER_VT_START_LOCKOUT_MS;
		this.omitCourseCellWhenUnchanged = options.omitCourseCellWhenUnchanged ?? WASHER_VT_OMIT_COURSE_CELL_DEFAULT;
	}

	/** Never throws. `done` and `noop` are success; every other status is a refusal or failure for the caller to surface. */
	public async run(action: WasherVtAction): Promise<WasherVtOutcome> {
		return this.withLock(action, () => this.execute(action));
	}

	/** Never throws. One `vt-course` send carrying the course and all four option cells; never `wmControl`. */
	public async applyChanges(changes: readonly WasherVtChange[]): Promise<WasherVtOutcome> {
		return this.withLock('apply-changes', () => this.executeChanges(changes));
	}

	private async withLock(label: string, body: () => Promise<WasherVtOutcome>): Promise<WasherVtOutcome> {
		if (this.inFlight) {
			this.logger.warn(`ThinQ Washer ${this.label}: '${label}' refused, another command is running`);
			return { status: 'refused', message: MSG_BUSY };
		}
		this.inFlight = true;
		try {
			return await body();
		} catch (error) {
			this.logger.error(`ThinQ Washer ${this.label}: '${label}' failed unexpectedly: ${errorText(error)}`);
			return { status: 'failed', message: `Could not control the washer: ${errorText(error)}` };
		} finally {
			this.inFlight = false;
		}
	}

	private async executeChanges(changes: readonly WasherVtChange[]): Promise<WasherVtOutcome> {
		if (changes.length === 0) {
			return { status: 'noop', message: 'nothing to change' };
		}
		const reading = await this.read();
		if ('status' in reading) {
			return reading;
		}
		const refusal = checkWasherVtGuard('vt-course', reading.fields, reading.online);
		if (refusal) {
			return this.refuse(refusal, reading);
		}

		const requestedCourse = changes.findLast((change) => change.kind === 'course')?.courseId;
		const courseId = requestedCourse ?? parseWasherField(reading.fields, 'course');
		if (typeof courseId !== 'string' || courseId === '' || courseId === 'NOT_SELECTED' || courseId === 'DOWNLOAD') {
			return this.refuseSelection(reading, MSG_NO_COURSE);
		}
		const courseOptions = this.options.resolveCourseOptions?.(courseId);
		if (courseOptions === undefined) {
			return this.refuseSelection(reading, MSG_NO_OPTIONS);
		}

		const requested = new Map<WasherVtOptionKey, string>();
		for (const change of changes) {
			if (change.kind === 'option') {
				requested.set(change.key, change.value);
			}
		}
		const cells: Partial<Record<WasherVtOptionKey, string>> = {};
		const confirmCells: Partial<Record<WasherVtOptionKey, string>> = {};
		for (const key of WASHER_VT_OPTION_KEYS) {
			const list = courseOptions[key];
			const value = requested.get(key);
			if (list === undefined) {
				if (value !== undefined) {
					return this.refuseSelection(reading, MSG_KEY_NOT_ON_COURSE);
				}
				continue;
			}
			if (value !== undefined) {
				if (!list.writable || !list.values.includes(value)) {
					return this.refuseSelection(reading, MSG_VALUE_NOT_ALLOWED);
				}
				if (this.isRefusedValue(key, value)) {
					return this.refuseSelection(reading, MSG_VALUE_REFUSED_BY_WASHER);
				}
				cells[key] = value;
				confirmCells[key] = value;
				continue;
			}
			const current = parseWasherField(reading.fields, key);
			cells[key] = typeof current === 'string' && list.values.includes(current) ? current : list.defaultValue;
		}

		if (isWasherVtCourseApplied(reading.fields, courseId, confirmCells)) {
			this.homeSelection = { courseId, options: cells };
			return this.noop(reading, 'the washer already has these settings');
		}

		// Option A: with no `course` cell the washer has no template to re-apply, so only the cells the
		// user asked for are sent and every other setting is left alone.
		const omitCourse = requestedCourse === undefined && this.omitCourseCellWhenUnchanged;
		const refusedCarried = this.refusedCarriedKeys(cells, confirmCells);
		if (refusedCarried.length > 0 && !omitCourse) {
			if (requestedCourse === undefined) {
				return this.refuseSelection(reading, MSG_CARRIED_VALUE_REFUSED);
			}
			for (const key of refusedCarried) {
				this.logger.warn(
					`ThinQ Washer ${this.label}: leaving ${key}=${cells[key]} out of the send, the washer refuses that value`,
				);
			}
		}
		const bodyCells = omitCourse ? confirmCells : withoutKeys(cells, refusedCarried);
		if (omitCourse && WASHER_VT_OPTION_KEYS.every((key) => bodyCells[key] === undefined)) {
			return this.noop(reading, 'nothing to change');
		}

		const result = await this.sendAndConfirm(
			'vt-course',
			reading,
			this.pollAttempts,
			(fields) => isWasherVtCourseApplied(fields, courseId, confirmCells),
			undefined,
			{ courseId: omitCourse ? undefined : courseId, options: bodyCells },
		);
		this.rememberRefusedValues(bodyCells, result.reply);
		if (result.outcome.status === 'done') {
			this.homeSelection = { courseId, options: cells };
			const ignored = rejectedWasherVtCells(result.reply);
			if (ignored.length > 0) {
				this.logger.warn(
					`ThinQ Washer ${this.label}: the washer refused ${ignored.join(', ')} while applying the requested change; it kept or reset those settings itself`,
				);
			}
			return result.outcome;
		}
		if (result.outcome.status === 'unconfirmed') {
			const rejected = rejectedWasherVtCells(result.reply);
			return {
				...result.outcome,
				message: `${result.outcome.message}${rejected.length > 0 ? ` LG did not apply: ${rejected.join(', ')}.` : ''}`,
			};
		}
		return result.outcome;
	}

	private refuseSelection(reading: WasherVtReading, message: string): WasherVtOutcome {
		this.logger.warn(`ThinQ Washer ${this.label}: refused, ${message}`);
		return { status: 'refused', message, snapshot: reading.snapshot };
	}

	private isRefusedValue(key: WasherVtOptionKey, value: string): boolean {
		return (
			WASHER_VT_SEEDED_REFUSED_VALUES[key]?.includes(value) === true ||
			this.learnedRefusedValues.get(key)?.has(value) === true
		);
	}

	/** Keys whose value came from carry-forward (not from `requested`) and is one the washer refuses. */
	private refusedCarriedKeys(cells: WasherVtOptions, requested: WasherVtOptions): WasherVtOptionKey[] {
		return WASHER_VT_OPTION_KEYS.filter((key) => {
			const value = cells[key];
			return value !== undefined && requested[key] === undefined && this.isRefusedValue(key, value);
		});
	}

	/** Learns the values this washer rejected in the ack, so Home never sends them again this session. */
	private rememberRefusedValues(sent: WasherVtOptions, reply: unknown): void {
		for (const cmd of rejectedWasherVtCellKeys(reply)) {
			const key = WASHER_VT_OPTION_KEYS.find((candidate) => candidate === cmd);
			const value = key === undefined ? undefined : sent[key];
			if (key === undefined || value === undefined) {
				continue;
			}
			const known = this.learnedRefusedValues.get(key) ?? new Set<string>();
			known.add(value);
			this.learnedRefusedValues.set(key, known);
			this.logger.warn(
				`ThinQ Washer ${this.label}: the washer refused ${key}=${value}; Home will not send that value again`,
			);
		}
	}

	private async execute(action: WasherVtAction): Promise<WasherVtOutcome> {
		const reading = await this.read();
		if ('status' in reading) {
			return reading;
		}
		const state = stateOf(reading.fields);
		this.logger.info(`ThinQ Washer ${this.label}: '${action}' requested, state=${state ?? 'unknown'}`);

		switch (action) {
			case 'power-on':
				return this.powerOn(reading);
			case 'power-off':
				return this.powerOff(reading, state);
			case 'stop':
				return this.stop(reading, state);
			case 'pause':
				return this.pause(reading, state);
			case 'resume':
				return this.resume(reading, state);
			case 'start':
				return state === 'PAUSE' ? this.resume(reading, state) : this.start(reading, state);
		}
	}

	private async read(): Promise<WasherVtReading | WasherVtOutcome> {
		let reading: WasherVtReading | undefined;
		try {
			reading = await this.ports.readReading();
		} catch (error) {
			this.logger.warn(`ThinQ Washer ${this.label}: state read failed: ${errorText(error)}`);
			return { status: 'failed', message: MSG_UNREADABLE };
		}
		return reading ?? { status: 'refused', message: MSG_NOT_FOUND };
	}

	private refuse(refusal: WasherVtRefusal, reading: WasherVtReading): WasherVtOutcome {
		const message = formatWasherVtRefusalForHome(refusal);
		this.logger.warn(`ThinQ Washer ${this.label}: refused (${refusal.code}): ${message}`);
		return { status: 'refused', message, snapshot: reading.snapshot };
	}

	private noop(reading: WasherVtReading, why: string): WasherVtOutcome {
		this.logger.info(`ThinQ Washer ${this.label}: nothing to do, ${why}`);
		return { status: 'noop', message: why, snapshot: reading.snapshot };
	}

	private async powerOn(reading: WasherVtReading): Promise<WasherVtOutcome> {
		const refusal = checkWasherVtGuard('vt-power-on', reading.fields, reading.online);
		if (refusal?.code === 'POWER_ON_NOT_POWEROFF') {
			return this.noop(reading, 'the washer is already on');
		}
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		const { wakeBody } = this.options;
		if (wakeBody === undefined) {
			this.logger.warn(`ThinQ Washer ${this.label}: refused, the model has no ControlWifi.ospWakeup`);
			return { status: 'refused', message: MSG_NO_WAKE, snapshot: reading.snapshot };
		}
		return (
			await this.sendAndConfirm(
				'osp-wake',
				reading,
				this.powerPollAttempts,
				(fields) => {
					const polled = stateOf(fields);
					return polled !== undefined && polled !== 'POWEROFF';
				},
				wakeBody,
			)
		).outcome;
	}

	private async powerOff(reading: WasherVtReading, state: string | undefined): Promise<WasherVtOutcome> {
		const refusal = checkWasherVtGuard('vt-power-off', reading.fields, reading.online, this.options.allowCancelCycle);
		if (refusal?.code === 'ALREADY_POWEROFF') {
			return this.noop(reading, 'the washer is already off');
		}
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		if (state !== undefined && !WASHER_VT_IDLE_STATES.includes(state)) {
			return this.cancel(reading, state);
		}
		return (await this.sendAndConfirm('vt-power-off', reading, this.powerPollAttempts)).outcome;
	}

	private async stop(reading: WasherVtReading, state: string | undefined): Promise<WasherVtOutcome> {
		if (state !== undefined && WASHER_VT_IDLE_STATES.includes(state)) {
			return this.noop(reading, 'the washer is not in a wash cycle');
		}
		const refusal = checkWasherVtGuard('vt-power-off', reading.fields, reading.online, this.options.allowCancelCycle);
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		return this.cancel(reading, state);
	}

	/** Pause first when running, then power off: the LG app's own way to cancel a wash. */
	private async cancel(reading: WasherVtReading, state: string | undefined): Promise<WasherVtOutcome> {
		let current = reading;
		if (state !== undefined && state !== 'PAUSE' && !WASHER_VT_IDLE_STATES.includes(state)) {
			const paused = (await this.sendAndConfirm('vt-pause', reading, this.pollAttempts)).outcome;
			if (paused.status !== 'done') {
				return { ...paused, message: `${paused.message} The washer may be paused.` };
			}
			const reread = await this.read();
			if ('status' in reread) {
				return reread;
			}
			current = reread;
		}
		const refusal = checkWasherVtGuard('vt-power-off', current.fields, current.online, true);
		if (refusal?.code === 'ALREADY_POWEROFF') {
			return this.noop(current, 'the washer is already off');
		}
		if (refusal) {
			return this.refuse(refusal, current);
		}
		return (await this.sendAndConfirm('vt-power-off', current, this.powerPollAttempts)).outcome;
	}

	private async pause(reading: WasherVtReading, state: string | undefined): Promise<WasherVtOutcome> {
		if (state === 'PAUSE') {
			return this.noop(reading, 'the washer is already paused');
		}
		const refusal = checkWasherVtGuard('vt-pause', reading.fields, reading.online);
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		return (await this.sendAndConfirm('vt-pause', reading, this.pollAttempts)).outcome;
	}

	private async resume(reading: WasherVtReading, state: string | undefined): Promise<WasherVtOutcome> {
		if (state !== undefined && WASHER_VT_RUNNING_STATES.includes(state)) {
			return this.noop(reading, 'the washer is already running');
		}
		if (this.isStartLockedOut()) {
			return this.refuseLockedOut(reading);
		}
		const refusal = checkWasherVtGuard('vt-resume', reading.fields, reading.online);
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		return (await this.sendAndConfirm('vt-resume', reading, this.pollAttempts)).outcome;
	}

	private async start(reading: WasherVtReading, state: string | undefined): Promise<WasherVtOutcome> {
		if (state !== undefined && WASHER_VT_RUNNING_STATES.includes(state)) {
			return this.noop(reading, 'the washer is already running');
		}
		const remoteStart = parseWasherField(reading.fields, 'remoteStart');
		if (state === 'INITIAL' && remoteStart !== 'REMOTE_START_ON') {
			return this.stageCourse(reading, remoteStart);
		}
		if (this.isStartLockedOut()) {
			return this.refuseLockedOut(reading);
		}
		const refusal = checkWasherVtGuard('vt-start', reading.fields, reading.online);
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		return (await this.sendAndConfirm('vt-start', reading, this.pollAttempts)).outcome;
	}

	/** Remote Control is OFF: the only moment the washer accepts a course. Never sends `wmControl`. */
	private async stageCourse(reading: WasherVtReading, remoteStart: unknown): Promise<WasherVtOutcome> {
		const remoteOff: WasherVtOutcome = { status: 'refused', message: MSG_REMOTE_OFF, snapshot: reading.snapshot };
		if (remoteStart !== 'REMOTE_START_OFF') {
			this.logger.warn(`ThinQ Washer ${this.label}: refused, Remote Control state unreadable or unknown`);
			return remoteOff;
		}
		const refusal = checkWasherVtGuard('vt-course', reading.fields, reading.online);
		if (refusal) {
			return this.refuse(refusal, reading);
		}
		const stagePlan = this.homeSelection ?? this.options.stagePlan;
		if (stagePlan === undefined) {
			this.logger.warn(`ThinQ Washer ${this.label}: no valid Selected Wash Course configured, nothing staged`);
			return remoteOff;
		}
		const refusedStage = this.refusedCarriedKeys(stagePlan.options, {});
		for (const key of refusedStage) {
			this.logger.warn(
				`ThinQ Washer ${this.label}: leaving ${key}=${stagePlan.options[key]} out of the staged course, the washer refuses that value`,
			);
		}
		const stageOptions = withoutKeys(stagePlan.options, refusedStage);
		if (isWasherVtCourseApplied(reading.fields, stagePlan.courseId, stageOptions)) {
			this.logger.info(`ThinQ Washer ${this.label}: course ${stagePlan.courseId} already selected, nothing staged`);
			return { ...remoteOff, message: `Course ${stagePlan.courseId} is already selected. ${MSG_REMOTE_OFF}` };
		}

		const result = await this.sendAndConfirm(
			'vt-course',
			reading,
			this.pollAttempts,
			(fields) => isWasherVtCourseApplied(fields, stagePlan.courseId, stageOptions),
			undefined,
			{ courseId: stagePlan.courseId, options: stageOptions },
		);
		if (result.outcome.status === 'done') {
			return {
				status: 'staged',
				message: `Course ${stagePlan.courseId} is now selected on the washer. Press the Remote Control button on the washer for 3 seconds, then tap Start again.`,
				snapshot: result.outcome.snapshot,
			};
		}
		if (result.outcome.status === 'unconfirmed') {
			const rejected = rejectedWasherVtCells(result.reply);
			return {
				status: 'unconfirmed',
				message: `LG did not apply the course (${rejected.length > 0 ? rejected.join(', ') : 'no change'}). Check the course settings in the plugin.`,
				snapshot: result.outcome.snapshot,
			};
		}
		return result.outcome;
	}

	private isStartLockedOut(): boolean {
		return this.ports.now() < this.startLockedUntil;
	}

	private refuseLockedOut(reading: WasherVtReading): WasherVtOutcome {
		this.logger.warn(`ThinQ Washer ${this.label}: refused, Start/Resume lock-out is active`);
		return { status: 'refused', message: MSG_LOCKOUT, snapshot: reading.snapshot };
	}

	private async sendWithTimeout(body: WasherVtBody): Promise<unknown> {
		let timer: NodeJS.Timeout | undefined;
		const sending = this.ports.send(body);
		sending.catch(() => undefined);
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error(`no answer from LG within ${this.sendTimeoutMs / 1000} s`)),
				this.sendTimeoutMs,
			);
		});
		try {
			return await Promise.race([sending, timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** Sends once (never retried), then polls like the LG app. Success is decided by the washer state, never by the reply alone. */
	private async sendAndConfirm(
		name: WasherVtSendName | 'osp-wake',
		before: WasherVtReading,
		attempts: number,
		confirm?: (fields: WasherFields) => boolean,
		bodyOverride?: WasherVtBody,
		stageOverride?: WasherVtSendStage,
	): Promise<SendResult> {
		const stage = stageOverride ?? (name === 'vt-course' ? this.options.stagePlan : undefined);
		const body = bodyOverride ?? buildWasherVtBody(name as WasherVtSendName, stage?.courseId, stage?.options ?? {});
		const cells =
			bodyOverride === undefined
				? buildWasherVtCells(name as WasherVtSendName, stage?.courseId, stage?.options ?? {})
						.map((cell) => `${cell.cmd}=${cell.value}`)
						.join(', ')
				: `${body.ctrlKey} ${JSON.stringify(body.dataSetList ?? body.dataValue ?? null)}`;
		const isConfirmed = (fields: WasherFields): boolean =>
			confirm === undefined ? isWasherVtExpectedState(name as WasherVtSendName, fields) : confirm(fields);
		this.logger.info(
			`ThinQ Washer ${this.label}: sending ${name} (${cells}), state before=${stateOf(before.fields) ?? 'unknown'}`,
		);

		let reply: unknown;
		let resultCode: string | undefined;
		let sendError: unknown;
		try {
			reply = await this.sendWithTimeout(body);
			resultCode = parseResultCode(reply);
		} catch (error) {
			sendError = error;
			resultCode = describeSendFailure(error).resultCode;
		}

		const acks = extractWasherVtReturnCodes(reply);
		this.logger.info(
			`ThinQ Washer ${this.label}: ${name} reply resultCode=${resultCode ?? 'none'}${sendError === undefined ? '' : ` (send error: ${errorText(sendError)})`}${acks.length > 0 ? `, vtAck ${acks.join(', ')}` : ''}`,
		);

		if (resultCode !== undefined && resultCode !== '0000' && resultCode !== '0111') {
			return {
				outcome: {
					status: 'failed',
					message: `LG refused the command (${resultCode}: ${describeThinqResultCode(resultCode)}).`,
					snapshot: before.snapshot,
				},
				reply,
			};
		}

		const poll = await pollWasherUntil<WasherVtReading | undefined>(
			() => this.ports.readReading(),
			(reading) => reading !== undefined && isConfirmed(reading.fields),
			(ms) => this.ports.sleep(ms),
			attempts,
			this.pollIntervalMs,
		);
		const last = poll.value ?? before;
		const after = stateOf(last.fields) ?? 'unknown';
		this.logger.info(
			`ThinQ Washer ${this.label}: ${name} ${poll.done ? 'confirmed' : 'not confirmed'} after ${poll.polls} poll(s), state after=${after}`,
		);

		if (poll.done) {
			return { outcome: { status: 'done', message: `${name} confirmed`, snapshot: last.snapshot }, reply };
		}

		if (name === 'vt-start' || name === 'vt-resume') {
			this.startLockedUntil = this.ports.now() + this.startLockoutMs;
		}
		const message =
			sendError === undefined
				? `LG accepted the command but the washer did not change state (${after}). Check the washer before trying again.`
				: `The command may not have reached the washer (${errorText(sendError)}). Check the washer before trying again.`;
		return { outcome: { status: 'unconfirmed', message, snapshot: last.snapshot }, reply };
	}
}
