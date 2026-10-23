import { AnsiLogger } from 'matterbridge/logger';

import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';
import {
	describeSendFailure,
	describeThinqResultCode,
	parseResultCode,
	parseWasherField,
	type WasherFields,
} from './thinqWasherFields.js';
import {
	buildWasherVtBody,
	buildWasherVtCells,
	checkWasherVtGuard,
	extractWasherVtReturnCodes,
	formatWasherVtRefusalForHome,
	isWasherVtCourseApplied,
	isWasherVtExpectedState,
	pollWasherUntil,
	rejectedWasherVtCells,
	WASHER_POLL_ATTEMPTS,
	WASHER_POLL_INTERVAL_MS,
	WASHER_VT_IDLE_STATES,
	WASHER_VT_POWER_POLL_ATTEMPTS,
	WASHER_VT_RUNNING_STATES,
	WASHER_VT_SEND_TIMEOUT_MS,
	WASHER_VT_START_LOCKOUT_MS,
	type WasherVtBody,
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
	readonly sendTimeoutMs?: number;
	readonly pollAttempts?: number;
	readonly powerPollAttempts?: number;
	readonly pollIntervalMs?: number;
	readonly startLockoutMs?: number;
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
const MSG_REMOTE_OFF = 'Press the Remote Control button on the washer for 3 seconds, then tap Start again.';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function stateOf(fields: WasherFields): string | undefined {
	const state = parseWasherField(fields, 'state');
	return typeof state === 'string' ? state : undefined;
}

export class WasherVtController {
	private inFlight = false;
	private startLockedUntil = 0;

	private readonly sendTimeoutMs: number;
	private readonly pollAttempts: number;
	private readonly powerPollAttempts: number;
	private readonly pollIntervalMs: number;
	private readonly startLockoutMs: number;

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
	}

	/** Never throws. `done` and `noop` are success; every other status is a refusal or failure for the caller to surface. */
	public async run(action: WasherVtAction): Promise<WasherVtOutcome> {
		if (this.inFlight) {
			this.logger.warn(`ThinQ Washer ${this.label}: '${action}' refused, another command is running`);
			return { status: 'refused', message: MSG_BUSY };
		}
		this.inFlight = true;
		try {
			return await this.execute(action);
		} catch (error) {
			this.logger.error(`ThinQ Washer ${this.label}: '${action}' failed unexpectedly: ${errorText(error)}`);
			return { status: 'failed', message: `Could not control the washer: ${errorText(error)}` };
		} finally {
			this.inFlight = false;
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
		return (await this.sendAndConfirm('vt-power-on', reading, this.powerPollAttempts)).outcome;
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
		const { stagePlan } = this.options;
		if (stagePlan === undefined) {
			this.logger.warn(`ThinQ Washer ${this.label}: no valid Selected Wash Course configured, nothing staged`);
			return remoteOff;
		}
		if (isWasherVtCourseApplied(reading.fields, stagePlan.courseId, stagePlan.options)) {
			this.logger.info(`ThinQ Washer ${this.label}: course ${stagePlan.courseId} already selected, nothing staged`);
			return { ...remoteOff, message: `Course ${stagePlan.courseId} is already selected. ${MSG_REMOTE_OFF}` };
		}

		const result = await this.sendAndConfirm('vt-course', reading, this.pollAttempts, (fields) =>
			isWasherVtCourseApplied(fields, stagePlan.courseId, stagePlan.options),
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
		name: WasherVtSendName,
		before: WasherVtReading,
		attempts: number,
		confirm: (fields: WasherFields) => boolean = (fields) => isWasherVtExpectedState(name, fields),
	): Promise<SendResult> {
		const stage = name === 'vt-course' ? this.options.stagePlan : undefined;
		const body = buildWasherVtBody(name, stage?.courseId, stage?.options ?? {});
		const cells = buildWasherVtCells(name, stage?.courseId, stage?.options ?? {})
			.map((cell) => `${cell.cmd}=${cell.value}`)
			.join(', ');
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
			(reading) => reading !== undefined && confirm(reading.fields),
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
