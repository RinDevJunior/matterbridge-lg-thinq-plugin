import type { AnsiLogger } from 'matterbridge/logger';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WasherCourseOptions } from '../../../platform/thinq/thinqWasherMatterPlan.js';
import {
	WasherVtController,
	type WasherVtOutcome,
	type WasherVtPorts,
	type WasherVtReading,
} from '../../../platform/thinq/thinqWasherVtController.js';
import {
	WASHER_VT_IDLE_STATES,
	WASHER_VT_RUNNING_STATES,
	WASHER_VT_SEND_TIMEOUT_MS,
	WASHER_VT_START_LOCKOUT_MS,
	type WasherVtBody,
} from '../../../platform/thinq/thinqWasherVtCtrl.js';
import type { WasherVtStagePlan } from '../../../platform/thinq/thinqWasherVtStagePlan.js';
import { createMockLogger } from '../../helpers/testUtils.js';
import { washerReading, washerVtReply } from '../../helpers/washerFixtures.js';

type ReadStep = WasherVtReading | undefined | Error;
type SendFn = (body: WasherVtBody) => Promise<unknown>;

/** Fields of a washer that passes every `start` rule: door closed, Remote Control ON, course NORMAL staged. */
const BASE_FIELDS = {
	state: 'INITIAL',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
	remoteStart: 'REMOTE_START_ON',
	doorClose: 'DOORCLOSE_ON',
	course: 'NORMAL',
	spin: 'SPIN_1400',
	temp: 'TEMP_40',
	rinse: 'RINSE_2',
	soilWash: 'SOILWASH_NORMAL',
};

function washer(overrides: Record<string, unknown> = {}, online: boolean | undefined = true): WasherVtReading {
	return washerReading({ ...BASE_FIELDS, ...overrides }, { online });
}

const REMOTE_OFF = { remoteStart: 'REMOTE_START_OFF' };
const STAGE_PLAN: WasherVtStagePlan = { courseId: 'NORMAL', options: { spin: 'SPIN_1000' }, ignoredOptions: [] };
const MSG_LOCKOUT =
	'A Start was sent a moment ago and the washer has not confirmed it. Check the washer before trying again.';
const MSG_BUSY = 'Another washer command is still running. Wait a few seconds.';
const MSG_REMOTE_OFF = 'Press the Remote Control button on the washer for 3 seconds, then tap Start again.';

/** The model's own ospWakeup body (what switches an off washer on). */
const DEFAULT_WAKE_BODY: WasherVtBody = {
	ctrlKey: 'ospWakeup',
	command: 'Set',
	dataSetList: { washerDryer: { ospWakeupType: 'WAKEUP_AND_PWR_ON', ospWakeUpData: 0 } },
};
const MSG_NO_WAKE =
	'This washer model has no wake-up command, so Home cannot switch it on. Use the power button on the washer.';

interface Harness {
	readonly controller: WasherVtController;
	readonly logger: AnsiLogger;
	readonly read: Mock<() => Promise<WasherVtReading | undefined>>;
	readonly send: Mock<SendFn>;
	readonly sleep: Mock<(ms: number) => Promise<void>>;
	readonly events: string[];
	setSteps(steps: readonly ReadStep[]): void;
	clock: { now: number };
}

interface HarnessOptions {
	readonly allowCancelCycle?: boolean;
	readonly stagePlan?: WasherVtStagePlan;
	readonly now?: () => number;
	readonly label?: string;
	/** `null` simulates a model without ControlWifi.ospWakeup. */
	readonly wakeBody?: WasherVtBody | null;
	readonly resolveCourseOptions?: (courseId: string) => WasherCourseOptions | undefined;
	readonly omitCourseCellWhenUnchanged?: boolean;
}

/** Fake ports: reads follow `steps` (last one repeats), sends resolve with a `0000` reply unless a test overrides them. */
function createHarness(steps: readonly ReadStep[], options: HarnessOptions = {}): Harness {
	const events: string[] = [];
	const clock = { now: 1_000_000 };
	let script = steps;
	let index = 0;

	const read = vi.fn<() => Promise<WasherVtReading | undefined>>(() => {
		events.push('read');
		const step = script[Math.min(index, script.length - 1)];
		index += 1;
		if (step instanceof Error) {
			return Promise.reject(step);
		}
		return Promise.resolve(step);
	});
	const send = vi.fn<SendFn>((body) => {
		events.push(`send:${JSON.stringify(body)}`);
		return Promise.resolve(washerVtReply('0000'));
	});
	const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
	const ports: WasherVtPorts = {
		readReading: read,
		send,
		sleep,
		now: options.now ?? (() => clock.now),
	};
	const logger = createMockLogger();
	const controller = new WasherVtController(options.label ?? 'ab12', ports, logger, {
		allowCancelCycle: options.allowCancelCycle ?? false,
		wakeBody: options.wakeBody === null ? undefined : (options.wakeBody ?? DEFAULT_WAKE_BODY),
		stagePlan: options.stagePlan,
		resolveCourseOptions: options.resolveCourseOptions,
		omitCourseCellWhenUnchanged: options.omitCourseCellWhenUnchanged,
	});

	return {
		controller,
		logger,
		read,
		send,
		sleep,
		events,
		setSteps(next) {
			script = next;
			index = 0;
		},
		clock,
	};
}

/** JSON of every send call, for substring checks on the cells that were sent. */
function sentJson(send: Mock<SendFn>): string {
	return JSON.stringify(send.mock.calls);
}

/** The `dataSetList` a `vtCtrl` body carries for exactly these cells (every cell is ABSOLUTE). */
function vtDataSetList(cells: readonly { cmd: string; value: string }[]): unknown {
	return {
		ctrlTarget: ['UNDEFINE'],
		reqDevType: 'APP',
		productType: 'NORMAL',
		vtData: { UNDEFINE: cells.map((cell) => ({ ...cell, type: 'ABSOLUTE' })) },
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('WasherVtController', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	describe('power-on', () => {
		it('should send the model ospWakeup body once and report done when the washer leaves POWEROFF', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' }), washer({ state: 'INITIAL' })]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('done');
			expect(outcome.snapshot).toBeDefined();
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]).toEqual(DEFAULT_WAKE_BODY);
		});

		it('should report noop and send nothing when the washer is already on', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'INITIAL' })]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the Home offline text and send nothing when the washer is offline', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' }, false)]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message: 'The washer is offline in the LG cloud. Check its Wi-Fi.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the not-found text when the washer is missing from the account', async () => {
			// Arrange
			const harness = createHarness([undefined]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome).toEqual({ status: 'refused', message: 'The washer was not found in the LG account.' });
		});

		it('should fail with the unreadable-state text when the read rejects', async () => {
			// Arrange
			const harness = createHarness([new Error('timeout')]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome).toEqual({
				status: 'failed',
				message: 'Cannot read the washer state from LG. Try again in a minute.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});
	});

	describe('power-on wake body', () => {
		it('should send no vtCtrl power cell and no vtData in the wake body', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' }), washer({ state: 'INITIAL' })]);
			// Act
			await harness.controller.run('power-on');
			// Assert
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({ ctrlKey: 'ospWakeup' });
			expect(sentJson(harness.send)).not.toContain('POWER_ON');
			expect(sentJson(harness.send)).not.toContain('vtData');
		});

		it('should poll until the state leaves POWEROFF', async () => {
			// Arrange
			const harness = createHarness([
				washer({ state: 'POWEROFF' }),
				washer({ state: 'POWEROFF' }),
				washer({ state: 'INITIAL' }),
			]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.read).toHaveBeenCalledTimes(3);
		});

		it('should not count an unreadable state after the wake send as success', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' }), washer({ state: undefined })]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.read).toHaveBeenCalledTimes(17);
		});

		it('should still confirm when a later reading shows a real non-POWEROFF state after unreadable ones', async () => {
			// Arrange
			const harness = createHarness([
				washer({ state: 'POWEROFF' }),
				washer({ state: undefined }),
				washer({ state: 'INITIAL' }),
			]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should verify a 0111 reply by the state and report done when the washer woke', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' }), washer({ state: 'INITIAL' })]);
			harness.send.mockResolvedValueOnce(washerVtReply('0111'));
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('done');
		});

		it('should report unconfirmed and not retry when the state never leaves POWEROFF', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' })]);
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.read).toHaveBeenCalledTimes(17);
		});

		it('should time out a silent send, poll, and report unconfirmed', async () => {
			// Arrange
			vi.useFakeTimers();
			const harness = createHarness([washer({ state: 'POWEROFF' })]);
			harness.send.mockImplementationOnce(() => new Promise<unknown>(() => undefined));
			// Act
			const pending = harness.controller.run('power-on');
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(WASHER_VT_SEND_TIMEOUT_MS);
			const outcome = await pending;
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toContain('no answer from LG within 10 s');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should release the in-flight lock so a later On proceeds', async () => {
			// Arrange
			const harness = createHarness([
				washer({ state: 'POWEROFF' }),
				washer({ state: 'INITIAL' }),
				washer({ state: 'POWEROFF' }),
				washer({ state: 'INITIAL' }),
			]);
			// Act
			const first = await harness.controller.run('power-on');
			const second = await harness.controller.run('power-on');
			// Assert
			expect(first.status).toBe('done');
			expect(second.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it.each(['INITIAL', 'RUNNING', 'END'])(
			'should send nothing and report noop when the state is %s',
			async (state) => {
				// Arrange
				const harness = createHarness([washer({ state })]);
				// Act
				const outcome = await harness.controller.run('power-on');
				// Assert
				expect(outcome.status).toBe('noop');
				expect(harness.send).not.toHaveBeenCalled();
			},
		);

		it('should refuse with the wake-up text and send nothing when the model has no ospWakeup', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' })], { wakeBody: null });
			// Act
			const outcome = await harness.controller.run('power-on');
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_NO_WAKE });
			expect(harness.send).not.toHaveBeenCalled();
		});
	});

	describe('power-off', () => {
		it.each(['INITIAL', 'END', 'ERROR'])(
			'should send one power=POWER_OFF and confirm on POWEROFF when the washer is %s',
			async (state) => {
				// Arrange
				const harness = createHarness([washer({ state }), washer({ state: 'POWEROFF' })]);
				// Act
				const outcome = await harness.controller.run('power-off');
				// Assert
				expect(outcome.status).toBe('done');
				expect(harness.send).toHaveBeenCalledTimes(1);
				expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
					dataSetList: { vtData: { UNDEFINE: [{ cmd: 'power', value: 'POWER_OFF' }] } },
				});
			},
		);

		it('should report noop and send nothing when the washer is already POWEROFF', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' })]);
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the cancel text and send nothing when RUNNING without allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'RUNNING' })]);
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message:
					'The washer is RUNNING. Turning it off would cancel the wash. Pause it, or allow cancelling in the plugin settings.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse and send nothing when PAUSEd without allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'PAUSE' })]);
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should pause, confirm, then power off in that order when RUNNING with allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness(
				[
					washer({ state: 'RUNNING' }),
					washer({ state: 'PAUSE' }),
					washer({ state: 'PAUSE' }),
					washer({ state: 'POWEROFF' }),
				],
				{ allowCancelCycle: true },
			);
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
			expect(harness.events).toEqual([
				'read',
				expect.stringContaining('wmControl'),
				'read',
				'read',
				expect.stringContaining('POWER_OFF'),
				'read',
			]);
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: { vtData: { UNDEFINE: [{ cmd: 'wmControl', value: 'PAUSE' }] } },
			});
		});

		it('should send one power=POWER_OFF from COMPLETE without allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'COMPLETE' }), washer({ state: 'POWEROFF' })]);
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(sentJson(harness.send)).toContain('POWER_OFF');
		});

		it('should return the unconfirmed pause with the may-be-paused suffix and not power off', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'RUNNING' })], { allowCancelCycle: true });
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toContain('The washer may be paused.');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(sentJson(harness.send)).not.toContain('POWER_OFF');
		});

		it('should send only power=POWER_OFF when PAUSEd with allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'PAUSE' }), washer({ state: 'POWEROFF' })], {
				allowCancelCycle: true,
			});
			// Act
			const outcome = await harness.controller.run('power-off');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(sentJson(harness.send)).toContain('POWER_OFF');
		});
	});

	describe('stop', () => {
		it.each(WASHER_VT_IDLE_STATES)('should report noop and send nothing when the washer is %s', async (state) => {
			// Arrange
			const harness = createHarness([washer({ state })]);
			// Act
			const outcome = await harness.controller.run('stop');
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse and send nothing when PAUSEd without allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'PAUSE' })]);
			// Act
			const outcome = await harness.controller.run('stop');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse and send nothing for an unknown state without allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'WEIRD_STATE' })]);
			// Act
			const outcome = await harness.controller.run('stop');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should pause then power off for an unknown state with allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness(
				[
					washer({ state: 'WEIRD_STATE' }),
					washer({ state: 'PAUSE' }),
					washer({ state: 'PAUSE' }),
					washer({ state: 'POWEROFF' }),
				],
				{ allowCancelCycle: true },
			);
			// Act
			const outcome = await harness.controller.run('stop');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
			expect(sentJson(harness.send).indexOf('PAUSE')).toBeLessThan(sentJson(harness.send).indexOf('POWER_OFF'));
		});

		it.each(WASHER_VT_RUNNING_STATES)(
			'should refuse with the cancel text and send nothing for running state %s without allowCancelCycle',
			async (state) => {
				// Arrange
				const harness = createHarness([washer({ state })]);
				// Act
				const outcome = await harness.controller.run('stop');
				// Assert
				expect(outcome).toMatchObject({
					status: 'refused',
					message: `The washer is ${state}. Turning it off would cancel the wash. Pause it, or allow cancelling in the plugin settings.`,
				});
				expect(harness.send).not.toHaveBeenCalled();
			},
		);

		it('should refuse with the cancel text and send nothing for unknown state WEIRD_STATE without allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'WEIRD_STATE' })]);
			// Act
			const outcome = await harness.controller.run('stop');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message:
					'The washer is WEIRD_STATE. Turning it off would cancel the wash. Pause it, or allow cancelling in the plugin settings.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should run the pause then power-off cancel flow for a running state with allowCancelCycle', async () => {
			// Arrange
			const harness = createHarness(
				[
					washer({ state: 'SOAKING' }),
					washer({ state: 'PAUSE' }),
					washer({ state: 'PAUSE' }),
					washer({ state: 'POWEROFF' }),
				],
				{ allowCancelCycle: true },
			);
			// Act
			const outcome = await harness.controller.run('stop');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});
	});

	describe('pause', () => {
		it.each(WASHER_VT_RUNNING_STATES)(
			'should send one wmControl=PAUSE and confirm when running state is %s',
			async (state) => {
				// Arrange
				const harness = createHarness([washer({ state }), washer({ state: 'PAUSE' })]);
				// Act
				const outcome = await harness.controller.run('pause');
				// Assert
				expect(outcome.status).toBe('done');
				expect(harness.send).toHaveBeenCalledTimes(1);
				expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
					dataSetList: { vtData: { UNDEFINE: [{ cmd: 'wmControl', value: 'PAUSE' }] } },
				});
			},
		);

		it('should report noop when the washer is already PAUSE', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'PAUSE' })]);
			// Act
			const outcome = await harness.controller.run('pause');
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse and send nothing when the washer is INITIAL', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'INITIAL' })]);
			// Act
			const outcome = await harness.controller.run('pause');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the washer-off text when the washer is POWEROFF', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'POWEROFF' })]);
			// Act
			const outcome = await harness.controller.run('pause');
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: 'The washer is off. Turn it on first.' });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the child lock text when the child lock is on', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'RUNNING', childLock: 'CHILDLOCK_ON' })]);
			// Act
			const outcome = await harness.controller.run('pause');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message: 'Child lock is on. Turn it off on the washer first.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the error text when the washer reports an error', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'RUNNING', error: 'ERROR_DOOR' })]);
			// Act
			const outcome = await harness.controller.run('pause');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message: 'The washer shows an error. Clear it on the washer first.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});
	});

	describe('resume', () => {
		it('should send one wmControl=RESUME and confirm when the washer is PAUSE', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'PAUSE' }), washer({ state: 'RUNNING' })]);
			// Act
			const outcome = await harness.controller.run('resume');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: { vtData: { UNDEFINE: [{ cmd: 'wmControl', value: 'RESUME' }] } },
			});
		});

		it('should report noop when the washer is already running', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'RUNNING' })]);
			// Act
			const outcome = await harness.controller.run('resume');
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse and send nothing when the washer is INITIAL', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'INITIAL' })]);
			// Act
			const outcome = await harness.controller.run('resume');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should send RESUME (not START) when start is requested while PAUSE', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'PAUSE' }), washer({ state: 'RUNNING' })]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
			expect(sentJson(harness.send)).toContain('RESUME');
			expect(sentJson(harness.send)).not.toContain('"value":"START"');
		});
	});

	describe('start, stage branch (Remote Control OFF)', () => {
		it('should send only the course cells and report staged when the course is not applied yet', async () => {
			// Arrange
			const harness = createHarness(
				[washer({ ...REMOTE_OFF, course: 'COTTON' }), washer({ ...REMOTE_OFF, course: 'NORMAL', spin: 'SPIN_1000' })],
				{ stagePlan: STAGE_PLAN },
			);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome).toMatchObject({
				status: 'staged',
				message:
					'Course NORMAL is now selected on the washer. Press the Remote Control button on the washer for 3 seconds, then tap Start again.',
			});
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'NORMAL' },
							{ cmd: 'spin', value: 'SPIN_1000' },
						],
					},
				},
			});
			expect(sentJson(harness.send)).not.toContain('wmControl');
		});

		it('should refuse without sending when the course is already applied', async () => {
			// Arrange
			const harness = createHarness([washer({ ...REMOTE_OFF, course: 'NORMAL', spin: 'SPIN_1000' })], {
				stagePlan: STAGE_PLAN,
			});
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message: `Course NORMAL is already selected. ${MSG_REMOTE_OFF}`,
			});
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the Remote Control text and send nothing when no stage plan exists', async () => {
			// Arrange
			const harness = createHarness([washer(REMOTE_OFF)]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_REMOTE_OFF });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should report unconfirmed with the rejected cell when the course never applies', async () => {
			// Arrange
			const harness = createHarness([washer({ ...REMOTE_OFF, course: 'COTTON' })], { stagePlan: STAGE_PLAN });
			harness.send.mockResolvedValueOnce(
				washerVtReply('0000', [
					['course', '0'],
					['temp', '15'],
				]),
			);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toBe('LG did not apply the course (temp=15). Check the course settings in the plugin.');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it.each([
			['absent', {}],
			['unknown value', { remoteStart: 'REMOTE_START_MAYBE' }],
		])('should refuse with the Remote Control text when remoteStart is %s', async (_label, overrides) => {
			// Arrange
			const fields = { ...BASE_FIELDS, remoteStart: undefined, ...overrides };
			const harness = createHarness([washerReading(fields, { online: true })], { stagePlan: STAGE_PLAN });
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_REMOTE_OFF });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the child lock text and send nothing in the stage branch', async () => {
			// Arrange
			const harness = createHarness([washer({ ...REMOTE_OFF, childLock: 'CHILDLOCK_ON' })], { stagePlan: STAGE_PLAN });
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the error text and send nothing in the stage branch', async () => {
			// Arrange
			const harness = createHarness([washer({ ...REMOTE_OFF, error: 'ERROR_DOOR' })], { stagePlan: STAGE_PLAN });
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse with the offline text and send nothing when offline in the stage branch', async () => {
			// Arrange
			const harness = createHarness([washer(REMOTE_OFF, false)], { stagePlan: STAGE_PLAN });
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				message: 'The washer is offline in the LG cloud. Check its Wi-Fi.',
			});
			expect(harness.send).not.toHaveBeenCalled();
		});
	});

	describe('start, stage branch refused-value protection', () => {
		const STAGE_NORMAL_OPTIONS: WasherCourseOptions = {
			soilWash: { values: ['SOILWASH_NORMAL', 'SOILWASH_HEAVY'], defaultValue: 'SOILWASH_NORMAL', writable: true },
			rinse: { values: ['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3'], defaultValue: 'RINSE_2', writable: true },
			spin: { values: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'], defaultValue: 'SPIN_1400', writable: true },
			temp: { values: ['TEMP_COLD', 'TEMP_40', 'TEMP_60'], defaultValue: 'TEMP_40', writable: true },
		};

		it('should stage the course without the refused temperature and warn when the configured plan carries it', async () => {
			// Arrange
			const plan: WasherVtStagePlan = { courseId: 'NORMAL', options: { temp: 'TEMP_COLD' }, ignoredOptions: [] };
			const harness = createHarness(
				[washer({ ...REMOTE_OFF, course: 'COTTON' }), washer({ ...REMOTE_OFF, course: 'NORMAL' })],
				{ stagePlan: plan },
			);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('staged');
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([{ cmd: 'course', value: 'NORMAL' }]),
			);
			expect(vi.mocked(harness.logger.warn)).toHaveBeenCalledWith(expect.stringContaining('temp=TEMP_COLD'));
		});

		it('should report the course as already selected without sending when the filtered plan already matches', async () => {
			// Arrange
			const plan: WasherVtStagePlan = { courseId: 'NORMAL', options: { temp: 'TEMP_COLD' }, ignoredOptions: [] };
			const harness = createHarness([washer({ ...REMOTE_OFF, course: 'NORMAL', temp: 'TEMP_40' })], {
				stagePlan: plan,
			});
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.message).toContain('Course NORMAL is already selected');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should stage the Home selection without its refused temperature and report staged', async () => {
			// Arrange
			const harness = createHarness(
				[
					washer({ ...REMOTE_OFF, course: 'NORMAL', temp: 'TEMP_COLD' }),
					washer({ ...REMOTE_OFF, course: 'NORMAL', temp: 'TEMP_COLD', spin: 'SPIN_1000' }),
				],
				{
					resolveCourseOptions: (courseId) => (courseId === 'NORMAL' ? STAGE_NORMAL_OPTIONS : undefined),
					omitCourseCellWhenUnchanged: true,
				},
			);
			const applied = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			harness.setSteps([
				washer({ ...REMOTE_OFF, course: 'COTTON', temp: 'TEMP_40', spin: 'SPIN_800' }),
				washer({ ...REMOTE_OFF, course: 'NORMAL', temp: 'TEMP_COLD', spin: 'SPIN_1000' }),
			]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(applied.status).toBe('done');
			expect(outcome.status).toBe('staged');
			expect(harness.send.mock.calls[1]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([
					{ cmd: 'course', value: 'NORMAL' },
					{ cmd: 'soilWash', value: 'SOILWASH_NORMAL' },
					{ cmd: 'rinse', value: 'RINSE_2' },
					{ cmd: 'spin', value: 'SPIN_1000' },
				]),
			);
		});
	});

	describe('start, send branch (Remote Control ON)', () => {
		it('should send one wmControl=START and report done when the washer goes DETECTING', async () => {
			// Arrange
			const harness = createHarness([washer(), washer({ state: 'DETECTING' })]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: { vtData: { UNDEFINE: [{ cmd: 'wmControl', value: 'START' }] } },
			});
		});

		it('should send one START when the door is closed by doorLock only', async () => {
			// Arrange
			const harness = createHarness([
				washer({ doorClose: 'DOORCLOSE_OFF', doorLock: 'DOORLOCK_ON' }),
				washer({ state: 'DETECTING' }),
			]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it.each([
			[
				'door not closed',
				{ doorClose: 'DOORCLOSE_OFF', doorLock: 'DOORLOCK_OFF' },
				'The washer door is not closed. Close it first.',
			],
			['child lock on', { childLock: 'CHILDLOCK_ON' }, 'Child lock is on. Turn it off on the washer first.'],
			['error present', { error: 'ERROR_DOOR' }, 'The washer shows an error. Clear it on the washer first.'],
			[
				'no course staged',
				{ course: 'NOT_SELECTED' },
				'No course is selected on the washer. Pick a Selected Wash Course in the plugin settings.',
			],
			['state POWEROFF', { state: 'POWEROFF' }, 'The washer is off. Turn it on first.'],
			['state END', { state: 'END' }, 'The washer is END. Start works only when it is ready.'],
		])('should refuse without sending when %s', async (_label, overrides, message) => {
			// Arrange
			const harness = createHarness([washer(overrides)]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse without sending when offline', async () => {
			// Arrange
			const harness = createHarness([washer({}, false)]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should report noop and send nothing when the washer is already running', async () => {
			// Arrange
			const harness = createHarness([washer({ state: 'DETECTING' })]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});
	});

	describe('result handling', () => {
		it('should report done when LG answers 0111 and the state changes on poll', async () => {
			// Arrange
			const harness = createHarness([washer(), washer({ state: 'DETECTING' })]);
			harness.send.mockResolvedValueOnce(washerVtReply('0111'));
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
		});

		it('should report unconfirmed when LG answers 0111 and the state never changes', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			harness.send.mockResolvedValueOnce(washerVtReply('0111'));
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should report unconfirmed when LG answers 0000 and the state never changes', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toBe(
				'LG accepted the command but the washer did not change state (INITIAL). Check the washer before trying again.',
			);
		});

		it.each(['0110', '0114'])(
			'should fail without polling when the reply carries definite rejection %s',
			async (code) => {
				// Arrange
				const harness = createHarness([washer()]);
				harness.send.mockResolvedValueOnce(washerVtReply(code));
				// Act
				const outcome = await harness.controller.run('start');
				// Assert
				expect(outcome.status).toBe('failed');
				expect(outcome.message).toContain(`LG refused the command (${code}: `);
				expect(harness.read).toHaveBeenCalledTimes(1);
			},
		);

		it('should fail without polling when a rejected send carries response.data.resultCode 0110', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			harness.send.mockRejectedValueOnce(
				Object.assign(new Error('Request failed with status code 400'), {
					response: { status: 400, data: { resultCode: '0110' } },
				}),
			);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('failed');
			expect(outcome.message).toContain('LG refused the command (0110: ');
			expect(harness.read).toHaveBeenCalledTimes(1);
		});

		it('should poll and then report unconfirmed when the send fails at network level', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			harness.send.mockRejectedValueOnce(new Error('socket hang up'));
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toBe(
				'The command may not have reached the washer (socket hang up). Check the washer before trying again.',
			);
			expect(harness.read.mock.calls.length).toBeGreaterThan(1);
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should time out a send that never resolves, poll, and report unconfirmed', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			harness.send.mockImplementationOnce(() => new Promise<unknown>(() => undefined));
			// Act
			const pending = harness.controller.run('start');
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(WASHER_VT_SEND_TIMEOUT_MS);
			const outcome: WasherVtOutcome = await pending;
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toContain('no answer from LG within 10 s');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.read.mock.calls.length).toBeGreaterThan(1);
		});

		it('should ignore a late resolution of a timed-out send without a second send', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			const lateResolvers: ((value: unknown) => void)[] = [];
			harness.send.mockImplementationOnce(() => new Promise<unknown>((resolve) => lateResolvers.push(resolve)));
			// Act
			const pending = harness.controller.run('start');
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(WASHER_VT_SEND_TIMEOUT_MS);
			await pending;
			lateResolvers[0]?.(washerVtReply('0000'));
			await vi.advanceTimersByTimeAsync(0);
			// Assert
			expect(harness.send).toHaveBeenCalledTimes(1);
		});
	});

	describe('concurrency and Start lock-out', () => {
		it('should refuse a second command immediately while the first is awaiting the send', async () => {
			// Arrange
			const harness = createHarness([washer(), washer({ state: 'DETECTING' })]);
			const resolvers: ((value: unknown) => void)[] = [];
			harness.send.mockImplementationOnce(() => new Promise<unknown>((resolve) => resolvers.push(resolve)));
			const first = harness.controller.run('start');
			await vi.advanceTimersByTimeAsync(0);
			// Act
			const second = await harness.controller.run('start');
			resolvers[0]?.(washerVtReply('0111'));
			const firstOutcome = await first;
			// Assert
			expect(second).toEqual({ status: 'refused', message: MSG_BUSY });
			expect(firstOutcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should clear the in-flight flag after a command so the next one proceeds', async () => {
			// Arrange
			const harness = createHarness([
				washer(),
				washer({ state: 'DETECTING' }),
				washer(),
				washer({ state: 'DETECTING' }),
			]);
			// Act
			const first = await harness.controller.run('start');
			const second = await harness.controller.run('start');
			// Assert
			expect(first.status).toBe('done');
			expect(second.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should refuse Start and Resume with the lock-out text after an unconfirmed Start', async () => {
			// Arrange
			const harness = createHarness([washer()], { now: () => 1_000_000 });
			const unconfirmed = await harness.controller.run('start');
			harness.setSteps([washer({ state: 'PAUSE' })]);
			// Act
			const start = await harness.controller.run('start');
			const resume = await harness.controller.run('resume');
			// Assert
			expect(unconfirmed.status).toBe('unconfirmed');
			expect(start).toMatchObject({ status: 'refused', message: MSG_LOCKOUT });
			expect(resume).toMatchObject({ status: 'refused', message: MSG_LOCKOUT });
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should allow a new Start once the lock-out window has elapsed', async () => {
			// Arrange
			const harness = createHarness([washer()]);
			await harness.controller.run('start');
			harness.setSteps([washer(), washer({ state: 'DETECTING' })]);
			harness.clock.now += WASHER_VT_START_LOCKOUT_MS;
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should not set the lock-out after a definite LG rejection', async () => {
			// Arrange
			const harness = createHarness([washer(), washer(), washer({ state: 'DETECTING' })]);
			harness.send.mockResolvedValueOnce(washerVtReply('0110'));
			await harness.controller.run('start');
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should not set the lock-out after a confirmed Start', async () => {
			// Arrange
			const harness = createHarness([
				washer(),
				washer({ state: 'DETECTING' }),
				washer(),
				washer({ state: 'DETECTING' }),
			]);
			await harness.controller.run('start');
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});
	});

	describe('unexpected errors', () => {
		it('should return failed and clear the in-flight flag when the clock throws', async () => {
			// Arrange
			const now = vi.fn<() => number>().mockImplementationOnce(() => {
				throw new Error('clock broke');
			});
			now.mockReturnValue(0);
			const harness = createHarness([washer(), washer(), washer({ state: 'DETECTING' })], { now });
			// Act
			const failed = await harness.controller.run('start');
			const next = await harness.controller.run('start');
			// Assert
			expect(failed).toEqual({ status: 'failed', message: 'Could not control the washer: clock broke' });
			expect(next.status).toBe('done');
		});
	});

	describe('logging', () => {
		it('should log the action, the cells and the masked label without tokens', async () => {
			// Arrange
			const harness = createHarness([washer(), washer({ state: 'DETECTING' })], { label: 'ab12' });
			harness.send.mockResolvedValueOnce({
				resultCode: '0000',
				accessToken: 'SECRET-TOKEN-123',
				'x-emp-token': 'SECRET-EMP-456',
				authorization: 'Bearer SECRET-BEARER-789',
			});
			// Act
			await harness.controller.run('start');
			// Assert
			const logged = JSON.stringify([
				vi.mocked(harness.logger.info).mock.calls,
				vi.mocked(harness.logger.warn).mock.calls,
				vi.mocked(harness.logger.error).mock.calls,
			]);
			expect(logged).toContain('wmControl=START');
			expect(logged).toContain('ab12');
			expect(logged).not.toContain('SECRET');
			expect(logged).not.toContain('Bearer');
		});
	});

	describe('applyChanges (Home selection write)', () => {
		const NORMAL_OPTIONS: WasherCourseOptions = {
			soilWash: { values: ['SOILWASH_NORMAL', 'SOILWASH_HEAVY'], defaultValue: 'SOILWASH_NORMAL', writable: true },
			rinse: { values: ['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3'], defaultValue: 'RINSE_2', writable: true },
			spin: { values: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'], defaultValue: 'SPIN_1400', writable: true },
			temp: { values: ['TEMP_COLD', 'TEMP_40', 'TEMP_60'], defaultValue: 'TEMP_40', writable: true },
		};
		const COURSE_OPTIONS: ReadonlyMap<string, WasherCourseOptions> = new Map<string, WasherCourseOptions>([
			['NORMAL', NORMAL_OPTIONS],
			['NOSOIL', { rinse: NORMAL_OPTIONS.rinse, spin: NORMAL_OPTIONS.spin, temp: NORMAL_OPTIONS.temp }],
			['COTTON', { spin: { values: ['SPIN_400', 'SPIN_800'], defaultValue: 'SPIN_800', writable: true } }],
			['TUB', { temp: { values: ['TEMP_COLD'], defaultValue: 'TEMP_COLD', writable: false } }],
			['DRUM_CARE', {}],
		]);
		const MSG_NO_COURSE = 'The washer has no wash course selected. Pick a course on the washer first.';
		const MSG_NO_OPTIONS = 'This washer model does not describe its wash courses, so Home cannot change them.';
		const MSG_VALUE_REFUSED = 'The washer does not accept that setting. Pick a different value.';
		const MSG_CARRIED_REFUSED =
			'The washer will not keep its current temperature or spin setting, so this change would reset it. Change that setting in Home first, then try again.';

		function resolveCourseOptions(courseId: string): WasherCourseOptions | undefined {
			return COURSE_OPTIONS.get(courseId);
		}

		/** Reading with Remote Control OFF (the only state Home may write in) plus overrides. */
		function readingWith(overrides: Record<string, unknown>): WasherVtReading {
			return washerReading({ ...BASE_FIELDS, ...REMOTE_OFF, ...overrides }, { online: true });
		}

		/** Like `readingWith`, but passes `online` through as given (`undefined` = unknown). */
		function readingOnline(overrides: Record<string, unknown>, online: boolean | undefined): WasherVtReading {
			return washerReading({ ...BASE_FIELDS, ...REMOTE_OFF, ...overrides }, { online });
		}

		afterEach(() => {
			vi.clearAllMocks();
		});

		it('should send the course and all four option cells when the course changes', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' }), readingWith({ course: 'NORMAL' })], {
				resolveCourseOptions,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'NORMAL' },
							{ cmd: 'soilWash', value: 'SOILWASH_NORMAL' },
							{ cmd: 'rinse', value: 'RINSE_2' },
							{ cmd: 'spin', value: 'SPIN_1400' },
							{ cmd: 'temp', value: 'TEMP_40' },
						],
					},
				},
			});
			expect(sentJson(harness.send)).not.toContain('wmControl');
		});

		it('should send only the changed spin cell and no course cell when only an option changes', async () => {
			// Arrange
			const harness = createHarness([readingWith({}), readingWith({ spin: 'SPIN_1000' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([{ cmd: 'spin', value: 'SPIN_1000' }]),
			);
			expect(sentJson(harness.send)).not.toContain('"cmd":"course"');
			expect(sentJson(harness.send)).not.toContain('wmControl');
		});

		it('should send the course and all four carried cells when only an option changes and the omit gate is off', async () => {
			// Arrange
			const harness = createHarness([readingWith({}), readingWith({ spin: 'SPIN_1000' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: false,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([
					{ cmd: 'course', value: 'NORMAL' },
					{ cmd: 'soilWash', value: 'SOILWASH_NORMAL' },
					{ cmd: 'rinse', value: 'RINSE_2' },
					{ cmd: 'spin', value: 'SPIN_1000' },
					{ cmd: 'temp', value: 'TEMP_40' },
				]),
			);
		});

		it('should send the course and all four cells when the course changes and the omit gate is explicitly on', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' }), readingWith({ course: 'NORMAL' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([
					{ cmd: 'course', value: 'NORMAL' },
					{ cmd: 'soilWash', value: 'SOILWASH_NORMAL' },
					{ cmd: 'rinse', value: 'RINSE_2' },
					{ cmd: 'spin', value: 'SPIN_1400' },
					{ cmd: 'temp', value: 'TEMP_40' },
				]),
			);
		});

		it('should report done when the washer keeps its course and the requested spin applies', async () => {
			// Arrange
			const harness = createHarness([readingWith({}), readingWith({ spin: 'SPIN_1000', course: 'NORMAL' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome.status).toBe('done');
		});

		it('should report unconfirmed when the washer moves its own course after an option-only send', async () => {
			// Arrange
			const harness = createHarness([readingWith({}), readingWith({ course: 'COTTON', spin: 'SPIN_1000' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome.status).toBe('unconfirmed');
		});

		it('should send exactly the two requested cells in fixed key order when two options change and the course does not', async () => {
			// Arrange
			const harness = createHarness([readingWith({}), readingWith({ spin: 'SPIN_1000', soilWash: 'SOILWASH_HEAVY' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			// Act
			const outcome = await harness.controller.applyChanges([
				{ kind: 'option', key: 'spin', value: 'SPIN_1000' },
				{ kind: 'option', key: 'soilWash', value: 'SOILWASH_HEAVY' },
			]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([
					{ cmd: 'soilWash', value: 'SOILWASH_HEAVY' },
					{ cmd: 'spin', value: 'SPIN_1000' },
				]),
			);
		});

		it('should report noop and send nothing when the washer already has the target and the omit gate is off', async () => {
			// Arrange
			const harness = createHarness([readingWith({ spin: 'SPIN_1000' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: false,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should confirm only the requested cell and send the carried temperature when the omit gate is off and the washer resets it', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ temp: 'TEMP_60' }), readingWith({ temp: 'TEMP_40', rinse: 'NO_RINSE' })],
				{
					resolveCourseOptions,
					omitCourseCellWhenUnchanged: false,
				},
			);
			harness.send.mockResolvedValueOnce(
				washerVtReply('0000', [
					['course', '17'],
					['rinse', '0'],
					['spin', '17'],
					['temp', '15'],
				]),
			);
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([
					{ cmd: 'course', value: 'NORMAL' },
					{ cmd: 'soilWash', value: 'SOILWASH_NORMAL' },
					{ cmd: 'rinse', value: 'NO_RINSE' },
					{ cmd: 'spin', value: 'SPIN_1400' },
					{ cmd: 'temp', value: 'TEMP_60' },
				]),
			);
		});

		it('should report unconfirmed with the rejected requested cell when the requested rinse is refused', async () => {
			// Arrange
			const harness = createHarness([readingWith({ temp: 'TEMP_60' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: false,
			});
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['rinse', '15']]));
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toMatch(/LG did not apply: rinse=15\.$/);
		});

		it('should warn about the refused carried cell when the omit gate is off and the washer resets it', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ temp: 'TEMP_60' }), readingWith({ temp: 'TEMP_40', rinse: 'NO_RINSE' })],
				{
					resolveCourseOptions,
					omitCourseCellWhenUnchanged: false,
				},
			);
			harness.send.mockResolvedValueOnce(
				washerVtReply('0000', [
					['course', '17'],
					['rinse', '0'],
					['spin', '17'],
					['temp', '15'],
				]),
			);
			// Act
			await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(vi.mocked(harness.logger.warn)).toHaveBeenCalledWith(expect.stringContaining('temp=15'));
		});

		it('should report noop when the requested rinse is already set and the carried temperature is outside the course list', async () => {
			// Arrange
			const harness = createHarness([readingWith({ rinse: 'NO_RINSE', temp: 'TEMP_30' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: false,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(outcome).toMatchObject({ status: 'noop', message: 'the washer already has these settings' });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it.each([true, false])(
			'should refuse a requested refused temperature up front without sending when the omit gate is %s',
			async (omitCourseCellWhenUnchanged) => {
				// Arrange
				const harness = createHarness([readingWith({ temp: 'TEMP_40' })], {
					resolveCourseOptions,
					omitCourseCellWhenUnchanged,
				});
				// Act
				const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'temp', value: 'TEMP_COLD' }]);
				// Assert
				expect(outcome).toMatchObject({ status: 'refused', message: MSG_VALUE_REFUSED });
				expect(outcome.snapshot).toBeDefined();
				expect(harness.send).not.toHaveBeenCalled();
			},
		);

		it('should refuse with the carried-value text and send nothing when a refused carried temperature would be reset', async () => {
			// Arrange
			const harness = createHarness([readingWith({ temp: 'TEMP_COLD' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: false,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_CARRIED_REFUSED });
			expect(outcome.snapshot).toBeDefined();
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should send only the requested rinse cell when the omit gate is on and the carried temperature is refused', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ temp: 'TEMP_COLD' }), readingWith({ temp: 'TEMP_COLD', rinse: 'NO_RINSE' })],
				{ resolveCourseOptions, omitCourseCellWhenUnchanged: true },
			);
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([{ cmd: 'rinse', value: 'NO_RINSE' }]),
			);
		});

		it('should drop a refused carried temperature with a warning when the course is the requested one', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ temp: 'TEMP_COLD' }), readingWith({ temp: 'TEMP_COLD', rinse: 'RINSE_3' })],
				{ resolveCourseOptions, omitCourseCellWhenUnchanged: false },
			);
			// Act
			const outcome = await harness.controller.applyChanges([
				{ kind: 'course', courseId: 'NORMAL' },
				{ kind: 'option', key: 'rinse', value: 'RINSE_3' },
			]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]?.dataSetList).toStrictEqual(
				vtDataSetList([
					{ cmd: 'course', value: 'NORMAL' },
					{ cmd: 'soilWash', value: 'SOILWASH_NORMAL' },
					{ cmd: 'rinse', value: 'RINSE_3' },
					{ cmd: 'spin', value: 'SPIN_1400' },
				]),
			);
			expect(vi.mocked(harness.logger.warn)).toHaveBeenCalledWith(expect.stringContaining('temp=TEMP_COLD'));
		});

		it('should learn a refused spin from the ack and refuse that value on the next change only', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ spin: 'SPIN_1400' }), readingWith({ spin: 'SPIN_1000', rinse: 'NO_RINSE' })],
				{ resolveCourseOptions, omitCourseCellWhenUnchanged: false },
			);
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['spin', '15']]));
			// Act
			const first = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			harness.setSteps([readingWith({ spin: 'SPIN_1400', rinse: 'RINSE_2' })]);
			const second = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			// Assert
			expect(first.status).toBe('done');
			expect(vi.mocked(harness.logger.warn)).toHaveBeenCalledWith(expect.stringContaining('spin=SPIN_1400'));
			expect(second).toMatchObject({ status: 'refused', message: MSG_CARRIED_REFUSED });
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should send a normal spin after learning refuses only SPIN_1400', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ spin: 'SPIN_1400' }), readingWith({ spin: 'SPIN_1000', rinse: 'NO_RINSE' })],
				{ resolveCourseOptions, omitCourseCellWhenUnchanged: false },
			);
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['spin', '15']]));
			await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			harness.setSteps([
				readingWith({ spin: 'SPIN_1000', rinse: 'RINSE_2' }),
				readingWith({ spin: 'SPIN_1000', rinse: 'RINSE_3' }),
			]);
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should not learn a refusal when the ack rejects a value the washer actually set', async () => {
			// Arrange
			const harness = createHarness([readingWith({ rinse: 'RINSE_2' }), readingWith({ rinse: 'RINSE_3' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['rinse', '15']]));
			// Act
			const first = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			harness.setSteps([readingWith({ rinse: 'RINSE_2' }), readingWith({ rinse: 'RINSE_3' })]);
			const second = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			// Assert
			expect(first.status).toBe('done');
			expect(vi.mocked(harness.logger.warn)).not.toHaveBeenCalledWith(
				expect.stringContaining('Home will not send that value again'),
			);
			expect(second.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should learn a refusal when the ack rejects a value and the washer did not set it', async () => {
			// Arrange
			const harness = createHarness([readingWith({ rinse: 'RINSE_2' }), readingWith({ rinse: 'RINSE_2' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['rinse', '15']]));
			// Act
			const first = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			harness.setSteps([readingWith({ rinse: 'RINSE_2' })]);
			const second = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			// Assert
			expect(first.status).toBe('unconfirmed');
			expect(vi.mocked(harness.logger.warn)).toHaveBeenCalledWith(expect.stringContaining('rinse=RINSE_3'));
			expect(second).toMatchObject({ status: 'refused', message: MSG_VALUE_REFUSED });
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should learn a carried temperature the washer reset when the omit gate is off', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ temp: 'TEMP_60' }), readingWith({ temp: 'TEMP_40', rinse: 'NO_RINSE' })],
				{ resolveCourseOptions, omitCourseCellWhenUnchanged: false },
			);
			harness.send.mockResolvedValueOnce(
				washerVtReply('0000', [
					['course', '17'],
					['rinse', '0'],
					['spin', '17'],
					['temp', '15'],
				]),
			);
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'NO_RINSE' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(vi.mocked(harness.logger.warn)).toHaveBeenCalledWith(expect.stringContaining('temp=TEMP_60'));
		});

		it('should not learn a refusal when the washer gives no post-send read', async () => {
			// Arrange
			const harness = createHarness([readingWith({ rinse: 'RINSE_2' }), undefined], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['rinse', '15']]));
			// Act
			const first = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			harness.setSteps([readingWith({ rinse: 'RINSE_2' }), readingWith({ rinse: 'RINSE_3' })]);
			const second = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			// Assert
			expect(first.status).toBe('unconfirmed');
			expect(vi.mocked(harness.logger.warn)).not.toHaveBeenCalledWith(
				expect.stringContaining('Home will not send that value again'),
			);
			expect(second.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should not learn a refusal when LG rejects the send before any post-send read', async () => {
			// Arrange
			const harness = createHarness([readingWith({ rinse: 'RINSE_2' })], {
				resolveCourseOptions,
				omitCourseCellWhenUnchanged: true,
			});
			harness.send.mockResolvedValueOnce(washerVtReply('0110', [['rinse', '15']]));
			// Act
			const first = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			harness.setSteps([readingWith({ rinse: 'RINSE_2' }), readingWith({ rinse: 'RINSE_3' })]);
			const second = await harness.controller.applyChanges([{ kind: 'option', key: 'rinse', value: 'RINSE_3' }]);
			// Assert
			expect(first.status).toBe('failed');
			expect(vi.mocked(harness.logger.warn)).not.toHaveBeenCalledWith(
				expect.stringContaining('Home will not send that value again'),
			);
			expect(second.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it.each([
			['absent', { course: undefined }],
			['empty', { course: '' }],
			['NOT_SELECTED', { course: 'NOT_SELECTED' }],
			['DOWNLOAD', { course: 'DOWNLOAD' }],
		])('should refuse without sending when the washer course is %s', async (_label, overrides) => {
			// Arrange
			const harness = createHarness([readingWith(overrides)], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_NO_COURSE });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it.each([
			['state RUNNING', { state: 'RUNNING' }, true],
			['state PAUSE', { state: 'PAUSE' }, true],
			['state POWEROFF', { state: 'POWEROFF' }, true],
			['state unreadable', { state: undefined }, true],
			['Remote Control ON', { remoteStart: 'REMOTE_START_ON' }, true],
			['child lock ON', { childLock: 'CHILDLOCK_ON' }, true],
			['an error', { error: 'ERROR_DOOR' }, true],
			['offline', {}, false],
			['online unknown', {}, undefined],
		])('should refuse without sending when %s', async (_label, overrides, online) => {
			// Arrange
			const harness = createHarness([readingOnline(overrides, online)], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it.each([
			['a spin value not in the course list', [{ kind: 'option', key: 'spin', value: 'SPIN_9999' }] as const],
			[
				'a temp on a non-writable list',
				[
					{ kind: 'course', courseId: 'TUB' },
					{ kind: 'option', key: 'temp', value: 'TEMP_COLD' },
				] as const,
			],
		])('should refuse without sending for %s', async (_label, changes) => {
			// Arrange
			const harness = createHarness([readingWith({})], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges(changes);
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse without sending when a change targets a key the course does not list', async () => {
			// Arrange
			const harness = createHarness([readingWith({})], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges([
				{ kind: 'course', courseId: 'COTTON' },
				{ kind: 'option', key: 'temp', value: 'TEMP_40' },
			]);
			// Assert
			expect(outcome.status).toBe('refused');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should omit a key the course does not list from the body when no change targets it', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' }), readingWith({ course: 'NOSOIL' })], {
				resolveCourseOptions,
			});
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NOSOIL' }]);
			// Assert
			expect(outcome.status).toBe('done');
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'NOSOIL' },
							{ cmd: 'rinse', value: 'RINSE_2' },
							{ cmd: 'spin', value: 'SPIN_1400' },
							{ cmd: 'temp', value: 'TEMP_40' },
						],
					},
				},
			});
			expect(sentJson(harness.send)).not.toContain('soilWash');
		});

		it('should substitute the course default for an untouched key whose current value is not in the list', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ course: 'COTTON', temp: 'NO_TEMP' }), readingWith({ course: 'NORMAL' })],
				{
					resolveCourseOptions,
				},
			);
			// Act
			await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: { UNDEFINE: expect.arrayContaining([{ cmd: 'temp', value: 'TEMP_40', type: 'ABSOLUTE' }]) },
				},
			});
		});

		it('should report noop and send nothing when the washer already has the whole target', async () => {
			// Arrange
			const harness = createHarness([readingWith({ spin: 'SPIN_1000' })], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'option', key: 'spin', value: 'SPIN_1000' }]);
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should report unconfirmed with the rejected cell and send exactly once when the course never applies', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' })], { resolveCourseOptions });
			harness.send.mockResolvedValueOnce(washerVtReply('0000', [['temp', '15']]));
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(outcome.status).toBe('unconfirmed');
			expect(outcome.message).toContain('LG did not apply: temp=15.');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should report failed when LG answers a result code that is neither 0000 nor 0111', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' })], { resolveCourseOptions });
			harness.send.mockResolvedValueOnce(washerVtReply('0110'));
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(outcome.status).toBe('failed');
			expect(outcome.message).toContain('0110');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should not arm the Start lock-out after an unconfirmed applyChanges', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' })], { resolveCourseOptions });
			const unconfirmed = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			harness.setSteps([washer(), washer({ state: 'DETECTING' })]);
			// Act
			const start = await harness.controller.run('start');
			// Assert
			expect(unconfirmed.status).toBe('unconfirmed');
			expect(start.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(2);
		});

		it('should never read or send for an empty change list', async () => {
			// Arrange
			const harness = createHarness([readingWith({})], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges([]);
			// Assert
			expect(outcome.status).toBe('noop');
			expect(harness.read).not.toHaveBeenCalled();
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse without sending when no course options were supplied to the controller', async () => {
			// Arrange
			const harness = createHarness([readingWith({})]);
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_NO_OPTIONS });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse without sending when the target course is unknown to the model', async () => {
			// Arrange
			const harness = createHarness([readingWith({})], { resolveCourseOptions });
			// Act
			const outcome = await harness.controller.applyChanges([{ kind: 'course', courseId: 'GHOST' }]);
			// Assert
			expect(outcome).toMatchObject({ status: 'refused', message: MSG_NO_OPTIONS });
			expect(harness.send).not.toHaveBeenCalled();
		});

		it('should refuse a second command with the busy text while applyChanges is in flight', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON' }), readingWith({ course: 'NORMAL' })], {
				resolveCourseOptions,
			});
			const resolvers: ((value: unknown) => void)[] = [];
			harness.send.mockImplementationOnce(() => new Promise<unknown>((resolve) => resolvers.push(resolve)));
			const first = harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			await vi.advanceTimersByTimeAsync(0);
			// Act
			const second = await harness.controller.run('start');
			resolvers[0]?.(washerVtReply('0000'));
			const firstOutcome = await first;
			// Assert
			expect(second).toEqual({ status: 'refused', message: MSG_BUSY });
			expect(firstOutcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});

		it('should refuse applyChanges with the busy text while a run is in flight', async () => {
			// Arrange
			const harness = createHarness([washer(), washer({ state: 'DETECTING' })], { resolveCourseOptions });
			const resolvers: ((value: unknown) => void)[] = [];
			harness.send.mockImplementationOnce(() => new Promise<unknown>((resolve) => resolvers.push(resolve)));
			const first = harness.controller.run('start');
			await vi.advanceTimersByTimeAsync(0);
			// Act
			const second = await harness.controller.applyChanges([{ kind: 'course', courseId: 'NORMAL' }]);
			resolvers[0]?.(washerVtReply('0111'));
			const firstOutcome = await first;
			// Assert
			expect(second).toEqual({ status: 'refused', message: MSG_BUSY });
			expect(firstOutcome.status).toBe('done');
			expect(harness.send).toHaveBeenCalledTimes(1);
		});
	});

	describe('homeSelection (Start stages the course picked in Home)', () => {
		const HOME_COURSE_OPTIONS: ReadonlyMap<string, WasherCourseOptions> = new Map<string, WasherCourseOptions>([
			['COTTON', { spin: { values: ['SPIN_400', 'SPIN_800'], defaultValue: 'SPIN_800', writable: true } }],
			[
				'NORMAL',
				{
					spin: {
						values: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'],
						defaultValue: 'SPIN_1400',
						writable: true,
					},
				},
			],
		]);

		function resolveHomeOptions(courseId: string): WasherCourseOptions | undefined {
			return HOME_COURSE_OPTIONS.get(courseId);
		}

		function readingWith(overrides: Record<string, unknown>): WasherVtReading {
			return washerReading({ ...BASE_FIELDS, ...REMOTE_OFF, ...overrides }, { online: true });
		}

		it('should stage the Home course, not the configured one, on the first Start tap after a successful applyChanges', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ course: 'NORMAL' }), readingWith({ course: 'COTTON', spin: 'SPIN_800' })],
				{ stagePlan: STAGE_PLAN, resolveCourseOptions: resolveHomeOptions },
			);
			const applied = await harness.controller.applyChanges([{ kind: 'course', courseId: 'COTTON' }]);
			harness.setSteps([readingWith({ course: 'NORMAL' }), readingWith({ course: 'COTTON', spin: 'SPIN_800' })]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(applied.status).toBe('done');
			expect(outcome.status).toBe('staged');
			expect(harness.send.mock.calls[1]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'COTTON' },
							{ cmd: 'spin', value: 'SPIN_800' },
						],
					},
				},
			});
		});

		it('should stage the Home course on the next Start after a noop applyChanges', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'COTTON', spin: 'SPIN_800' })], {
				stagePlan: STAGE_PLAN,
				resolveCourseOptions: resolveHomeOptions,
			});
			const noop = await harness.controller.applyChanges([{ kind: 'course', courseId: 'COTTON' }]);
			harness.setSteps([readingWith({ course: 'NORMAL' }), readingWith({ course: 'COTTON', spin: 'SPIN_800' })]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(noop.status).toBe('noop');
			expect(outcome.status).toBe('staged');
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'COTTON' },
							{ cmd: 'spin', value: 'SPIN_800' },
						],
					},
				},
			});
		});

		it('should keep the configured stage plan after a refused applyChanges', async () => {
			// Arrange
			const harness = createHarness([readingWith({ course: 'NORMAL', childLock: 'CHILDLOCK_ON' })], {
				stagePlan: STAGE_PLAN,
				resolveCourseOptions: resolveHomeOptions,
			});
			const refused = await harness.controller.applyChanges([{ kind: 'course', courseId: 'COTTON' }]);
			harness.setSteps([readingWith({ course: 'COTTON' }), readingWith({ course: 'NORMAL', spin: 'SPIN_1000' })]);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(refused.status).toBe('refused');
			expect(outcome.status).toBe('staged');
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'NORMAL' },
							{ cmd: 'spin', value: 'SPIN_1000' },
						],
					},
				},
			});
		});

		it('should send the configured stage plan cells exactly when no applyChanges ran (regression)', async () => {
			// Arrange
			const harness = createHarness(
				[readingWith({ course: 'COTTON' }), readingWith({ course: 'NORMAL', spin: 'SPIN_1000' })],
				{
					stagePlan: STAGE_PLAN,
				},
			);
			// Act
			const outcome = await harness.controller.run('start');
			// Assert
			expect(outcome.status).toBe('staged');
			expect(harness.send).toHaveBeenCalledTimes(1);
			expect(harness.send.mock.calls[0]?.[0]).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'NORMAL' },
							{ cmd: 'spin', value: 'SPIN_1000' },
						],
					},
				},
			});
		});
	});

	describe('no retry', () => {
		it.each([
			['unconfirmed Start', [washer()], undefined],
			['network failure', [washer()], new Error('socket hang up')],
		] as const)('should send exactly once for %s', async (_label, steps, sendError) => {
			// Arrange
			const harness = createHarness(steps);
			if (sendError !== undefined) {
				harness.send.mockRejectedValueOnce(sendError);
			}
			// Act
			await harness.controller.run('start');
			// Assert
			expect(harness.send).toHaveBeenCalledTimes(1);
		});
	});
});
