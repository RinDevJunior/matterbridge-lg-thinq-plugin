import { describe, expect, it } from 'vitest';

import {
	BEDROOM_PROFILE,
	BEDROOM_STATE,
	STUDY_PROFILE,
	STUDY_STATE,
	STUDY_STATE_FAHRENHEIT,
} from '../../tests/helpers/thinqV2AirConditionerFixtures.js';
import {
	type AirConditionerEnumProfile,
	type AirConditionerRangeProfile,
	buildAirConditionerJobModePayload,
	buildAirConditionerPowerPayload,
	buildAirConditionerSwingPayload,
	buildAirConditionerTargetTemperaturePayload,
	buildAirConditionerWindStrengthPayload,
	celsiusToFahrenheit,
	evaluateAirConditionerEnumWrite,
	evaluateAirConditionerRangeWrite,
	fahrenheitToCelsius,
	filterRemainingPercent,
	readAirConditionerProfile,
	readAirConditionerState,
	snapToRange,
} from './thinqConnectAirConditioner.js';
import type { ThinqConnectPayload } from './thinqConnectApiClient.js';

const RANGE_C: AirConditionerRangeProfile = { writable: true, min: 16, max: 30, step: 0.5 };

/** Test-only bridge for the one case that needs a non-object payload at runtime. */
function asPayload(value: unknown): ThinqConnectPayload {
	return value as ThinqConnectPayload;
}

describe('thinqConnectAirConditioner', () => {
	describe('readAirConditionerProfile', () => {
		it('should read the Study Room profile with AUTO, up/down swing, filter info and no humidity', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(STUDY_PROFILE);

			// Assert
			expect(profile.jobMode?.writeValues).toEqual(['AIR_DRY', 'AUTO', 'FAN', 'COOL']);
			expect(profile.power?.writable).toBe(true);
			expect(profile.windStrength?.writeValues).toEqual(['LOW', 'MID', 'HIGH', 'AUTO']);
			expect(profile.targetTemperature).toEqual({ writable: true, min: 16, max: 30, step: 0.5 });
			expect(profile.rotateUpDown).toBe(true);
			expect(profile.rotateLeftRight).toBe(false);
			expect(profile.hasHumidity).toBe(false);
			expect(profile.hasFilterInfo).toBe(true);
		});

		it('should read the Bedroom profile without AUTO in the write list and with left/right swing and humidity', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(BEDROOM_PROFILE);

			// Assert
			expect(profile.jobMode?.writeValues).not.toContain('AUTO');
			expect(profile.jobMode?.readValues).toContain('AIR_CLEAN');
			expect(profile.jobMode?.writeValues).not.toContain('AIR_CLEAN');
			expect(profile.rotateLeftRight).toBe(true);
			expect(profile.rotateUpDown).toBe(true);
			expect(profile.hasHumidity).toBe(true);
			expect(profile.hasFilterInfo).toBe(false);
		});

		it.each([
			['undefined', undefined],
			['an empty object', {}],
			['an array', []],
		])('should return all optional fields undefined and booleans false when the input is %s', (_label, input) => {
			// Arrange & Act
			const profile = readAirConditionerProfile(input);

			// Assert
			expect(profile.power).toBeUndefined();
			expect(profile.jobMode).toBeUndefined();
			expect(profile.windStrength).toBeUndefined();
			expect(profile.targetTemperature).toBeUndefined();
			expect(profile.rotateUpDown).toBe(false);
			expect(profile.rotateLeftRight).toBe(false);
			expect(profile.hasHumidity).toBe(false);
			expect(profile.hasFilterInfo).toBe(false);
		});

		it('should mark the target temperature not writable and read its range from value.r when mode is r only', () => {
			// Arrange
			const profile = asPayload({
				property: {
					temperature: {
						targetTemperature: { type: 'range', mode: ['r'], value: { r: { min: 18, max: 28, step: 1 } } },
					},
				},
			});

			// Act
			const result = readAirConditionerProfile(profile);

			// Assert
			expect(result.targetTemperature).toEqual({ writable: false, min: 18, max: 28, step: 1 });
		});
	});

	describe('readAirConditionerState', () => {
		it('should read the Study Room state as powered on, COOL, 30 C current, 27 C target and filter 682/38', () => {
			// Arrange & Act
			const state = readAirConditionerState(STUDY_STATE);

			// Assert
			expect(state).toMatchObject({
				powerOn: true,
				jobMode: 'COOL',
				temperatureUnit: 'C',
				currentTemperature: 30,
				targetTemperature: 27,
				windStrength: 'HIGH',
				rotateUpDown: false,
				filterLifetime: 682,
				filterUsedTime: 38,
			});
		});

		it('should read the Bedroom state as powered off with humidity 70 and both swing axes false', () => {
			// Arrange & Act
			const state = readAirConditionerState(BEDROOM_STATE);

			// Assert
			expect(state).toMatchObject({
				powerOn: false,
				humidityPercent: 70,
				rotateUpDown: false,
				rotateLeftRight: false,
			});
		});

		it('should use the first plain-object element when the payload is an array', () => {
			// Arrange & Act
			const state = readAirConditionerState([STUDY_STATE]);

			// Assert
			expect(state).toMatchObject({ powerOn: true, currentTemperature: 30 });
		});

		it.each([
			['undefined', undefined],
			['a string', asPayload('POWER_ON')],
			['an empty array', []],
		])('should return an empty state when the payload is %s', (_label, payload) => {
			// Arrange & Act
			const state = readAirConditionerState(payload);

			// Assert
			expect(state).toEqual({});
		});

		it('should leave temperatureUnit undefined when the unit is not C or F', () => {
			// Arrange
			const payload = asPayload({ temperature: { unit: 'K', currentTemperature: 300 } });

			// Act
			const state = readAirConditionerState(payload);

			// Assert
			expect(state.temperatureUnit).toBeUndefined();
			expect(state.currentTemperature).toBe(300);
		});

		it('should report the Fahrenheit unit when the temperature block is in F', () => {
			// Arrange & Act
			const state = readAirConditionerState(STUDY_STATE_FAHRENHEIT);

			// Assert
			expect(state).toMatchObject({ temperatureUnit: 'F', currentTemperature: 86, targetTemperature: 80 });
		});
	});

	describe('temperature conversion', () => {
		it('should convert 86 F to 30 C', () => {
			// Arrange & Act
			const celsius = fahrenheitToCelsius(86);

			// Assert
			expect(celsius).toBe(30);
		});

		it('should convert 30 C to 86 F', () => {
			// Arrange & Act
			const fahrenheit = celsiusToFahrenheit(30);

			// Assert
			expect(fahrenheit).toBe(86);
		});

		it('should round-trip 80 F through Celsius and back', () => {
			// Arrange & Act
			const roundTrip = celsiusToFahrenheit(fahrenheitToCelsius(80));

			// Assert
			expect(roundTrip).toBeCloseTo(80, 10);
		});
	});

	describe('filterRemainingPercent', () => {
		it('should return 94 when 38 of 682 is used', () => {
			// Arrange
			const state = { filterLifetime: 682, filterUsedTime: 38 };

			// Act
			const percent = filterRemainingPercent(state);

			// Assert
			expect(percent).toBe(94);
		});

		it('should clamp to 0 when used time exceeds lifetime', () => {
			// Arrange
			const state = { filterLifetime: 100, filterUsedTime: 150 };

			// Act
			const percent = filterRemainingPercent(state);

			// Assert
			expect(percent).toBe(0);
		});

		it('should return undefined when lifetime is zero', () => {
			// Arrange
			const state = { filterLifetime: 0, filterUsedTime: 0 };

			// Act
			const percent = filterRemainingPercent(state);

			// Assert
			expect(percent).toBeUndefined();
		});

		it('should return undefined when the used time is missing', () => {
			// Arrange
			const state = { filterLifetime: 682 };

			// Act
			const percent = filterRemainingPercent(state);

			// Assert
			expect(percent).toBeUndefined();
		});
	});

	describe('snapToRange', () => {
		it('should snap 24.3 to 24.5 on the 16-30 step 0.5 range', () => {
			// Arrange & Act
			const snapped = snapToRange(24.3, RANGE_C);

			// Assert
			expect(snapped).toBe(24.5);
		});

		it('should clamp 10 up to the minimum of 16', () => {
			// Arrange & Act
			const snapped = snapToRange(10, RANGE_C);

			// Assert
			expect(snapped).toBe(16);
		});

		it('should clamp 99 down to the maximum of 30', () => {
			// Arrange & Act
			const snapped = snapToRange(99, RANGE_C);

			// Assert
			expect(snapped).toBe(30);
		});

		it('should snap 75.4 to 75 on a 60-86 step 1 range', () => {
			// Arrange
			const range: AirConditionerRangeProfile = { writable: true, min: 60, max: 86, step: 1 };

			// Act
			const snapped = snapToRange(75.4, range);

			// Assert
			expect(snapped).toBe(75);
		});

		it('should only clamp when the step is zero', () => {
			// Arrange
			const range: AirConditionerRangeProfile = { writable: true, min: 16, max: 30, step: 0 };

			// Act
			const snapped = snapToRange(24.3, range);

			// Assert
			expect(snapped).toBe(24.3);
		});
	});

	describe('evaluateAirConditionerEnumWrite', () => {
		it('should report that the profile has no label when the profile is undefined', () => {
			// Arrange & Act
			const reason = evaluateAirConditionerEnumWrite('airConJobMode.currentJobMode', undefined, 'COOL');

			// Assert
			expect(reason).toBe('Profile has no airConJobMode.currentJobMode.');
		});

		it('should report not writable when the enum profile has no w mode', () => {
			// Arrange
			const profile: AirConditionerEnumProfile = { writable: false, readValues: ['COOL'], writeValues: [] };

			// Act
			const reason = evaluateAirConditionerEnumWrite('operation.airConOperationMode', profile, 'POWER_ON');

			// Assert
			expect(reason).toBe('operation.airConOperationMode is not writable for this device.');
		});

		it('should list the allowed values when the value is not in the write list', () => {
			// Arrange
			const profile = readAirConditionerProfile(BEDROOM_PROFILE).jobMode;

			// Act
			const reason = evaluateAirConditionerEnumWrite('airConJobMode.currentJobMode', profile, 'AUTO');

			// Assert
			expect(reason).toContain('"AUTO"');
			expect(reason).toContain('allowed: AIR_DRY, COOL, FAN');
		});

		it('should return undefined when the value is in the write list', () => {
			// Arrange
			const profile = readAirConditionerProfile(STUDY_PROFILE).jobMode;

			// Act
			const reason = evaluateAirConditionerEnumWrite('airConJobMode.currentJobMode', profile, 'AUTO');

			// Assert
			expect(reason).toBeUndefined();
		});
	});

	describe('evaluateAirConditionerRangeWrite', () => {
		it('should report that the profile has no label when the range is undefined', () => {
			// Arrange & Act
			const reason = evaluateAirConditionerRangeWrite('temperature.targetTemperature', undefined);

			// Assert
			expect(reason).toBe('Profile has no temperature.targetTemperature.');
		});

		it('should report not writable when the range is read-only', () => {
			// Arrange
			const range: AirConditionerRangeProfile = { writable: false, min: 16, max: 30, step: 0.5 };

			// Act
			const reason = evaluateAirConditionerRangeWrite('temperature.targetTemperature', range);

			// Assert
			expect(reason).toBe('temperature.targetTemperature is not writable for this device.');
		});

		it('should return undefined when the range is writable', () => {
			// Arrange & Act
			const reason = evaluateAirConditionerRangeWrite('temperature.targetTemperature', RANGE_C);

			// Assert
			expect(reason).toBeUndefined();
		});
	});

	describe('payload builders', () => {
		it('should build the POWER_ON and POWER_OFF operation payloads', () => {
			// Arrange & Act & Assert
			expect(buildAirConditionerPowerPayload(true)).toEqual({ operation: { airConOperationMode: 'POWER_ON' } });
			expect(buildAirConditionerPowerPayload(false)).toEqual({ operation: { airConOperationMode: 'POWER_OFF' } });
		});

		it('should build the job mode payload', () => {
			// Arrange & Act
			const payload = buildAirConditionerJobModePayload('COOL');

			// Assert
			expect(payload).toEqual({ airConJobMode: { currentJobMode: 'COOL' } });
		});

		it('should build the target temperature payload with value and unit', () => {
			// Arrange & Act
			const payload = buildAirConditionerTargetTemperaturePayload(24.5, 'C');

			// Assert
			expect(payload).toEqual({ temperature: { targetTemperature: 24.5, unit: 'C' } });
		});

		it('should build the wind strength payload', () => {
			// Arrange & Act
			const payload = buildAirConditionerWindStrengthPayload('MID');

			// Assert
			expect(payload).toEqual({ airFlow: { windStrength: 'MID' } });
		});

		it('should omit the undefined axis from a one-axis swing payload', () => {
			// Arrange & Act
			const payload = buildAirConditionerSwingPayload({ rotateUpDown: true });

			// Assert
			expect(payload).toEqual({ windDirection: { rotateUpDown: true } });
			expect(payload.windDirection).not.toHaveProperty('rotateLeftRight');
		});

		it('should include both axes in a two-axis swing payload', () => {
			// Arrange & Act
			const payload = buildAirConditionerSwingPayload({ rotateUpDown: false, rotateLeftRight: true });

			// Assert
			expect(payload).toEqual({ windDirection: { rotateUpDown: false, rotateLeftRight: true } });
		});
	});
});
