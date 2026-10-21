import type { ThinqConnectPayload } from '../../services/thinqConnect/thinqConnectApiClient.js';

/*
 * Retyped from the read-only ThinQ Connect probes in workspace/thinq-v2-air-conditioner
 * (probe-RAC_056905_WW.txt = Study Room AC, probe-RAC_0B0001_WW.txt = Bedroom AC).
 * Shortened to the fields the ThinQ Connect AC code reads. Structure and values are kept as probed.
 */

const C_RANGE = { max: 30, min: 16, step: 0.5 };
const F_RANGE = { max: 86, min: 60, step: 1 };

const readOnlyEnum = (values: string[]): Record<string, unknown> => ({
	type: 'enum',
	mode: ['r'],
	value: { r: values },
});

const readWriteEnum = (values: string[], writeValues: string[] = values): Record<string, unknown> => ({
	type: 'enum',
	mode: ['r', 'w'],
	value: { r: values, w: writeValues },
});

const readWriteBoolean = (): Record<string, unknown> => ({
	type: 'boolean',
	mode: ['r', 'w'],
	value: { r: [true, false], w: [true, false] },
});

const readWriteRange = (range: { max: number; min: number; step: number }): Record<string, unknown> => ({
	type: 'range',
	mode: ['r', 'w'],
	value: { r: range, w: range },
});

/** Study Room AC: AUTO job mode, filterInfo, up/down swing only, no humidity. */
export const STUDY_PROFILE: ThinqConnectPayload = {
	property: {
		runState: { currentState: readOnlyEnum(['NORMAL', 'ERROR']) },
		airConJobMode: { currentJobMode: readWriteEnum(['AIR_DRY', 'AUTO', 'FAN', 'COOL']) },
		operation: { airConOperationMode: readWriteEnum(['POWER_OFF', 'POWER_ON']) },
		temperature: {
			currentTemperature: { type: 'number', mode: ['r'] },
			unit: readOnlyEnum(['C']),
			minTargetTemperature: { type: 'number', mode: ['r'] },
			maxTargetTemperature: { type: 'number', mode: ['r'] },
			targetTemperature: readWriteRange(C_RANGE),
		},
		filterInfo: {
			filterLifetime: { type: 'number', mode: ['r'] },
			usedTime: { type: 'number', mode: ['r'] },
		},
		airFlow: {
			windStrength: readWriteEnum(['LOW', 'MID', 'HIGH', 'AUTO']),
		},
		windDirection: {
			rotateUpDown: readWriteBoolean(),
		},
	},
	notification: { push: ['WATER_IS_FULL'] },
};

/** Bedroom AC: no AUTO (AIR_CLEAN is read-only), humidity, up/down + left/right swing, no filterInfo. */
export const BEDROOM_PROFILE: ThinqConnectPayload = {
	property: {
		runState: { currentState: readOnlyEnum(['NORMAL', 'ERROR']) },
		airConJobMode: {
			currentJobMode: readWriteEnum(['AIR_DRY', 'COOL', 'FAN', 'AIR_CLEAN'], ['AIR_DRY', 'COOL', 'FAN']),
		},
		operation: { airConOperationMode: readWriteEnum(['POWER_ON', 'POWER_OFF']) },
		airQualitySensor: { humidity: { type: 'number', mode: ['r'] } },
		temperature: {
			currentTemperature: { type: 'number', mode: ['r'] },
			unit: readOnlyEnum(['C']),
			minTargetTemperature: { type: 'number', mode: ['r'] },
			maxTargetTemperature: { type: 'number', mode: ['r'] },
			targetTemperature: readWriteRange(C_RANGE),
		},
		airFlow: {
			windStrength: readWriteEnum(['LOW', 'MID', 'HIGH', 'AUTO']),
		},
		windDirection: {
			rotateLeftRight: readWriteBoolean(),
			rotateUpDown: readWriteBoolean(),
		},
	},
	notification: { push: ['WATER_IS_FULL'] },
};

/** Study Room AC state as probed: powered on, COOL, 30 C current, 27 C target, HIGH wind, filter 682/38. */
export const STUDY_STATE: ThinqConnectPayload = {
	runState: { currentState: 'NORMAL' },
	airConJobMode: { currentJobMode: 'COOL' },
	temperature: {
		currentTemperature: 30,
		targetTemperature: 27,
		unit: 'C',
		minTargetTemperature: 16,
		maxTargetTemperature: 30,
	},
	filterInfo: { filterLifetime: 682, usedTime: 38 },
	airFlow: { windStrength: 'HIGH', windStrengthDetail: 'HIGH', windStep: 5 },
	windDirection: { rotateUpDown: false },
	operation: { airConOperationMode: 'POWER_ON' },
};

/** Study Room AC with the temperature block reported in Fahrenheit: 86 F current, 80 F target, range 60-86 F. */
export const STUDY_STATE_FAHRENHEIT: ThinqConnectPayload = {
	...STUDY_STATE,
	temperature: {
		currentTemperature: 86,
		targetTemperature: 80,
		unit: 'F',
		minTargetTemperature: 60,
		maxTargetTemperature: 86,
	},
};

/** Bedroom AC state as probed: powered OFF, COOL, 32 C current, 26 C target, humidity 70, both swing axes false. */
export const BEDROOM_STATE: ThinqConnectPayload = {
	runState: { currentState: 'NORMAL' },
	airConJobMode: { currentJobMode: 'COOL' },
	airQualitySensor: { humidity: 70 },
	temperature: {
		currentTemperature: 32,
		targetTemperature: 26,
		unit: 'C',
		minTargetTemperature: 16,
		maxTargetTemperature: 30,
	},
	airFlow: { windStrength: 'HIGH', windStrengthDetail: 'HIGH', windStep: 5 },
	windDirection: { rotateUpDown: false, rotateLeftRight: false },
	operation: { airConOperationMode: 'POWER_OFF' },
};

export { C_RANGE, F_RANGE };
