import { describe, expect, it } from 'vitest';

import type { ThinqConnectPayload } from './thinqConnectApiClient.js';
import {
	buildWasherPowerPayload,
	evaluateWasherPowerGuards,
	findProfileLocationName,
	isWasherPoweredOn,
	readWasherCurrentState,
	readWasherOperationModeProfile,
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
});
