import { describe, expect, it } from 'vitest';

import type { ThinqConnectPayload } from './thinqConnectApiClient.js';
import {
	buildWasherOperationPayload,
	buildWasherPowerPayload,
	describeWasherCommandFailure,
	evaluateWasherCycleCommand,
	evaluateWasherPowerGuards,
	findProfileLocationName,
	isWasherPoweredOn,
	PAUSED_STATES,
	readWasherCurrentState,
	readWasherOperationModeProfile,
	readWasherRemainingSeconds,
	readWasherRemoteControlEnabled,
	RUNNING_STATES,
	STOPPED_STATES,
	WASHER_START_READY_STATES,
	type WasherOperationModeProfile,
	type WasherPowerCommand,
} from './thinqConnectWasher.js';

const FULL_MODE: WasherOperationModeProfile = {
	writable: true,
	allowedValues: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'],
};

/** Builds `levels` nested wrapper objects around `leaf`, so the leaf sits at depth `levels`. */
function nest(levels: number, leaf: Record<string, unknown>): ThinqConnectPayload {
	let node: Record<string, unknown> = leaf;
	for (let i = 0; i < levels; i++) {
		node = { child: node };
	}
	return node;
}

describe('thinqConnectWasher', () => {
	describe('findProfileLocationName', () => {
		it('should return the locationName when nested under property[].location', () => {
			// Arrange
			const profile: ThinqConnectPayload = { property: [{ location: { locationName: 'MAIN' } }] };

			// Act
			const result = findProfileLocationName(profile);

			// Assert
			expect(result).toBe('MAIN');
		});

		it('should return undefined when no location is present', () => {
			// Arrange
			const profile: ThinqConnectPayload = { foo: 'bar' };

			// Act
			const result = findProfileLocationName(profile);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when the locationName is an empty string', () => {
			// Arrange
			const profile: ThinqConnectPayload = { location: { locationName: '' } };

			// Act
			const result = findProfileLocationName(profile);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should find the locationName at depth 5 and ignore it at depth 7', () => {
			// Arrange
			const found = nest(5, { location: { locationName: 'DEEP' } });
			const tooDeep = nest(7, { location: { locationName: 'DEEP' } });

			// Act
			const foundResult = findProfileLocationName(found);
			const tooDeepResult = findProfileLocationName(tooDeep);

			// Assert
			expect(foundResult).toBe('DEEP');
			expect(tooDeepResult).toBeUndefined();
		});

		it('should return undefined when the profile is undefined', () => {
			// Act
			const result = findProfileLocationName(undefined);

			// Assert
			expect(result).toBeUndefined();
		});
	});

	describe('readWasherOperationModeProfile', () => {
		it('should return writable with all four allowed values when mode includes w', () => {
			// Arrange
			const profile: ThinqConnectPayload = {
				washerOperationMode: { mode: ['w'], value: { w: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] } },
			};

			// Act
			const result = readWasherOperationModeProfile(profile);

			// Assert
			expect(result).toEqual({ writable: true, allowedValues: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] });
		});

		it('should return writable false when mode is read-only', () => {
			// Arrange
			const profile: ThinqConnectPayload = {
				washerOperationMode: { mode: ['r'], value: { w: ['POWER_ON'] } },
			};

			// Act
			const result = readWasherOperationModeProfile(profile);

			// Assert
			expect(result?.writable).toBe(false);
		});

		it('should return undefined when washerOperationMode is absent', () => {
			// Arrange
			const profile: ThinqConnectPayload = [{ location: { locationName: 'MAIN' } }];

			// Act
			const result = readWasherOperationModeProfile(profile);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return an empty allowed list when value.w is absent', () => {
			// Arrange
			const profile: ThinqConnectPayload = { washerOperationMode: { mode: ['w'] } };

			// Act
			const result = readWasherOperationModeProfile(profile);

			// Assert
			expect(result).toEqual({ writable: true, allowedValues: [] });
		});
	});

	describe('readWasherRemainingSeconds', () => {
		const twoLocations: ThinqConnectPayload = [
			{ location: { locationName: 'A' }, timer: { remainHour: 2, remainMinute: 0 } },
			{ location: { locationName: 'MAIN' }, timer: { remainHour: 0, remainMinute: 45 } },
		];

		it('should convert remainHour and remainMinute to seconds for an array state', () => {
			// Arrange
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'MAIN' }, timer: { remainHour: 1, remainMinute: 30 } },
			];

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBe(5400);
		});

		it('should pick the block matching the locationName instead of the first entry', () => {
			// Act
			const result = readWasherRemainingSeconds(twoLocations, 'MAIN');

			// Assert
			expect(result).toBe(2700);
		});

		it('should fall back to the first entry when the locationName matches nothing', () => {
			// Act
			const result = readWasherRemainingSeconds(twoLocations, 'unknown-location');

			// Assert
			expect(result).toBe(7200);
		});

		it('should read the timer from a plain-object (non-array) state', () => {
			// Arrange
			const state: ThinqConnectPayload = { timer: { remainHour: 0, remainMinute: 10 } };

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBe(600);
		});

		it('should count only remainHour when remainMinute is missing', () => {
			// Arrange
			const state: ThinqConnectPayload = { timer: { remainHour: 2 } };

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBe(7200);
		});

		it('should count only remainMinute when remainHour is missing', () => {
			// Arrange
			const state: ThinqConnectPayload = { timer: { remainMinute: 5 } };

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBe(300);
		});

		it('should return 0, not undefined, when both remainHour and remainMinute are 0', () => {
			// Arrange
			const state: ThinqConnectPayload = { timer: { remainHour: 0, remainMinute: 0 } };

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBe(0);
		});

		it('should return undefined when the timer is missing', () => {
			// Arrange
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'MAIN' }, runState: { currentState: 'RUNNING' } },
			];

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when the state is undefined', () => {
			// Act
			const result = readWasherRemainingSeconds(undefined, 'MAIN');

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when the selected block is not an object', () => {
			// Arrange
			const state: ThinqConnectPayload = ['not-an-object'];

			// Act
			const result = readWasherRemainingSeconds(state, undefined);

			// Assert
			expect(result).toBeUndefined();
		});

		it.each<[string, Record<string, unknown>]>([
			['numeric strings', { remainHour: '1', remainMinute: '30' }],
			['NaN', { remainHour: Number.NaN, remainMinute: Number.NaN }],
			['negative values', { remainHour: -1, remainMinute: -5 }],
		])('should return undefined when both values are invalid (%s)', (_label, timer) => {
			// Arrange
			const state: ThinqConnectPayload = { timer };

			// Act
			const result = readWasherRemainingSeconds(state, 'MAIN');

			// Assert
			expect(result).toBeUndefined();
		});
	});

	describe('readWasherCurrentState', () => {
		const twoLocations: ThinqConnectPayload = [
			{ location: { locationName: 'A' }, runState: { currentState: 'RUNNING' } },
			{ location: { locationName: 'MAIN' }, runState: { currentState: 'POWER_OFF' } },
		];

		it('should pick the array entry matching the locationName', () => {
			// Act
			const result = readWasherCurrentState(twoLocations, 'MAIN');

			// Assert
			expect(result).toBe('POWER_OFF');
		});

		it('should fall back to the first entry when the locationName matches nothing', () => {
			// Act
			const result = readWasherCurrentState(twoLocations, 'unknown-location');

			// Assert
			expect(result).toBe('RUNNING');
		});

		it('should fall back to the first entry when the locationName is undefined', () => {
			// Act
			const result = readWasherCurrentState(twoLocations, undefined);

			// Assert
			expect(result).toBe('RUNNING');
		});

		it('should read currentState from a plain-object state (AC style)', () => {
			// Arrange
			const state: ThinqConnectPayload = { runState: { currentState: 'PAUSE' } };

			// Act
			const result = readWasherCurrentState(state, 'MAIN');

			// Assert
			expect(result).toBe('PAUSE');
		});

		it('should return undefined when currentState is absent', () => {
			// Arrange
			const state: ThinqConnectPayload = { runState: {} };

			// Act
			const result = readWasherCurrentState(state, 'MAIN');

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when currentState is not a string', () => {
			// Arrange
			const state: ThinqConnectPayload = { runState: { currentState: 5 } };

			// Act
			const result = readWasherCurrentState(state, 'MAIN');

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when the state is undefined', () => {
			// Act
			const result = readWasherCurrentState(undefined, 'MAIN');

			// Assert
			expect(result).toBeUndefined();
		});
	});

	describe('isWasherPoweredOn', () => {
		it('should return false when currentState is POWER_OFF', () => {
			// Act
			const result = isWasherPoweredOn('POWER_OFF');

			// Assert
			expect(result).toBe(false);
		});

		it.each(['INITIAL', 'RUNNING', 'PAUSE'])('should return true when currentState is %s', (currentState) => {
			// Act
			const result = isWasherPoweredOn(currentState);

			// Assert
			expect(result).toBe(true);
		});

		it('should return undefined when currentState is undefined', () => {
			// Act
			const result = isWasherPoweredOn(undefined);

			// Assert
			expect(result).toBeUndefined();
		});
	});

	describe('buildWasherPowerPayload', () => {
		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should include location and operation when locationName is set for %s',
			(command) => {
				// Act
				const payload = buildWasherPowerPayload(command, 'MAIN');

				// Assert
				expect(payload).toEqual({
					location: { locationName: 'MAIN' },
					operation: { washerOperationMode: command },
				});
			},
		);

		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should include only operation when locationName is undefined for %s',
			(command) => {
				// Act
				const payload = buildWasherPowerPayload(command, undefined);

				// Assert
				expect(payload).toEqual({ operation: { washerOperationMode: command } });
				expect(payload).not.toHaveProperty('location');
			},
		);
	});

	describe('evaluateWasherPowerGuards', () => {
		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should refuse with a profile-missing reason for %s when mode is undefined',
			(command) => {
				// Act
				const reason = evaluateWasherPowerGuards(command, undefined, 'POWER_OFF');

				// Assert
				expect(reason).toBe('Profile has no washerOperationMode (not a washer, or not exposed).');
			},
		);

		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should refuse with a not-writable reason for %s when mode is read-only',
			(command) => {
				// Arrange
				const mode: WasherOperationModeProfile = { writable: false, allowedValues: [command] };

				// Act
				const reason = evaluateWasherPowerGuards(command, mode, 'POWER_OFF');

				// Assert
				expect(reason).toBe('washerOperationMode is not writable for this device.');
			},
		);

		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should refuse listing the allowed values when %s is not listed',
			(command) => {
				// Arrange
				const mode: WasherOperationModeProfile = { writable: true, allowedValues: ['START'] };

				// Act
				const reason = evaluateWasherPowerGuards(command, mode, 'POWER_OFF');

				// Assert
				expect(reason).toBe(`Profile does not list "${command}" as writable (allowed: START).`);
			},
		);

		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should refuse with "allowed: none" for %s when the allowed list is empty',
			(command) => {
				// Arrange
				const mode: WasherOperationModeProfile = { writable: true, allowedValues: [] };

				// Act
				const reason = evaluateWasherPowerGuards(command, mode, 'POWER_OFF');

				// Assert
				expect(reason).toBe(`Profile does not list "${command}" as writable (allowed: none).`);
			},
		);

		it.each<[WasherPowerCommand]>([['POWER_ON'], ['POWER_OFF']])(
			'should refuse with an unknown-state reason for %s when currentState is undefined',
			(command) => {
				// Act
				const reason = evaluateWasherPowerGuards(command, FULL_MODE, undefined);

				// Assert
				expect(reason).toBe('Washer state is unknown; refusing to send.');
			},
		);

		it.each<[WasherPowerCommand, string]>([
			['POWER_ON', 'RUNNING'],
			['POWER_ON', 'PAUSE'],
			['POWER_OFF', 'RUNNING'],
			['POWER_OFF', 'PAUSE'],
		])('should refuse to interrupt a cycle for %s when state is %s', (command, currentState) => {
			// Act
			const reason = evaluateWasherPowerGuards(command, FULL_MODE, currentState);

			// Assert
			expect(reason).toBe(`Washer is ${currentState}; refusing to interrupt a cycle.`);
		});

		it.each<[WasherPowerCommand, string]>([
			['POWER_ON', 'INITIAL'],
			['POWER_ON', 'POWER_OFF'],
			['POWER_ON', 'END'],
			['POWER_ON', 'ERROR'],
			['POWER_OFF', 'INITIAL'],
			['POWER_OFF', 'POWER_OFF'],
			['POWER_OFF', 'END'],
			['POWER_OFF', 'ERROR'],
		])('should allow %s when state is %s and the profile is valid', (command, currentState) => {
			// Act
			const reason = evaluateWasherPowerGuards(command, FULL_MODE, currentState);

			// Assert
			expect(reason).toBeUndefined();
		});
	});
	describe('readWasherRemoteControlEnabled', () => {
		it('should return false (not undefined) for an array state with remoteControlEnabled false', () => {
			// Arrange
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'MAIN' }, remoteControlEnable: { remoteControlEnabled: false } },
			];

			// Act & Assert
			expect(readWasherRemoteControlEnabled(state, 'MAIN')).toBe(false);
		});

		it('should return true for an array state with remoteControlEnabled true', () => {
			// Arrange
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'MAIN' }, remoteControlEnable: { remoteControlEnabled: true } },
			];

			// Act & Assert
			expect(readWasherRemoteControlEnabled(state, 'MAIN')).toBe(true);
		});

		it('should return undefined when the remoteControlEnabled key is missing', () => {
			// Arrange
			const state: ThinqConnectPayload = [{ location: { locationName: 'MAIN' } }];

			// Act & Assert
			expect(readWasherRemoteControlEnabled(state, 'MAIN')).toBeUndefined();
		});

		it('should pick the block whose locationName matches when there are two locations', () => {
			// Arrange
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'GUEST' }, remoteControlEnable: { remoteControlEnabled: true } },
				{ location: { locationName: 'MAIN' }, remoteControlEnable: { remoteControlEnabled: false } },
			];

			// Act & Assert
			expect(readWasherRemoteControlEnabled(state, 'MAIN')).toBe(false);
		});

		it('should return undefined for a non-boolean value', () => {
			// Arrange
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'MAIN' }, remoteControlEnable: { remoteControlEnabled: 'false' } },
			];

			// Act & Assert
			expect(readWasherRemoteControlEnabled(state, 'MAIN')).toBeUndefined();
		});

		it('should return undefined when the state itself is undefined', () => {
			// Act & Assert
			expect(readWasherRemoteControlEnabled(undefined, 'MAIN')).toBeUndefined();
		});

		it('should read a plain object state (not an array)', () => {
			// Arrange
			const state: ThinqConnectPayload = { remoteControlEnable: { remoteControlEnabled: true } };

			// Act & Assert
			expect(readWasherRemoteControlEnabled(state, undefined)).toBe(true);
		});
	});

	describe('buildWasherOperationPayload', () => {
		it('should build the START payload with the location name', () => {
			// Act & Assert
			expect(buildWasherOperationPayload('START', 'MAIN')).toEqual({
				location: { locationName: 'MAIN' },
				operation: { washerOperationMode: 'START' },
			});
		});

		it('should build the STOP payload with the location name', () => {
			// Act & Assert
			expect(buildWasherOperationPayload('STOP', 'MAIN')).toEqual({
				location: { locationName: 'MAIN' },
				operation: { washerOperationMode: 'STOP' },
			});
		});
	});

	describe('state sets', () => {
		it('should export WASHER_START_READY_STATES equal to only INITIAL', () => {
			// Act & Assert
			expect(WASHER_START_READY_STATES).toEqual(new Set(['INITIAL']));
		});

		it('should export PAUSED_STATES with PAUSE and RINSE_HOLD', () => {
			// Act & Assert
			expect(PAUSED_STATES).toEqual(new Set(['PAUSE', 'RINSE_HOLD']));
		});

		it('should export RUNNING_STATES containing RUNNING and not INITIAL', () => {
			// Act & Assert
			expect(RUNNING_STATES.has('RUNNING')).toBe(true);
			expect(RUNNING_STATES.has('INITIAL')).toBe(false);
		});

		it('should export STOPPED_STATES containing POWER_OFF and INITIAL', () => {
			// Act & Assert
			expect(STOPPED_STATES.has('POWER_OFF')).toBe(true);
			expect(STOPPED_STATES.has('INITIAL')).toBe(true);
		});
	});

	describe('evaluateWasherCycleCommand', () => {
		const MODE = { writable: true, allowedValues: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] };

		it('should allow START from INITIAL when remote is true', () => {
			// Act & Assert
			expect(evaluateWasherCycleCommand('START', MODE, 'INITIAL', true)).toEqual({ kind: 'allow' });
		});

		it('should allow START from INITIAL when remote is undefined', () => {
			// Act & Assert
			expect(evaluateWasherCycleCommand('START', MODE, 'INITIAL', undefined)).toEqual({ kind: 'allow' });
		});

		it.each(['RUNNING', 'RINSING', 'SPINNING'])('should noop START while %s', (state) => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, state, true);

			// Assert
			expect(decision).toEqual({ kind: 'noop', reason: 'Washer is already running.' });
		});

		it.each(['PAUSE', 'RINSE_HOLD'])('should refuse START while %s and mention resume', (state) => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, state, true);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('resume') as string });
		});

		it('should refuse START when ERROR', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, 'ERROR', true);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('error') as string });
		});

		it('should refuse START when POWER_OFF and mention powered off and that the plugin never powers on', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, 'POWER_OFF', true);

			// Assert
			expect(decision).toMatchObject({
				kind: 'refuse',
				reason: expect.stringMatching(/powered off[\s\S]*never powers it on/) as string,
			});
		});

		it.each(['END', 'RESERVED', 'REFRESHING', 'FROZEN_PREVENT_INITIAL', 'WEIRD'])(
			'should refuse START as not ready when the state is %s',
			(state) => {
				// Act
				const decision = evaluateWasherCycleCommand('START', MODE, state, true);

				// Assert
				expect(decision).toMatchObject({
					kind: 'refuse',
					reason: expect.stringContaining('not ready to start') as string,
				});
			},
		);

		it('should refuse START as unknown when the state is undefined', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, undefined, true);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('unknown') as string });
		});

		it('should refuse START when remote is false even though INITIAL', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, 'INITIAL', false);

			// Assert
			expect(decision).toMatchObject({
				kind: 'refuse',
				reason: expect.stringContaining('Remote start is off') as string,
			});
		});

		it.each(['RUNNING', 'SOAKING', 'PAUSE'])('should allow STOP while %s with remote true or undefined', (state) => {
			// Act & Assert
			expect(evaluateWasherCycleCommand('STOP', MODE, state, true)).toEqual({ kind: 'allow' });
			expect(evaluateWasherCycleCommand('STOP', MODE, state, undefined)).toEqual({ kind: 'allow' });
		});

		it('should refuse STOP while RUNNING when remote is false', () => {
			// Act
			const decision = evaluateWasherCycleCommand('STOP', MODE, 'RUNNING', false);

			// Assert
			expect(decision).toMatchObject({
				kind: 'refuse',
				reason: expect.stringContaining('Remote start is off') as string,
			});
		});

		it.each(['POWER_OFF', 'INITIAL', 'END', 'ERROR'])('should noop STOP when the state is %s', (state) => {
			// Act
			const decision = evaluateWasherCycleCommand('STOP', MODE, state, true);

			// Assert
			expect(decision).toEqual({
				kind: 'noop',
				reason: `Washer is not running (state ${state}); nothing to stop.`,
			});
		});

		it('should refuse STOP when the state is undefined', () => {
			// Act
			const decision = evaluateWasherCycleCommand('STOP', MODE, undefined, true);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('unknown') as string });
		});

		it('should refuse when the profile is missing', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', undefined, 'INITIAL', true);

			// Assert
			expect(decision).toMatchObject({
				kind: 'refuse',
				reason: expect.stringContaining('no washerOperationMode') as string,
			});
		});

		it('should refuse when the profile is not writable', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', { ...MODE, writable: false }, 'INITIAL', true);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('not writable') as string });
		});

		it('should refuse and list allowed values when the command is missing from the profile', () => {
			// Act
			const decision = evaluateWasherCycleCommand(
				'START',
				{ writable: true, allowedValues: ['STOP'] },
				'INITIAL',
				true,
			);

			// Assert
			expect(decision).toEqual({
				kind: 'refuse',
				reason: 'Profile does not list "START" as writable (allowed: STOP).',
			});
		});

		it('should say none when the allowed list is empty', () => {
			// Act
			const decision = evaluateWasherCycleCommand('STOP', { writable: true, allowedValues: [] }, 'RUNNING', true);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('allowed: none') as string });
		});

		it('should refuse with the POWER_OFF message when START is in POWER_OFF with remote false (state check first)', () => {
			// Act
			const decision = evaluateWasherCycleCommand('START', MODE, 'POWER_OFF', false);

			// Assert
			expect(decision).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('powered off') as string });
		});
	});

	describe('describeWasherCommandFailure', () => {
		it.each([
			['2301', 'Remote start is off'],
			['2302', 'cannot accept this command'],
			['2303', 'reports an error'],
			['2304', 'powered off'],
			['2305', 'does not allow this'],
			['2207', 'Nothing ran'],
			['2208', 'failed to carry out'],
			['2209', 'may or may not have run'],
			['2205', 'invalid status'],
			['1223', 'invalid status'],
			['1222', 'offline'],
			['1306', 'Too many requests'],
			['2210', 'asked to retry'],
			['2212', 'asked to retry'],
			['1103', 'Personal Access Token'],
			['1218', 'Personal Access Token'],
		])('should return the mapped sentence for code %s containing "%s"', (code, phrase) => {
			// Act
			const text = describeWasherCommandFailure(code, 'fallback');

			// Assert
			expect(text).toContain(phrase);
			expect(text).not.toBe('fallback');
		});

		it('should return the fallback for an unknown code', () => {
			// Act & Assert
			expect(describeWasherCommandFailure('9999', 'original message')).toBe('original message');
		});

		it('should return the fallback when the code is undefined', () => {
			// Act & Assert
			expect(describeWasherCommandFailure(undefined, 'original message')).toBe('original message');
		});
	});

	describe('buildWasherOperationPayload locationName requirement', () => {
		it('should include location.locationName in the payload', () => {
			// Act
			const payload = buildWasherOperationPayload('START', 'GUEST');

			// Assert
			expect(payload).toMatchObject({ location: { locationName: 'GUEST' } });
		});
	});
});
