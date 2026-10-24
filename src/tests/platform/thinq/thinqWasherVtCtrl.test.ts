import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	buildWasherOspWakeBody,
	buildWasherVtBody,
	buildWasherVtCells,
	buildWasherVtRequest,
	checkWasherVtGuard,
	evaluateWasherVtGuard,
	formatWasherVtRefusalForCli,
	formatWasherVtRefusalForHome,
	isWasherVtCourseApplied,
	isWasherVtExpectedState,
	pollWasherUntil,
	rejectedWasherVtCells,
	WASHER_VT_IDLE_STATES,
	WASHER_VT_POWER_OFF_SAFE_STATES,
	WASHER_VT_POWER_POLL_ATTEMPTS,
	WASHER_VT_RUNNING_STATES,
	WASHER_VT_SEND_TIMEOUT_MS,
	WASHER_VT_START_LOCKOUT_MS,
	type WasherVtRefusal,
	type WasherVtRefusalCode,
	type WasherVtSendName,
} from '../../../platform/thinq/thinqWasherVtCtrl.js';
import { createFakeWasherModel, fieldsOf, washerVtReply } from '../../helpers/washerFixtures.js';

/** Fields of a washer that would pass every `vt-start` rule (door closed, Remote Control ON, course staged). */
const READY_FOR_START = {
	state: 'INITIAL',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
	remoteStart: 'REMOTE_START_ON',
	doorClose: 'DOORCLOSE_ON',
	course: 'NORMAL',
};

const READY_FOR_COURSE = {
	state: 'INITIAL',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
	remoteStart: 'REMOTE_START_OFF',
};

interface GuardCase {
	readonly code: WasherVtRefusalCode;
	readonly name: WasherVtSendName;
	readonly fields: Record<string, unknown>;
	readonly online: boolean | undefined;
	readonly allowInterrupt?: boolean;
	readonly expected: WasherVtRefusal;
}

/** One refusal fixture per code in `WasherVtRefusalCode`. */
const GUARD_CASES: readonly GuardCase[] = [
	{ code: 'STATE_UNREADABLE', name: 'vt-start', fields: {}, online: true, expected: { code: 'STATE_UNREADABLE' } },
	{
		code: 'OFFLINE',
		name: 'vt-start',
		fields: READY_FOR_START,
		online: false,
		expected: { code: 'OFFLINE' },
	},
	{
		code: 'ONLINE_UNKNOWN',
		name: 'vt-start',
		fields: READY_FOR_START,
		online: undefined,
		expected: { code: 'ONLINE_UNKNOWN' },
	},
	{
		code: 'POWER_ON_NOT_POWEROFF',
		name: 'vt-power-on',
		fields: { state: 'INITIAL' },
		online: true,
		expected: { code: 'POWER_ON_NOT_POWEROFF', state: 'INITIAL' },
	},
	{
		code: 'ALREADY_POWEROFF',
		name: 'vt-power-off',
		fields: { state: 'POWEROFF' },
		online: true,
		expected: { code: 'ALREADY_POWEROFF', state: 'POWEROFF' },
	},
	{
		code: 'INTERRUPT_NEEDED',
		name: 'vt-power-off',
		fields: { state: 'RUNNING' },
		online: true,
		expected: { code: 'INTERRUPT_NEEDED', state: 'RUNNING' },
	},
	{
		code: 'CHILD_LOCK',
		name: 'vt-pause',
		fields: { state: 'RUNNING', childLock: 'CHILDLOCK_ON', error: 'ERROR_NO' },
		online: true,
		expected: { code: 'CHILD_LOCK', state: 'RUNNING', seen: '"CHILDLOCK_ON"' },
	},
	{
		code: 'ERROR_PRESENT',
		name: 'vt-pause',
		fields: { state: 'RUNNING', childLock: 'CHILDLOCK_OFF', error: 'ERROR_DOOR' },
		online: true,
		expected: { code: 'ERROR_PRESENT', state: 'RUNNING', seen: '"ERROR_DOOR"' },
	},
	{
		code: 'PAUSE_NOT_RUNNING',
		name: 'vt-pause',
		fields: { ...READY_FOR_COURSE, state: 'INITIAL' },
		online: true,
		expected: { code: 'PAUSE_NOT_RUNNING', state: 'INITIAL' },
	},
	{
		code: 'RESUME_NOT_PAUSED',
		name: 'vt-resume',
		fields: { ...READY_FOR_COURSE, state: 'RUNNING' },
		online: true,
		expected: { code: 'RESUME_NOT_PAUSED', state: 'RUNNING' },
	},
	{
		code: 'COURSE_WASHER_POWEROFF',
		name: 'vt-course',
		fields: { ...READY_FOR_COURSE, state: 'POWEROFF' },
		online: true,
		expected: { code: 'COURSE_WASHER_POWEROFF', state: 'POWEROFF' },
	},
	{
		code: 'COURSE_NOT_INITIAL',
		name: 'vt-course',
		fields: { ...READY_FOR_COURSE, state: 'RUNNING' },
		online: true,
		expected: { code: 'COURSE_NOT_INITIAL', state: 'RUNNING' },
	},
	{
		code: 'COURSE_REMOTE_ON',
		name: 'vt-course',
		fields: { ...READY_FOR_COURSE, remoteStart: 'REMOTE_START_ON' },
		online: true,
		expected: { code: 'COURSE_REMOTE_ON', state: 'INITIAL', seen: '"REMOTE_START_ON"' },
	},
	{
		code: 'START_NOT_INITIAL',
		name: 'vt-start',
		fields: { ...READY_FOR_START, state: 'RUNNING' },
		online: true,
		expected: { code: 'START_NOT_INITIAL', state: 'RUNNING' },
	},
	{
		code: 'DOOR_OPEN',
		name: 'vt-start',
		fields: { ...READY_FOR_START, doorClose: 'DOORCLOSE_OFF', doorLock: 'DOORLOCK_OFF' },
		online: true,
		expected: {
			code: 'DOOR_OPEN',
			state: 'INITIAL',
			seen: 'doorClose="DOORCLOSE_OFF", doorLock="DOORLOCK_OFF"',
		},
	},
	{
		code: 'START_REMOTE_OFF',
		name: 'vt-start',
		fields: { ...READY_FOR_START, remoteStart: 'REMOTE_START_OFF' },
		online: true,
		expected: { code: 'START_REMOTE_OFF', state: 'INITIAL' },
	},
	{
		code: 'NO_COURSE_STAGED',
		name: 'vt-start',
		fields: { ...READY_FOR_START, course: undefined },
		online: true,
		expected: { code: 'NO_COURSE_STAGED', state: 'INITIAL', seen: 'missing' },
	},
];

/** Passing fixture per send name: the guard returns `undefined`. */
const PASSING_CASES: readonly { readonly name: WasherVtSendName; readonly fields: Record<string, unknown> }[] = [
	{ name: 'vt-power-on', fields: { state: 'POWEROFF' } },
	{ name: 'vt-power-off', fields: { state: 'INITIAL' } },
	{ name: 'vt-pause', fields: { state: 'RUNNING', childLock: 'CHILDLOCK_OFF', error: 'ERROR_NO' } },
	{ name: 'vt-resume', fields: { state: 'PAUSE', childLock: 'CHILDLOCK_OFF', error: 'ERROR_NO' } },
	{ name: 'vt-course', fields: READY_FOR_COURSE },
	{ name: 'vt-start', fields: READY_FOR_START },
];

afterEach(() => {
	vi.clearAllMocks();
});

describe('thinqWasherVtCtrl', () => {
	describe('buildWasherOspWakeBody', () => {
		const WAKE_PART = {
			command: 'Set',
			data: { washerDryer: { ospWakeupType: 'WAKEUP_AND_PWR_ON', ospWakeUpData: 0 } },
		};

		it('should copy the command and data of ControlWifi.ospWakeup into an ospWakeup body', () => {
			// Arrange
			const model = { ControlWifi: { ospWakeup: WAKE_PART } };
			// Act
			const body = buildWasherOspWakeBody(model);
			// Assert
			expect(body).toEqual({
				ctrlKey: 'ospWakeup',
				command: 'Set',
				dataSetList: { washerDryer: { ospWakeupType: 'WAKEUP_AND_PWR_ON', ospWakeUpData: 0 } },
			});
		});

		it('should return undefined when the model has no ospWakeup entry', () => {
			// Arrange
			const model = { ControlWifi: { vtCtrl: { command: 'Set', data: {} } } };
			// Act / Assert
			expect(buildWasherOspWakeBody(model)).toBeUndefined();
		});

		it('should return undefined when the model has no ControlWifi block', () => {
			// Arrange / Act / Assert
			expect(buildWasherOspWakeBody({})).toBeUndefined();
		});

		it('should contain no vtCtrl cell', () => {
			// Arrange
			const model = { ControlWifi: { ospWakeup: WAKE_PART } };
			// Act
			const body = buildWasherOspWakeBody(model);
			// Assert
			expect(JSON.stringify(body)).not.toContain('vtData');
			expect(JSON.stringify(body)).not.toContain('POWER_ON');
		});
	});

	describe('buildWasherVtBody', () => {
		it.each(['vt-course', 'vt-start', 'vt-pause', 'vt-power-on', 'vt-resume', 'vt-power-off'] as const)(
			'should build a variant A vtCtrl body for %s',
			(name) => {
				// Arrange
				const courseId = name === 'vt-course' ? 'NORMAL' : undefined;
				// Act
				const body = buildWasherVtBody(name, courseId, {});
				// Assert
				expect(body).toMatchObject({
					ctrlKey: 'vtCtrl',
					command: 'Set',
					dataSetList: {
						ctrlTarget: ['UNDEFINE'],
						reqDevType: 'APP',
						vtData: { UNDEFINE: buildWasherVtCells(name, courseId, {}) },
					},
				});
			},
		);

		it('should keep the option cells in soilWash, rinse, spin, temp order for vt-course', () => {
			// Arrange
			const options = { temp: 'TEMP_60', spin: 'SPIN_1000', rinse: 'RINSE_3', soilWash: 'SOILWASH_HEAVY' };
			// Act
			const body = buildWasherVtBody('vt-course', 'NORMAL', options);
			// Assert
			expect(body).toMatchObject({
				dataSetList: {
					vtData: {
						UNDEFINE: [
							{ cmd: 'course', value: 'NORMAL' },
							{ cmd: 'soilWash', value: 'SOILWASH_HEAVY' },
							{ cmd: 'rinse', value: 'RINSE_3' },
							{ cmd: 'spin', value: 'SPIN_1000' },
							{ cmd: 'temp', value: 'TEMP_60' },
						],
					},
				},
			});
		});

		it('should return a body deep-equal to buildWasherVtBody when the request is variant a', () => {
			// Arrange
			const model = createFakeWasherModel();
			const options = { spin: 'SPIN_1000' };
			// Act
			const request = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', options, variant: 'a' });
			// Assert
			expect(request?.body).toEqual(buildWasherVtBody('vt-course', 'NORMAL', options));
		});

		it('should wrap the data set list under vtCtrl when the request is variant b', () => {
			// Arrange
			const model = createFakeWasherModel();
			// Act
			const request = buildWasherVtRequest('vt-pause', model, { variant: 'b' });
			// Assert
			expect(request?.body).toMatchObject({
				ctrlKey: 'vtCtrl',
				command: 'Set',
				dataSetList: {
					vtCtrl: { ctrlTarget: ['UNDEFINE'], vtData: { UNDEFINE: [{ cmd: 'wmControl', value: 'PAUSE' }] } },
				},
			});
		});

		it('should return undefined from buildWasherVtRequest when the model lacks uniProtocol', () => {
			// Arrange
			const model = { ...createFakeWasherModel(), Config: { defaultCourse: 'NORMAL' } };
			// Act / Assert
			expect(buildWasherVtRequest('vt-pause', model, { variant: 'a' })).toBeUndefined();
		});
	});

	describe('checkWasherVtGuard', () => {
		it.each(GUARD_CASES)('should return code $code when the guard refuses $name', (guardCase) => {
			// Arrange / Act
			const refusal = checkWasherVtGuard(
				guardCase.name,
				fieldsOf(guardCase.fields),
				guardCase.online,
				guardCase.allowInterrupt,
			);
			// Assert
			expect(refusal).toEqual(guardCase.expected);
		});

		it.each(PASSING_CASES)('should return undefined when the guard passes for $name', ({ name, fields }) => {
			// Arrange / Act / Assert
			expect(checkWasherVtGuard(name, fieldsOf(fields), true)).toBeUndefined();
		});

		it('should cover every refusal code exactly once in the case table', () => {
			// Arrange
			const codes = GUARD_CASES.map((guardCase) => guardCase.code);
			// Act / Assert
			expect(new Set(codes).size).toBe(codes.length);
			expect(codes).toHaveLength(17);
		});

		it('should pass the door check when doorClose is OFF but doorLock is ON', () => {
			// Arrange
			const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_OFF', doorLock: 'DOORLOCK_ON' });
			// Act / Assert
			expect(checkWasherVtGuard('vt-start', fields, true)).toBeUndefined();
		});

		it('should pass the door check when doorClose is ON and doorLock is absent', () => {
			// Arrange
			const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_ON', doorLock: undefined });
			// Act / Assert
			expect(checkWasherVtGuard('vt-start', fields, true)).toBeUndefined();
		});

		it('should pass vt-power-off during a cycle only when allowInterrupt is true', () => {
			// Arrange
			const fields = fieldsOf({ state: 'SPINNING' });
			// Act / Assert
			expect(checkWasherVtGuard('vt-power-off', fields, true, true)).toBeUndefined();
			expect(checkWasherVtGuard('vt-power-off', fields, true, false)).toEqual({
				code: 'INTERRUPT_NEEDED',
				state: 'SPINNING',
			});
		});

		it.each(['INITIAL', 'END', 'COMPLETE', 'ERROR'])(
			'should pass vt-power-off from %s without allowInterrupt',
			(state) => {
				// Arrange
				const fields = fieldsOf({ state });
				// Act / Assert
				expect(checkWasherVtGuard('vt-power-off', fields, true)).toBeUndefined();
			},
		);

		it('should refuse vt-power-off from an unknown state without allowInterrupt', () => {
			// Arrange
			const fields = fieldsOf({ state: 'WEIRD_STATE' });
			// Act / Assert
			expect(checkWasherVtGuard('vt-power-off', fields, true)).toEqual({
				code: 'INTERRUPT_NEEDED',
				state: 'WEIRD_STATE',
			});
		});

		it('should refuse vt-power-off in a PAUSE state without allowInterrupt', () => {
			// Arrange
			const fields = fieldsOf({ state: 'PAUSE' });
			// Act / Assert
			expect(checkWasherVtGuard('vt-power-off', fields, true)).toEqual({ code: 'INTERRUPT_NEEDED', state: 'PAUSE' });
		});
	});

	describe('formatWasherVtRefusalForCli', () => {
		const CLI_TEXT: readonly { readonly refusal: WasherVtRefusal; readonly text: string }[] = [
			{
				refusal: { code: 'STATE_UNREADABLE' },
				text: 'cannot confirm washer state (washerDryer.state is absent or unreadable).',
			},
			{ refusal: { code: 'OFFLINE' }, text: 'washer is offline in the ThinQ cloud.' },
			{ refusal: { code: 'ONLINE_UNKNOWN' }, text: 'online status unknown.' },
			{
				refusal: { code: 'POWER_ON_NOT_POWEROFF', state: 'RUNNING' },
				text: 'washer state is RUNNING; vt-power-on needs POWEROFF.',
			},
			{
				refusal: { code: 'ALREADY_POWEROFF', state: 'POWEROFF' },
				text: 'washer is already POWEROFF; nothing to power off.',
			},
			{
				refusal: { code: 'INTERRUPT_NEEDED', state: 'RUNNING' },
				text: 'washer state is RUNNING; vt-power-off here abandons the cycle (water may stay in the drum, the door may stay locked). Add --allow-interrupt to confirm.',
			},
			{
				refusal: { code: 'CHILD_LOCK', state: 'RUNNING', seen: '"CHILDLOCK_ON"' },
				text: 'child lock is on or unreadable (saw "CHILDLOCK_ON"); turn it off on the washer first.',
			},
			{
				refusal: { code: 'ERROR_PRESENT', state: 'RUNNING', seen: '"ERROR_DOOR"' },
				text: 'washer reports an error (saw "ERROR_DOOR"); clear it on the washer first.',
			},
			{
				refusal: { code: 'PAUSE_NOT_RUNNING', state: 'INITIAL' },
				text: 'washer state is INITIAL; vt-pause needs a running cycle.',
			},
			{
				refusal: { code: 'RESUME_NOT_PAUSED', state: 'RUNNING' },
				text: 'washer state is RUNNING; vt-resume needs PAUSE.',
			},
			{
				refusal: { code: 'COURSE_WASHER_POWEROFF', state: 'POWEROFF' },
				text: 'washer is POWEROFF; power it on first (vt-power-on) and wait for INITIAL.',
			},
			{
				refusal: { code: 'COURSE_NOT_INITIAL', state: 'RUNNING' },
				text: 'washer state is RUNNING; vt-course needs INITIAL.',
			},
			{
				refusal: { code: 'COURSE_REMOTE_ON', state: 'INITIAL', seen: '"REMOTE_START_ON"' },
				text: 'Remote Control must be OFF on the washer (saw "REMOTE_START_ON"); the app only offers "Send to washer" when it is off.',
			},
			{
				refusal: { code: 'START_NOT_INITIAL', state: 'RUNNING' },
				text: 'washer state is RUNNING; vt-start needs INITIAL.',
			},
			{
				refusal: { code: 'DOOR_OPEN', state: 'INITIAL', seen: 'doorClose="DOORCLOSE_OFF", doorLock="DOORLOCK_OFF"' },
				text: 'door is not closed (saw doorClose="DOORCLOSE_OFF", doorLock="DOORLOCK_OFF"); close the door.',
			},
			{
				refusal: { code: 'START_REMOTE_OFF', state: 'INITIAL' },
				text: 'Remote Control is OFF on the washer; press the Remote Control button for 3 seconds first.',
			},
			{
				refusal: { code: 'NO_COURSE_STAGED', state: 'INITIAL', seen: 'missing' },
				text: 'no course is staged (washerDryer.course = missing); run vt-course first.',
			},
		];

		it.each(CLI_TEXT)('should produce the exact CLI sentence for $refusal.code', ({ refusal, text }) => {
			// Arrange / Act / Assert
			expect(formatWasherVtRefusalForCli(refusal)).toBe(text);
		});

		it.each(GUARD_CASES)('should match evaluateWasherVtGuard output for $code', (guardCase) => {
			// Arrange
			const fields = fieldsOf(guardCase.fields);
			// Act
			const text = evaluateWasherVtGuard(guardCase.name, fields, guardCase.online, guardCase.allowInterrupt);
			const refusal = checkWasherVtGuard(guardCase.name, fields, guardCase.online, guardCase.allowInterrupt);
			const expected = refusal === undefined ? undefined : formatWasherVtRefusalForCli(refusal);
			// Assert
			expect(text).toBe(expected);
		});

		it.each(PASSING_CASES)(
			'should return undefined from evaluateWasherVtGuard when $name passes',
			({ name, fields }) => {
				// Arrange / Act / Assert
				expect(evaluateWasherVtGuard(name, fieldsOf(fields), true)).toBeUndefined();
			},
		);
	});

	describe('formatWasherVtRefusalForHome', () => {
		it.each([
			{
				refusal: { code: 'STATE_UNREADABLE' } as WasherVtRefusal,
				text: 'Cannot read the washer state from LG. Try again in a minute.',
			},
			{
				refusal: { code: 'OFFLINE' } as WasherVtRefusal,
				text: 'The washer is offline in the LG cloud. Check its Wi-Fi.',
			},
			{
				refusal: { code: 'ONLINE_UNKNOWN' } as WasherVtRefusal,
				text: 'LG did not say whether the washer is online. Try again in a minute.',
			},
			{
				refusal: { code: 'POWER_ON_NOT_POWEROFF', state: 'RUNNING' } as WasherVtRefusal,
				text: 'The washer is already on.',
			},
			{
				refusal: { code: 'ALREADY_POWEROFF', state: 'POWEROFF' } as WasherVtRefusal,
				text: 'The washer is already off.',
			},
			{
				refusal: { code: 'INTERRUPT_NEEDED', state: 'RUNNING' } as WasherVtRefusal,
				text: 'The washer is RUNNING. Turning it off would cancel the wash. Pause it, or allow cancelling in the plugin settings.',
			},
			{
				refusal: { code: 'CHILD_LOCK', state: 'RUNNING' } as WasherVtRefusal,
				text: 'Child lock is on. Turn it off on the washer first.',
			},
			{
				refusal: { code: 'ERROR_PRESENT', state: 'RUNNING' } as WasherVtRefusal,
				text: 'The washer shows an error. Clear it on the washer first.',
			},
			{
				refusal: { code: 'COURSE_WASHER_POWEROFF', state: 'POWEROFF' } as WasherVtRefusal,
				text: 'The washer is off. Turn it on first.',
			},
			{
				refusal: { code: 'COURSE_NOT_INITIAL', state: 'RUNNING' } as WasherVtRefusal,
				text: 'The washer is RUNNING. Start works only when it is ready.',
			},
			{
				refusal: { code: 'COURSE_REMOTE_ON', state: 'INITIAL' } as WasherVtRefusal,
				text: 'Press the Remote Control button on the washer for 3 seconds, then tap Start again.',
			},
			{
				refusal: { code: 'START_NOT_INITIAL', state: 'END' } as WasherVtRefusal,
				text: 'The washer is END. Start works only when it is ready.',
			},
			{
				refusal: { code: 'DOOR_OPEN', state: 'INITIAL' } as WasherVtRefusal,
				text: 'The washer door is not closed. Close it first.',
			},
			{
				refusal: { code: 'START_REMOTE_OFF', state: 'INITIAL' } as WasherVtRefusal,
				text: 'Press the Remote Control button on the washer for 3 seconds, then tap Start again.',
			},
			{
				refusal: { code: 'NO_COURSE_STAGED', state: 'INITIAL' } as WasherVtRefusal,
				text: 'No course is selected on the washer. Pick a Selected Wash Course in the plugin settings.',
			},
		])('should produce the exact Home sentence for $refusal.code', ({ refusal, text }) => {
			// Arrange / Act / Assert
			expect(formatWasherVtRefusalForHome(refusal)).toBe(text);
		});

		it.each(['START_NOT_INITIAL', 'COURSE_NOT_INITIAL', 'PAUSE_NOT_RUNNING', 'RESUME_NOT_PAUSED'] as const)(
			'should say the washer is off when %s happens in POWEROFF',
			(code) => {
				// Arrange
				const refusal: WasherVtRefusal = { code, state: 'POWEROFF' };
				// Act / Assert
				expect(formatWasherVtRefusalForHome(refusal)).toBe('The washer is off. Turn it on first.');
			},
		);

		it('should use the paused wording when cancelling a PAUSEd wash', () => {
			// Arrange
			const refusal: WasherVtRefusal = { code: 'INTERRUPT_NEEDED', state: 'PAUSE' };
			// Act / Assert
			expect(formatWasherVtRefusalForHome(refusal)).toBe(
				'The washer is paused. Turning it off would cancel the wash. Allow cancelling in the plugin settings.',
			);
		});

		it('should say Pause works only while the washer is running', () => {
			// Arrange
			const refusal: WasherVtRefusal = { code: 'PAUSE_NOT_RUNNING', state: 'INITIAL' };
			// Act / Assert
			expect(formatWasherVtRefusalForHome(refusal)).toBe(
				'Pause works only while the washer is running (it is INITIAL).',
			);
		});

		it('should say Resume works only while the washer is paused', () => {
			// Arrange
			const refusal: WasherVtRefusal = { code: 'RESUME_NOT_PAUSED', state: 'RUNNING' };
			// Act / Assert
			expect(formatWasherVtRefusalForHome(refusal)).toBe(
				'Resume works only while the washer is paused (it is RUNNING).',
			);
		});
	});

	describe('isWasherVtExpectedState', () => {
		it.each<[WasherVtSendName, string, boolean]>([
			['vt-power-on', 'INITIAL', true],
			['vt-power-on', 'POWEROFF', false],
			['vt-power-off', 'POWEROFF', true],
			['vt-power-off', 'INITIAL', false],
			['vt-pause', 'PAUSE', true],
			['vt-pause', 'RUNNING', false],
			['vt-resume', 'PAUSE', false],
			['vt-resume', 'RUNNING', true],
			['vt-resume', 'POWEROFF', false],
			['vt-start', 'INITIAL', false],
			['vt-start', 'DETECTING', true],
			['vt-start', 'POWEROFF', false],
			['vt-start', 'DETERGENT_INPUT', true],
		])('should return %s confirmation %s -> %s', (name, state, expected) => {
			// Arrange
			const fields = fieldsOf({ state });
			// Act / Assert
			expect(isWasherVtExpectedState(name, fields)).toBe(expected);
		});

		it('should never confirm vt-course by state alone', () => {
			// Arrange
			const fields = fieldsOf({ state: 'INITIAL', course: 'NORMAL' });
			// Act / Assert
			expect(isWasherVtExpectedState('vt-course', fields)).toBe(false);
		});

		it('should return false when the state is absent', () => {
			// Arrange / Act / Assert
			expect(isWasherVtExpectedState('vt-power-off', {})).toBe(false);
		});
	});

	describe('isWasherVtCourseApplied', () => {
		it('should return true when the course and every option key equal the plan', () => {
			// Arrange
			const fields = fieldsOf({ course: 'NORMAL', spin: 'SPIN_1000', temp: 'TEMP_40' });
			// Act / Assert
			expect(isWasherVtCourseApplied(fields, 'NORMAL', { spin: 'SPIN_1000', temp: 'TEMP_40' })).toBe(true);
		});

		it('should return false when the course differs', () => {
			// Arrange
			const fields = fieldsOf({ course: 'COTTON', spin: 'SPIN_1000' });
			// Act / Assert
			expect(isWasherVtCourseApplied(fields, 'NORMAL', { spin: 'SPIN_1000' })).toBe(false);
		});

		it('should return false when one option differs', () => {
			// Arrange
			const fields = fieldsOf({ course: 'NORMAL', spin: 'SPIN_1400', temp: 'TEMP_40' });
			// Act / Assert
			expect(isWasherVtCourseApplied(fields, 'NORMAL', { spin: 'SPIN_1000', temp: 'TEMP_40' })).toBe(false);
		});

		it('should compare only the course when no options are planned', () => {
			// Arrange
			const fields = fieldsOf({ course: 'NORMAL', spin: 'SPIN_1400' });
			// Act / Assert
			expect(isWasherVtCourseApplied(fields, 'NORMAL', {})).toBe(true);
		});

		it('should return false when the fields are absent', () => {
			// Arrange / Act / Assert
			expect(isWasherVtCourseApplied({}, 'NORMAL', {})).toBe(false);
		});
	});

	describe('rejectedWasherVtCells', () => {
		it('should return only the rejected cells from the real vtAck reply shape', () => {
			// Arrange
			const reply = washerVtReply('0000', [
				['course', '17'],
				['rinse', '17'],
				['spin', '0'],
				['temp', '15'],
			]);
			// Act / Assert
			expect(rejectedWasherVtCells(reply)).toEqual(['temp=15']);
		});

		it('should return an empty list when every cell is applied (0) or already held (17)', () => {
			// Arrange
			const reply = washerVtReply('0000', [
				['course', '0'],
				['spin', '0'],
			]);
			// Act / Assert
			expect(rejectedWasherVtCells(reply)).toEqual([]);
		});

		it('should return an empty list when the reply has no vtAck', () => {
			// Arrange
			const reply = { resultCode: '0000', result: { data: {} } };
			// Act / Assert
			expect(rejectedWasherVtCells(reply)).toEqual([]);
		});
	});

	describe('pollWasherUntil', () => {
		it('should stop after one read when the first read is done', async () => {
			// Arrange
			const read = vi.fn<() => Promise<number>>().mockResolvedValue(1);
			const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
			// Act
			const result = await pollWasherUntil(read, (value) => value === 1, sleep, 5, 100);
			// Assert
			expect(result).toEqual({ value: 1, done: true, polls: 1 });
			expect(sleep).toHaveBeenCalledTimes(1);
		});

		it('should stop on the third read when that read is the first done one', async () => {
			// Arrange
			const read = vi
				.fn<() => Promise<number>>()
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(0)
				.mockResolvedValueOnce(1);
			const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
			// Act
			const result = await pollWasherUntil(read, (value) => value === 1, sleep, 10, 100);
			// Assert
			expect(result).toEqual({ value: 1, done: true, polls: 3 });
		});

		it('should return the last value with done false after exhausting every attempt', async () => {
			// Arrange
			const read = vi.fn<() => Promise<number>>().mockResolvedValue(5);
			const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
			// Act
			const result = await pollWasherUntil(read, (value) => value === 1, sleep, 4, 100);
			// Assert
			expect(result).toEqual({ value: 5, done: false, polls: 4 });
			expect(read).toHaveBeenCalledTimes(4);
		});

		it('should count a throwing read as an attempt and not reject', async () => {
			// Arrange
			const read = vi
				.fn<() => Promise<number>>()
				.mockRejectedValueOnce(new Error('network down'))
				.mockResolvedValueOnce(1);
			const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
			// Act
			const result = await pollWasherUntil(read, (value) => value === 1, sleep, 5, 100);
			// Assert
			expect(result).toEqual({ value: 1, done: true, polls: 2 });
		});

		it('should sleep once per attempt with the given interval', async () => {
			// Arrange
			const read = vi.fn<() => Promise<number>>().mockResolvedValue(0);
			const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
			// Act
			await pollWasherUntil(read, () => false, sleep, 3, 250);
			// Assert
			expect(sleep).toHaveBeenCalledTimes(3);
			expect(sleep).toHaveBeenNthCalledWith(1, 250);
			expect(sleep).toHaveBeenNthCalledWith(3, 250);
		});
	});

	describe('constants', () => {
		it('should use a 10 second send timeout, 16 power polls and a 2 minute start lock-out', () => {
			// Arrange / Act / Assert
			expect(WASHER_VT_SEND_TIMEOUT_MS).toBe(10_000);
			expect(WASHER_VT_POWER_POLL_ATTEMPTS).toBe(16);
			expect(WASHER_VT_START_LOCKOUT_MS).toBe(120_000);
		});

		it('should list the 26 running states including the original 11', () => {
			// Arrange
			const original = [
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
			// Act / Assert
			expect(WASHER_VT_RUNNING_STATES).toHaveLength(26);
			expect(WASHER_VT_RUNNING_STATES).toEqual(expect.arrayContaining(original));
		});

		it('should make the power-off safe states the idle states minus POWEROFF', () => {
			// Arrange / Act / Assert
			expect(WASHER_VT_POWER_OFF_SAFE_STATES).toEqual(['INITIAL', 'END', 'COMPLETE', 'ERROR']);
		});

		it('should list the idle states INITIAL, END, COMPLETE, POWEROFF and ERROR', () => {
			// Arrange / Act / Assert
			expect(WASHER_VT_IDLE_STATES).toEqual(['INITIAL', 'END', 'COMPLETE', 'POWEROFF', 'ERROR']);
		});
	});
});
