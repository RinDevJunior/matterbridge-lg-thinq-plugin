import { describe, expect, it, vi } from 'vitest';

import { changedWasherFieldKeys } from '../../../cli/commands/washerCommon.js';
import {
	buildWasherVtCells,
	buildWasherVtRequest,
	classifyWasherVtOutcome,
	evaluateWasherVtGuard,
	extractWasherVtReturnCodes,
	isWasherVtSendName,
	pollWasherFields,
	type WasherVtSendName,
} from '../../../cli/commands/washerVtCtrl.js';
import { createFakeWasherModel, fieldsOf } from '../../helpers/washerFixtures.js';

const VT_COURSE_CELL = { cmd: 'course', value: 'NORMAL', type: 'ABSOLUTE' };

/** Healthy washer, ready for vt-course: INITIAL, Remote Control OFF, child lock off, no error. */
const READY_FOR_COURSE = {
	state: 'INITIAL',
	remoteStart: 'REMOTE_START_OFF',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
	online: true,
};

/** Healthy washer, ready for vt-start: INITIAL, door closed, Remote Control ON, course staged. */
const READY_FOR_START = {
	state: 'INITIAL',
	doorClose: 'DOORCLOSE_ON',
	remoteStart: 'REMOTE_START_ON',
	course: 'NORMAL',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
	online: true,
};

describe('washerVtCtrl', () => {
	describe('isWasherVtSendName', () => {
		it.each(['vt-course', 'vt-start', 'vt-pause', 'vt-power-on'])('should return true for %s', (name) => {
			// Arrange / Act
			const result = isWasherVtSendName(name);

			// Assert
			expect(result).toBe(true);
		});

		it.each(['wake', 'download-off', 'vt-power-off', 'VT-COURSE'])('should return false for %s', (name) => {
			// Arrange / Act
			const result = isWasherVtSendName(name);

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('buildWasherVtCells', () => {
		it('should emit one lowercase course cell when vt-course has no options', () => {
			// Arrange
			const name: WasherVtSendName = 'vt-course';

			// Act
			const cells = buildWasherVtCells(name, 'NORMAL', {});

			// Assert
			expect(cells).toStrictEqual([VT_COURSE_CELL]);
		});

		it('should order course, soilWash, rinse, spin, temp and include only the passed keys', () => {
			// Arrange
			const options = { temp: 'TEMP_COLD', rinse: 'RINSE_3', soilWash: 'SOILWASH_HEAVY', spin: 'SPIN_800' };

			// Act
			const cells = buildWasherVtCells('vt-course', 'NORMAL', options);

			// Assert
			expect(cells.map((cell) => cell.cmd)).toStrictEqual(['course', 'soilWash', 'rinse', 'spin', 'temp']);
			expect(cells).toStrictEqual([
				VT_COURSE_CELL,
				{ cmd: 'soilWash', value: 'SOILWASH_HEAVY', type: 'ABSOLUTE' },
				{ cmd: 'rinse', value: 'RINSE_3', type: 'ABSOLUTE' },
				{ cmd: 'spin', value: 'SPIN_800', type: 'ABSOLUTE' },
				{ cmd: 'temp', value: 'TEMP_COLD', type: 'ABSOLUTE' },
			]);
		});

		it('should omit option cells that were not passed', () => {
			// Arrange
			const options = { spin: 'SPIN_800' };

			// Act
			const cells = buildWasherVtCells('vt-course', 'NORMAL', options);

			// Assert
			expect(cells).toStrictEqual([VT_COURSE_CELL, { cmd: 'spin', value: 'SPIN_800', type: 'ABSOLUTE' }]);
		});

		it('should emit a single wmControl START cell for vt-start', () => {
			// Arrange / Act
			const cells = buildWasherVtCells('vt-start', undefined, {});

			// Assert
			expect(cells).toStrictEqual([{ cmd: 'wmControl', value: 'START', type: 'ABSOLUTE' }]);
		});

		it('should emit a single wmControl PAUSE cell for vt-pause', () => {
			// Arrange / Act
			const cells = buildWasherVtCells('vt-pause', undefined, {});

			// Assert
			expect(cells).toStrictEqual([{ cmd: 'wmControl', value: 'PAUSE', type: 'ABSOLUTE' }]);
		});

		it('should emit a single power POWER_ON cell for vt-power-on', () => {
			// Arrange / Act
			const cells = buildWasherVtCells('vt-power-on', undefined, {});

			// Assert
			expect(cells).toStrictEqual([{ cmd: 'power', value: 'POWER_ON', type: 'ABSOLUTE' }]);
		});
	});

	describe('buildWasherVtRequest', () => {
		it('should build the variant A body with the exact dataSetList when variant is a', () => {
			// Arrange
			const model = createFakeWasherModel();

			// Act
			const request = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Assert
			expect(request?.body.ctrlKey).toBe('vtCtrl');
			expect(request?.body.command).toBe('Set');
			expect(request?.body.dataSetList).toStrictEqual({
				ctrlTarget: ['UNDEFINE'],
				reqDevType: 'APP',
				productType: 'NORMAL',
				vtData: { UNDEFINE: [VT_COURSE_CELL] },
			});
		});

		it('should wrap the same inner object under dataSetList.vtCtrl when variant is b', () => {
			// Arrange
			const model = createFakeWasherModel();
			const variantA = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Act
			const variantB = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'b' });

			// Assert
			expect(variantB?.body.dataSetList).toStrictEqual({ vtCtrl: variantA?.body.dataSetList });
			expect(variantB?.body.ctrlKey).toBe(variantA?.body.ctrlKey);
			expect(variantB?.body.command).toBe(variantA?.body.command);
		});

		it('should return undefined when Config.uniProtocol is missing', () => {
			// Arrange
			const model = createFakeWasherModel();
			const config = model.Config as Record<string, unknown>;
			delete config.uniProtocol;

			// Act
			const request = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Assert
			expect(request).toBeUndefined();
		});

		it('should return undefined when Config.uniProtocol is false', () => {
			// Arrange
			const model = createFakeWasherModel();
			(model.Config as Record<string, unknown>).uniProtocol = false;

			// Act
			const request = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Assert
			expect(request).toBeUndefined();
		});

		it('should return undefined when ControlWifi.vtCtrl is missing', () => {
			// Arrange
			const model = createFakeWasherModel();
			delete (model.ControlWifi as Record<string, unknown>).vtCtrl;

			// Act
			const request = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Assert
			expect(request).toBeUndefined();
		});

		it('should return undefined when vtCtrl.command is not Set', () => {
			// Arrange
			const model = createFakeWasherModel();
			(model.ControlWifi as Record<string, Record<string, unknown>>).vtCtrl.command = 'Get';

			// Act
			const request = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Assert
			expect(request).toBeUndefined();
		});

		it('should return undefined when vt-course has no courseId', () => {
			// Arrange
			const model = createFakeWasherModel();

			// Act
			const request = buildWasherVtRequest('vt-course', model, { variant: 'a' });

			// Assert
			expect(request).toBeUndefined();
		});

		it('should never contain dataKey, dataValue or an http URI in the body', () => {
			// Arrange
			const model = createFakeWasherModel();

			// Act
			const request = buildWasherVtRequest('vt-course', model, {
				courseId: 'NORMAL',
				options: { spin: 'SPIN_800' },
				variant: 'b',
			});
			const serialized = JSON.stringify(request?.body);

			// Assert
			expect(serialized).not.toContain('dataKey');
			expect(serialized).not.toContain('dataValue');
			expect(serialized).not.toContain('http');
		});

		it('should set mayStartCycle true only for vt-start', () => {
			// Arrange
			const model = createFakeWasherModel();

			// Act
			const start = buildWasherVtRequest('vt-start', model, { variant: 'a' });
			const pause = buildWasherVtRequest('vt-pause', model, { variant: 'a' });
			const powerOn = buildWasherVtRequest('vt-power-on', model, { variant: 'a' });
			const course = buildWasherVtRequest('vt-course', model, { courseId: 'NORMAL', variant: 'a' });

			// Assert
			expect(start?.mayStartCycle).toBe(true);
			expect(pause?.mayStartCycle).toBe(false);
			expect(powerOn?.mayStartCycle).toBe(false);
			expect(course?.mayStartCycle).toBe(false);
		});
	});

	describe('evaluateWasherVtGuard', () => {
		describe('common checks', () => {
			it('should refuse when state is absent with the cannot-confirm message', () => {
				// Arrange
				const fields = fieldsOf({ remoteStart: 'REMOTE_START_OFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('cannot confirm washer state');
			});

			it('should refuse with offline when online is false', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, online: false });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, false);

				// Assert
				expect(reason).toContain('offline');
			});

			it('should refuse with online status unknown when online is undefined', () => {
				// Arrange
				const fields = fieldsOf(READY_FOR_COURSE);

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, undefined);

				// Assert
				expect(reason).toContain('online status unknown');
			});

			it('should end the refusal message with a period', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, online: false });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, false);

				// Assert
				expect(reason?.endsWith('.')).toBe(true);
			});
		});

		describe('vt-power-on', () => {
			it('should pass when state is POWEROFF even without childLock or error fields', () => {
				// Arrange
				const fields = fieldsOf({ state: 'POWEROFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-power-on', fields, true);

				// Assert
				expect(reason).toBeUndefined();
			});

			it('should refuse with needs POWEROFF when state is INITIAL', () => {
				// Arrange
				const fields = fieldsOf(READY_FOR_COURSE);

				// Act
				const reason = evaluateWasherVtGuard('vt-power-on', fields, true);

				// Assert
				expect(reason).toContain('vt-power-on needs POWEROFF');
			});

			it('should refuse when state is RUNNING', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, state: 'RUNNING' });

				// Act
				const reason = evaluateWasherVtGuard('vt-power-on', fields, true);

				// Assert
				expect(reason).toContain('vt-power-on needs POWEROFF');
			});
		});

		describe('vt-course', () => {
			it('should pass when state is INITIAL, Remote Control OFF, child lock OFF and no error', () => {
				// Arrange
				const fields = fieldsOf(READY_FOR_COURSE);

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toBeUndefined();
			});

			it('should refuse with power it on first when state is POWEROFF', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, state: 'POWEROFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('power it on first');
			});

			it('should refuse when state is RUNNING', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, state: 'RUNNING' });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('vt-course needs INITIAL');
			});

			it('should refuse when Remote Control is ON', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, remoteStart: 'REMOTE_START_ON' });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('Remote Control must be OFF');
			});

			it('should refuse when remoteStart is missing', () => {
				// Arrange
				const { remoteStart: _omitted, ...rest } = READY_FOR_COURSE;
				const fields = fieldsOf(rest);

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('Remote Control must be OFF');
			});

			it('should refuse when child lock is on', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, childLock: 'CHILDLOCK_ON' });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('child lock is on');
			});

			it('should refuse when child lock is missing (fail closed)', () => {
				// Arrange
				const { childLock: _omitted, ...rest } = READY_FOR_COURSE;
				const fields = fieldsOf(rest);

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('child lock is on or unreadable');
			});

			it('should refuse when the washer reports ERROR_DE1', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, error: 'ERROR_DE1' });

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('washer reports an error');
			});

			it('should refuse when error is missing (fail closed)', () => {
				// Arrange
				const { error: _omitted, ...rest } = READY_FOR_COURSE;
				const fields = fieldsOf(rest);

				// Act
				const reason = evaluateWasherVtGuard('vt-course', fields, true);

				// Assert
				expect(reason).toContain('washer reports an error');
			});
		});

		describe('vt-pause', () => {
			it.each(['RUNNING', 'RINSING', 'SPINNING'])('should pass when state is %s', (state) => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, state });

				// Act
				const reason = evaluateWasherVtGuard('vt-pause', fields, true);

				// Assert
				expect(reason).toBeUndefined();
			});

			it.each(['INITIAL', 'POWEROFF', 'PAUSE', 'END'])('should refuse when state is %s', (state) => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, state });

				// Act
				const reason = evaluateWasherVtGuard('vt-pause', fields, true);

				// Assert
				expect(reason).toContain('vt-pause needs a running cycle');
			});

			it('should refuse when child lock is on', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_COURSE, state: 'RUNNING', childLock: 'CHILDLOCK_ON' });

				// Act
				const reason = evaluateWasherVtGuard('vt-pause', fields, true);

				// Assert
				expect(reason).toContain('child lock is on');
			});
		});

		describe('vt-start', () => {
			it('should pass when every staged condition is met', () => {
				// Arrange
				const fields = fieldsOf(READY_FOR_START);

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toBeUndefined();
			});

			it('should refuse when state is RUNNING', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, state: 'RUNNING' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('vt-start needs INITIAL');
			});

			it('should refuse when the door is open', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_OFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('door is not closed');
			});

			it('should pass when doorLock is ON even though doorClose is OFF', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_OFF', doorLock: 'DOORLOCK_ON' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toBeUndefined();
			});

			it('should pass when doorClose is ON even though doorLock is OFF', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_ON', doorLock: 'DOORLOCK_OFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toBeUndefined();
			});

			it('should refuse and show both values when doorClose and doorLock are both OFF', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_OFF', doorLock: 'DOORLOCK_OFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toBe(
					'door is not closed (saw doorClose="DOORCLOSE_OFF", doorLock="DOORLOCK_OFF"); close the door.',
				);
			});

			it('should show doorLock as missing when doorClose is OFF and doorLock is absent', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, doorClose: 'DOORCLOSE_OFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toBe('door is not closed (saw doorClose="DOORCLOSE_OFF", doorLock=missing); close the door.');
			});

			it('should refuse when the door state is missing', () => {
				// Arrange
				const { doorClose: _omitted, ...rest } = READY_FOR_START;
				const fields = fieldsOf(rest);

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toBe('door is not closed (saw doorClose=missing, doorLock=missing); close the door.');
			});

			it('should refuse when Remote Control is OFF', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, remoteStart: 'REMOTE_START_OFF' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('Remote Control is OFF on the washer');
			});

			it('should refuse when no course is staged', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, course: 'NOT_SELECTED' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('no course is staged');
			});

			it('should refuse when the course field is missing', () => {
				// Arrange
				const { course: _omitted, ...rest } = READY_FOR_START;
				const fields = fieldsOf(rest);

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('no course is staged (washerDryer.course = missing)');
			});

			it('should refuse when child lock is on', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, childLock: 'CHILDLOCK_ON' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('child lock is on');
			});

			it('should refuse when the washer reports an error', () => {
				// Arrange
				const fields = fieldsOf({ ...READY_FOR_START, error: 'ERROR_DE1' });

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, true);

				// Assert
				expect(reason).toContain('washer reports an error');
			});

			it('should refuse with offline when online is false even if every field is good', () => {
				// Arrange
				const fields = fieldsOf(READY_FOR_START);

				// Act
				const reason = evaluateWasherVtGuard('vt-start', fields, false);

				// Assert
				expect(reason).toContain('offline');
			});
		});
	});

	describe('classifyWasherVtOutcome', () => {
		it('should start the first line with Verdict: and say likely applied for 0000 with a changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: '0000', changedKeys: ['course'] });

			// Assert
			expect(lines[0].startsWith('Verdict: ')).toBe(true);
			expect(lines[0]).toContain('likely applied');
		});

		it('should say not proven applied for 0000 with no changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: '0000', changedKeys: [] });

			// Assert
			expect(lines[0]).toContain('Not proven applied');
		});

		it('should say LIKELY applied with an inference caveat for 0111 with a changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: '0111', changedKeys: ['state'] });

			// Assert
			expect(lines[0]).toContain('LIKELY applied');
			expect(lines[0]).toContain('inference, not proof');
		});

		it('should say Likely NOT applied for 0111 with no changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: '0111', changedKeys: [] });

			// Assert
			expect(lines[0]).toContain('Likely NOT applied');
		});

		it('should say Not applied for another code with no changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: '0114', changedKeys: [] });

			// Assert
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain('Not applied');
		});

		it('should add a second line when another code arrives with a changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: '0114', changedKeys: ['course'] });

			// Assert
			expect(lines).toHaveLength(2);
			expect(lines[0]).toContain('Not applied');
			expect(lines[1]).toContain('A tracked field changed anyway');
		});

		it('should report no resultCode with no changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: undefined, changedKeys: [] });

			// Assert
			expect(lines).toStrictEqual(['Verdict: no resultCode in the reply and no tracked field changed.']);
		});

		it('should report no resultCode with a changed field', () => {
			// Arrange / Act
			const lines = classifyWasherVtOutcome({ resultCode: undefined, changedKeys: ['course'] });

			// Assert
			expect(lines[0]).toContain('no resultCode in the reply, but the status changed (course)');
		});
	});

	describe('extractWasherVtReturnCodes', () => {
		it('should return course=0000 for a nested result.data.vtAck.response.UNDEFINE[0] reply', () => {
			// Arrange
			const reply = {
				result: {
					data: {
						vtAck: { response: { UNDEFINE: [{ cmd: 'course', returnCode: '0000' }] } },
					},
				},
			};

			// Act
			const codes = extractWasherVtReturnCodes(reply);

			// Assert
			expect(codes).toStrictEqual(['course=0000']);
		});

		it('should return course=0000 and spin=0111 for a nested vtAck.response.UNDEFINE reply with two cells', () => {
			// Arrange
			const reply = {
				result: {
					data: {
						vtAck: {
							response: {
								UNDEFINE: [
									{ cmd: 'course', returnCode: '0000' },
									{ cmd: 'spin', returnCode: '0111' },
								],
							},
						},
					},
				},
			};

			// Act
			const codes = extractWasherVtReturnCodes(reply);

			// Assert
			expect(codes).toStrictEqual(['course=0000', 'spin=0111']);
		});

		it('should return an empty list for an unknown nested vtAck shape with no returnCode', () => {
			// Arrange
			const reply = {
				result: {
					data: {
						vtAck: { response: { UNDEFINE: [{ cmd: 'course', status: 'ok' }] } },
					},
				},
			};

			// Act
			const codes = extractWasherVtReturnCodes(reply);

			// Assert
			expect(codes).toStrictEqual([]);
		});

		it('should return course=0000 for a direct vtAck array of cmd and returnCode entries', () => {
			// Arrange
			const reply = { vtAck: [{ cmd: 'course', returnCode: '0000' }] };

			// Act
			const codes = extractWasherVtReturnCodes(reply);

			// Assert
			expect(codes).toStrictEqual(['course=0000']);
		});

		it('should return an empty list when the reply has no vtAck key', () => {
			// Arrange
			const reply = { resultCode: '0000', result: { data: { other: true } } };

			// Act
			const codes = extractWasherVtReturnCodes(reply);

			// Assert
			expect(codes).toStrictEqual([]);
		});

		it.each([undefined, 'x', null, 42])('should return an empty list for a non-object reply %j', (reply) => {
			// Arrange / Act
			const codes = extractWasherVtReturnCodes(reply);

			// Assert
			expect(codes).toStrictEqual([]);
		});

		it('should not throw on a circular reply and stop at the depth limit', () => {
			// Arrange
			const reply: Record<string, unknown> = { level: 0 };
			reply.self = reply;

			// Act
			const act = () => extractWasherVtReturnCodes(reply);

			// Assert
			expect(act).not.toThrow();
			expect(act()).toStrictEqual([]);
		});

		it('should ignore a vtAck nested deeper than depth 6', () => {
			// Arrange
			let deep: Record<string, unknown> = { vtAck: { cmd: 'course', returnCode: '0000' } };
			for (let level = 0; level < 8; level++) {
				deep = { next: deep };
			}

			// Act
			const codes = extractWasherVtReturnCodes(deep);

			// Assert
			expect(codes).toStrictEqual([]);
		});
	});

	describe('pollWasherFields', () => {
		const BEFORE = fieldsOf({ state: 'INITIAL', course: 'NOT_SELECTED' });

		it('should poll 10 times with 500 ms sleeps and report no changes when nothing changes', async () => {
			// Arrange
			const sleepFn = vi.fn().mockResolvedValue(undefined);
			const readFields = vi.fn().mockResolvedValue(BEFORE);

			// Act
			const result = await pollWasherFields(readFields, BEFORE, sleepFn);

			// Assert
			expect(result.polls).toBe(10);
			expect(sleepFn).toHaveBeenCalledTimes(10);
			expect(sleepFn).toHaveBeenCalledWith(500);
			expect(result.changedKeys).toStrictEqual([]);
		});

		it('should stop on the 3rd read and list the changed key when the course changes', async () => {
			// Arrange
			const sleepFn = vi.fn().mockResolvedValue(undefined);
			const changed = fieldsOf({ state: 'INITIAL', course: 'NORMAL' });
			const readFields = vi
				.fn()
				.mockResolvedValueOnce(BEFORE)
				.mockResolvedValueOnce(BEFORE)
				.mockResolvedValueOnce(changed);

			// Act
			const result = await pollWasherFields(readFields, BEFORE, sleepFn);

			// Assert
			expect(result.polls).toBe(3);
			expect(result.changedKeys).toStrictEqual(['course']);
			expect(readFields).toHaveBeenCalledTimes(3);
			expect(result.fields).toStrictEqual(changed);
		});

		it('should honour custom attempts and intervalMs', async () => {
			// Arrange
			const sleepFn = vi.fn().mockResolvedValue(undefined);
			const readFields = vi.fn().mockResolvedValue(BEFORE);

			// Act
			const result = await pollWasherFields(readFields, BEFORE, sleepFn, 2, 10);

			// Assert
			expect(result.polls).toBe(2);
			expect(sleepFn).toHaveBeenCalledTimes(2);
			expect(sleepFn).toHaveBeenCalledWith(10);
		});

		it('should reject with the same error when readFields rejects on the 2nd call', async () => {
			// Arrange
			const sleepFn = vi.fn().mockResolvedValue(undefined);
			const failure = new Error('cloud read failed');
			const readFields = vi.fn().mockResolvedValueOnce(BEFORE).mockRejectedValueOnce(failure);

			// Act
			const act = pollWasherFields(readFields, BEFORE, sleepFn);

			// Assert
			await expect(act).rejects.toBe(failure);
		});
	});

	describe('changedWasherFieldKeys', () => {
		it('should return an empty list when both snapshots are equal', () => {
			// Arrange
			const before = { state: '"INITIAL"', course: '"NORMAL"' };
			const after = { state: '"INITIAL"', course: '"NORMAL"' };

			// Act
			const keys = changedWasherFieldKeys(before, after);

			// Assert
			expect(keys).toStrictEqual([]);
		});

		it('should return the key whose value changed', () => {
			// Arrange
			const before = { state: '"INITIAL"', course: '"NORMAL"' };
			const after = { state: '"INITIAL"', course: '"COTTONPLUS"' };

			// Act
			const keys = changedWasherFieldKeys(before, after);

			// Assert
			expect(keys).toStrictEqual(['course']);
		});

		it('should treat a key only present in after as changed from absent', () => {
			// Arrange
			const before = { state: '"INITIAL"' };
			const after = { state: '"INITIAL"', error: '"ERROR_NO"' };

			// Act
			const keys = changedWasherFieldKeys(before, after);

			// Assert
			expect(keys).toStrictEqual(['error']);
		});

		it('should return the changed keys sorted', () => {
			// Arrange
			const before = { state: '"INITIAL"', course: '"A"', error: '"X"' };
			const after = { state: '"RUNNING"', course: '"B"', error: '"Y"' };

			// Act
			const keys = changedWasherFieldKeys(before, after);

			// Assert
			expect(keys).toStrictEqual(['course', 'error', 'state']);
		});
	});
});
