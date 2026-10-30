import { describe, expect, it } from 'vitest';

import {
	BEDROOM_PROFILE,
	BEDROOM_STATE,
	ERROR_STATE,
	FAHRENHEIT_PROFILE,
	FAHRENHEIT_PROFILE_NO_CELSIUS_ENTRY,
	STUDY_PROFILE,
	STUDY_PROFILE_FULL,
	STUDY_STATE,
	STUDY_STATE_FAHRENHEIT,
} from '../../tests/helpers/thinqConnectAirConditionerFixtures.js';
import {
	type AirConditionerEnumProfile,
	type AirConditionerRangeProfile,
	buildAirConditionerJobModePayload,
	buildAirConditionerPowerPayload,
	buildAirConditionerSwingPayload,
	buildAirConditionerTargetTemperaturePayload,
	buildAirConditionerWindStepPayload,
	buildAirConditionerWindStrengthPayload,
	celsiusToFahrenheit,
	evaluateAirConditionerEnumWrite,
	evaluateAirConditionerRangeWrite,
	evaluateAirConditionerWindStepWrite,
	fahrenheitToCelsius,
	filterRemainingPercent,
	isAirConditionerFaultState,
	percentToWindStep,
	readAirConditionerProfile,
	readAirConditionerState,
	readWindStepScale,
	resolveCelsiusTargetRange,
	resolveTargetTemperatureUnit,
	snapToRange,
	windStepToPercent,
} from './thinqConnectAirConditioner.js';
import type { ThinqConnectPayload } from './thinqConnectApiClient.js';

const RANGE_C: AirConditionerRangeProfile = { writable: true, min: 16, max: 30, step: 0.5 };

/** Test-only bridge for the one case that needs a non-object payload at runtime. */
function asPayload(value: unknown): ThinqConnectPayload {
	return value as ThinqConnectPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep copy of the Study profile with only `property.temperature.currentTemperature` removed. */
function studyProfileWithoutCurrentTemperature(): ThinqConnectPayload {
	const clone = structuredClone(STUDY_PROFILE);
	if (isRecord(clone) && isRecord(clone.property) && isRecord(clone.property.temperature)) {
		delete clone.property.temperature.currentTemperature;
	}
	return clone;
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

		it('should set hasCurrentTemperature true for the Study Room profile', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(STUDY_PROFILE);

			// Assert
			expect(profile.hasCurrentTemperature).toBe(true);
		});

		it('should set hasCurrentTemperature true for the Bedroom profile', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(BEDROOM_PROFILE);

			// Assert
			expect(profile.hasCurrentTemperature).toBe(true);
		});

		it('should set hasCurrentTemperature false when the profile has no temperature.currentTemperature', () => {
			// Arrange
			const profile = studyProfileWithoutCurrentTemperature();

			// Act
			const result = readAirConditionerProfile(profile);

			// Assert
			expect(result.hasCurrentTemperature).toBe(false);
		});

		it.each([
			['undefined', undefined],
			['an empty object', {}],
			['an empty array', []],
		])('should set hasCurrentTemperature false when the input is %s', (_label, input) => {
			// Arrange & Act
			const profile = readAirConditionerProfile(input);

			// Assert
			expect(profile.hasCurrentTemperature).toBe(false);
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

/** Replaces the top-level temperature.unit read list; undefined removes the unit node. */
function withTemperatureUnit(readValues: string[] | undefined): ThinqConnectPayload {
	const clone = structuredClone(STUDY_PROFILE_FULL);
	if (isRecord(clone) && isRecord(clone.property) && isRecord(clone.property.temperature)) {
		clone.property.temperature.unit =
			readValues === undefined ? {} : { type: 'enum', mode: ['r'], value: { r: readValues } };
	}
	return clone;
}

describe('thinqConnectAirConditioner Fahrenheit, ERROR and windStep helpers', () => {
	describe('temperature unit and Celsius range', () => {
		it.each([
			{ label: 'only C', units: ['C'], expected: 'C' },
			{ label: 'only F', units: ['F'], expected: 'F' },
			{ label: 'both C and F', units: ['C', 'F'], expected: 'C' },
			{ label: 'an empty list', units: [], expected: 'C' },
			{ label: 'a missing unit node', units: undefined, expected: 'C' },
		])('should resolve the temperature unit to $expected when the unit list has $label', ({ units, expected }) => {
			// Arrange & Act
			const profile = readAirConditionerProfile(withTemperatureUnit(units));

			// Assert
			expect(profile.temperatureUnit).toBe(expected);
		});

		it('should read the C target range from temperatureInUnits for the real study profile', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(STUDY_PROFILE_FULL);

			// Assert
			expect(profile.temperatureUnit).toBe('C');
			expect(profile.celsiusTargetRange).toEqual({ writable: true, min: 16, max: 30, step: 0.5 });
		});

		it('should keep the existing profile fields identical to the existing study fixture', () => {
			// Arrange
			const full = readAirConditionerProfile(STUDY_PROFILE_FULL);
			const base = readAirConditionerProfile(STUDY_PROFILE);

			// Act & Assert
			expect(full.targetTemperature).toEqual(base.targetTemperature);
			expect(full.power?.writable).toBe(base.power?.writable);
			expect(full.windStrength).toEqual(base.windStrength);
			expect(full.rotateUpDown).toBe(base.rotateUpDown);
			expect(full.hasFilterInfo).toBe(base.hasFilterInfo);
		});

		it('should leave the unit C and no Celsius range for the existing study and bedroom profiles', () => {
			// Arrange & Act
			const study = readAirConditionerProfile(STUDY_PROFILE);
			const bedroom = readAirConditionerProfile(BEDROOM_PROFILE);

			// Assert
			expect(study.temperatureUnit).toBe('C');
			expect(study.celsiusTargetRange).toBeUndefined();
			expect(bedroom.temperatureUnit).toBe('C');
			expect(bedroom.celsiusTargetRange).toBeUndefined();
		});

		it('should read unit F and the 60-86 F target range for the Fahrenheit profile', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(FAHRENHEIT_PROFILE);

			// Assert
			expect(profile.temperatureUnit).toBe('F');
			expect(profile.targetTemperature).toEqual({ writable: true, min: 60, max: 86, step: 1 });
			expect(profile.celsiusTargetRange).toEqual({ writable: true, min: 16, max: 30, step: 0.5 });
		});

		it('should default resolveTargetTemperatureUnit to C when the profile unit is undefined', () => {
			// Arrange
			const profile = { ...readAirConditionerProfile(undefined), temperatureUnit: undefined };

			// Act & Assert
			expect(resolveTargetTemperatureUnit(profile)).toBe('C');
		});

		it('should return the same target range object from resolveCelsiusTargetRange for a Celsius profile', () => {
			// Arrange
			const profile = readAirConditionerProfile(STUDY_PROFILE_FULL);

			// Act & Assert
			expect(resolveCelsiusTargetRange(profile)).toBe(profile.targetTemperature);
		});

		it('should return the Celsius entry range from resolveCelsiusTargetRange for a Fahrenheit profile with a Celsius entry', () => {
			// Arrange
			const profile = readAirConditionerProfile(FAHRENHEIT_PROFILE);

			// Act & Assert
			expect(resolveCelsiusTargetRange(profile)).toEqual({ writable: true, min: 16, max: 30, step: 0.5 });
		});

		it('should convert the Fahrenheit range in resolveCelsiusTargetRange when no Celsius entry exists', () => {
			// Arrange
			const profile = readAirConditionerProfile(FAHRENHEIT_PROFILE_NO_CELSIUS_ENTRY);

			// Act
			const range = resolveCelsiusTargetRange(profile);

			// Assert
			expect(range?.min).toBeCloseTo(15.56, 2);
			expect(range?.max).toBeCloseTo(30, 10);
			expect(range?.step).toBeCloseTo(5 / 9, 6);
		});

		it('should return undefined from resolveCelsiusTargetRange when a Fahrenheit profile has no target range', () => {
			// Arrange
			const profile = {
				...readAirConditionerProfile(FAHRENHEIT_PROFILE_NO_CELSIUS_ENTRY),
				targetTemperature: undefined,
			};

			// Act & Assert
			expect(resolveCelsiusTargetRange(profile)).toBeUndefined();
		});
	});

	describe('isAirConditionerFaultState and runState', () => {
		it.each(['ERROR', 'error', 'FAULT', 'SENSOR_FAIL'])('should flag runState %s as a fault', (value) => {
			// Act & Assert
			expect(isAirConditionerFaultState(value)).toBe(true);
		});

		it.each(['NORMAL', 'INITIAL'])('should not flag runState %s as a fault', (value) => {
			// Act & Assert
			expect(isAirConditionerFaultState(value)).toBe(false);
		});

		it('should not flag an undefined runState as a fault', () => {
			// Act & Assert
			expect(isAirConditionerFaultState(undefined)).toBe(false);
		});

		it('should read runState ERROR from the fault fixture', () => {
			// Arrange & Act
			const state = readAirConditionerState(ERROR_STATE);

			// Assert
			expect(state.runState).toBe('ERROR');
		});

		it('should leave runState undefined when the state has no runState node', () => {
			// Arrange & Act
			const state = readAirConditionerState({ operation: { airConOperationMode: 'POWER_ON' } });

			// Assert
			expect(state.runState).toBeUndefined();
		});
	});

	describe('windStep profile, scale and mapping', () => {
		const SCALE = { min: 1, max: 5, step: 1, count: 5 };

		it('should read the writable 1-5 windStep range from the real study profile', () => {
			// Arrange & Act
			const profile = readAirConditionerProfile(STUDY_PROFILE_FULL);

			// Assert
			expect(profile.windStep).toEqual({ writable: true, min: 1, max: 5, step: 1 });
			expect(readAirConditionerProfile(STUDY_PROFILE).windStep).toBeUndefined();
		});

		it('should build the 5-step scale from the real study profile', () => {
			// Arrange & Act
			const scale = readWindStepScale(readAirConditionerProfile(STUDY_PROFILE_FULL));

			// Assert
			expect(scale).toEqual(SCALE);
		});

		it('should return undefined from readWindStepScale when windStep is not writable', () => {
			// Arrange
			const profile = {
				...readAirConditionerProfile(STUDY_PROFILE_FULL),
				windStep: { writable: false, min: 1, max: 5, step: 1 },
			};

			// Act & Assert
			expect(readWindStepScale(profile)).toBeUndefined();
		});

		it('should return undefined from readWindStepScale when the profile has no windStep', () => {
			// Arrange & Act & Assert
			expect(readWindStepScale(readAirConditionerProfile(STUDY_PROFILE))).toBeUndefined();
		});

		it.each([
			{ label: 'one step', max: 1 },
			{ label: 'eleven steps', max: 11 },
		])('should return undefined from readWindStepScale for $label', ({ max }) => {
			// Arrange
			const profile = {
				...readAirConditionerProfile(STUDY_PROFILE_FULL),
				windStep: { writable: true, min: 1, max, step: 1 },
			};

			// Act & Assert
			expect(readWindStepScale(profile)).toBeUndefined();
		});

		it('should return undefined from readWindStepScale when the step is not an integer', () => {
			// Arrange
			const profile = {
				...readAirConditionerProfile(STUDY_PROFILE_FULL),
				windStep: { writable: true, min: 1, max: 5, step: 0.5 },
			};

			// Act & Assert
			expect(readWindStepScale(profile)).toBeUndefined();
		});

		it.each([
			[1, 20],
			[2, 40],
			[3, 60],
			[4, 80],
			[5, 100],
			[0, 20],
			[9, 100],
		])('should map wind step %i to %i percent with clamping', (step, percent) => {
			// Act & Assert
			expect(windStepToPercent(SCALE, step)).toBe(percent);
		});

		it.each<[number, number | undefined]>([
			[0, undefined],
			[1, 1],
			[20, 1],
			[21, 2],
			[40, 2],
			[41, 3],
			[50, 3],
			[60, 3],
			[61, 4],
			[80, 4],
			[81, 5],
			[100, 5],
		])('should map %i percent to wind step %s', (percent, step) => {
			// Act & Assert
			expect(percentToWindStep(SCALE, percent)).toBe(step);
		});

		it('should accept an aligned in-range step in evaluateAirConditionerWindStepWrite', () => {
			// Arrange
			const profile = readAirConditionerProfile(STUDY_PROFILE_FULL);

			// Act & Assert
			expect(evaluateAirConditionerWindStepWrite(profile, 3)).toBeUndefined();
		});

		it.each([0, 6, 2.5])('should refuse wind step %s outside the profile range', (step) => {
			// Arrange
			const profile = readAirConditionerProfile(STUDY_PROFILE_FULL);

			// Act
			const reason = evaluateAirConditionerWindStepWrite(profile, step);

			// Assert
			expect(reason).toContain('outside the profile range 1-5');
		});

		it('should refuse a step not aligned to the profile step', () => {
			// Arrange
			const profile = {
				...readAirConditionerProfile(STUDY_PROFILE_FULL),
				windStep: { writable: true, min: 1, max: 5, step: 2 },
			};

			// Act & Assert
			expect(evaluateAirConditionerWindStepWrite(profile, 2)).toContain('not aligned to the profile step 2');
		});

		it('should refuse a windStep write when the profile has no windStep', () => {
			// Arrange & Act
			const reason = evaluateAirConditionerWindStepWrite(readAirConditionerProfile(STUDY_PROFILE), 3);

			// Assert
			expect(reason).toContain('no airFlow.windStep');
		});

		it('should refuse a windStep write when windStep is not writable', () => {
			// Arrange
			const profile = {
				...readAirConditionerProfile(STUDY_PROFILE_FULL),
				windStep: { writable: false, min: 1, max: 5, step: 1 },
			};

			// Act & Assert
			expect(evaluateAirConditionerWindStepWrite(profile, 3)).toContain('not writable');
		});

		it('should build the airFlow.windStep payload for step 3', () => {
			// Arrange & Act
			const payload = buildAirConditionerWindStepPayload(3);

			// Assert
			expect(payload).toEqual({ airFlow: { windStep: 3 } });
		});
	});
});
