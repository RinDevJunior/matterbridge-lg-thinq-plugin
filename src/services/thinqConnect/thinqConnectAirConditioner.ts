import type { ThinqConnectPayload, ThinqConnectResource } from './thinqConnectApiClient.js';

export type AirConditionerTemperatureUnit = 'C' | 'F';

export interface AirConditionerEnumProfile {
	writable: boolean;
	readValues: string[];
	writeValues: string[];
}

export interface AirConditionerRangeProfile {
	writable: boolean;
	min: number;
	max: number;
	step: number;
}

export interface AirConditionerProfile {
	power?: AirConditionerEnumProfile;
	jobMode?: AirConditionerEnumProfile;
	windStrength?: AirConditionerEnumProfile;
	targetTemperature?: AirConditionerRangeProfile;
	rotateUpDown: boolean;
	rotateLeftRight: boolean;
	hasHumidity: boolean;
	hasFilterInfo: boolean;
}

export interface AirConditionerRawState {
	powerOn?: boolean;
	jobMode?: string;
	temperatureUnit?: AirConditionerTemperatureUnit;
	currentTemperature?: number;
	targetTemperature?: number;
	windStrength?: string;
	rotateUpDown?: boolean;
	rotateLeftRight?: boolean;
	humidityPercent?: number;
	filterLifetime?: number;
	filterUsedTime?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringItems(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function firstObject(payload: unknown): Record<string, unknown> | undefined {
	if (Array.isArray(payload)) {
		return payload.find(isPlainObject);
	}
	return isPlainObject(payload) ? payload : undefined;
}

function profileProperty(
	profile: ThinqConnectPayload | undefined,
	group: string,
	prop: string,
): Record<string, unknown> | undefined {
	const root = firstObject(profile);
	const properties = firstObject(root?.property);
	const groupNode = firstObject(properties?.[group]);
	const node = groupNode?.[prop];
	return isPlainObject(node) ? node : undefined;
}

function readEnumProfile(node: Record<string, unknown> | undefined): AirConditionerEnumProfile | undefined {
	if (!node) {
		return undefined;
	}
	const value = isPlainObject(node.value) ? node.value : undefined;
	return {
		writable: stringItems(node.mode).includes('w'),
		readValues: stringItems(value?.r),
		writeValues: stringItems(value?.w),
	};
}

function readRangeProfile(node: Record<string, unknown> | undefined): AirConditionerRangeProfile | undefined {
	if (!node) {
		return undefined;
	}
	const value = isPlainObject(node.value) ? node.value : undefined;
	const range = isPlainObject(value?.w) ? value.w : isPlainObject(value?.r) ? value.r : undefined;
	const min = asNumber(range?.min);
	const max = asNumber(range?.max);
	if (min === undefined || max === undefined) {
		return undefined;
	}
	return {
		writable: stringItems(node.mode).includes('w'),
		min,
		max,
		step: asNumber(range?.step) ?? 0,
	};
}

export function readAirConditionerProfile(profile: ThinqConnectPayload | undefined): AirConditionerProfile {
	return {
		power: readEnumProfile(profileProperty(profile, 'operation', 'airConOperationMode')),
		jobMode: readEnumProfile(profileProperty(profile, 'airConJobMode', 'currentJobMode')),
		windStrength: readEnumProfile(profileProperty(profile, 'airFlow', 'windStrength')),
		targetTemperature: readRangeProfile(profileProperty(profile, 'temperature', 'targetTemperature')),
		rotateUpDown: stringItems(profileProperty(profile, 'windDirection', 'rotateUpDown')?.mode).includes('w'),
		rotateLeftRight: stringItems(profileProperty(profile, 'windDirection', 'rotateLeftRight')?.mode).includes('w'),
		hasHumidity: profileProperty(profile, 'airQualitySensor', 'humidity') !== undefined,
		hasFilterInfo:
			profileProperty(profile, 'filterInfo', 'filterLifetime') !== undefined &&
			profileProperty(profile, 'filterInfo', 'usedTime') !== undefined,
	};
}

export function readAirConditionerState(state: ThinqConnectPayload | undefined): AirConditionerRawState {
	const root = firstObject(state);
	if (!root) {
		return {};
	}
	const operation = firstObject(root.operation);
	const jobMode = firstObject(root.airConJobMode);
	const temperature = firstObject(root.temperature);
	const airFlow = firstObject(root.airFlow);
	const windDirection = firstObject(root.windDirection);
	const airQualitySensor = firstObject(root.airQualitySensor);
	const filterInfo = firstObject(root.filterInfo);
	const operationMode = asString(operation?.airConOperationMode);
	const unit = asString(temperature?.unit);

	return {
		powerOn: operationMode === undefined ? undefined : operationMode === 'POWER_ON',
		jobMode: asString(jobMode?.currentJobMode),
		temperatureUnit: unit === 'C' || unit === 'F' ? unit : undefined,
		currentTemperature: asNumber(temperature?.currentTemperature),
		targetTemperature: asNumber(temperature?.targetTemperature),
		windStrength: asString(airFlow?.windStrength),
		rotateUpDown: asBoolean(windDirection?.rotateUpDown),
		rotateLeftRight: asBoolean(windDirection?.rotateLeftRight),
		humidityPercent: asNumber(airQualitySensor?.humidity),
		filterLifetime: asNumber(filterInfo?.filterLifetime),
		filterUsedTime: asNumber(filterInfo?.usedTime),
	};
}

export function fahrenheitToCelsius(value: number): number {
	return ((value - 32) * 5) / 9;
}

export function celsiusToFahrenheit(value: number): number {
	return (value * 9) / 5 + 32;
}

export function filterRemainingPercent(state: AirConditionerRawState): number | undefined {
	const { filterLifetime, filterUsedTime } = state;
	if (filterLifetime === undefined || filterUsedTime === undefined || filterLifetime <= 0) {
		return undefined;
	}
	const percent = Math.round((100 * (filterLifetime - filterUsedTime)) / filterLifetime);
	return Math.min(100, Math.max(0, percent));
}

export function snapToRange(value: number, range: AirConditionerRangeProfile): number {
	const clamp = (candidate: number): number => Math.min(range.max, Math.max(range.min, candidate));
	const snapped = range.step > 0 ? range.min + Math.round((value - range.min) / range.step) * range.step : value;
	return Math.round(clamp(snapped) * 100) / 100;
}

export function evaluateAirConditionerEnumWrite(
	label: string,
	profile: AirConditionerEnumProfile | undefined,
	value: string,
): string | undefined {
	if (!profile) {
		return `Profile has no ${label}.`;
	}
	if (!profile.writable) {
		return `${label} is not writable for this device.`;
	}
	if (!profile.writeValues.includes(value)) {
		const allowed = profile.writeValues.length > 0 ? profile.writeValues.join(', ') : 'none';
		return `Profile does not list "${value}" as writable for ${label} (allowed: ${allowed}).`;
	}
	return undefined;
}

export function evaluateAirConditionerRangeWrite(
	label: string,
	profile: AirConditionerRangeProfile | undefined,
): string | undefined {
	if (!profile) {
		return `Profile has no ${label}.`;
	}
	if (!profile.writable) {
		return `${label} is not writable for this device.`;
	}
	return undefined;
}

export function buildAirConditionerPowerPayload(on: boolean): ThinqConnectResource {
	return { operation: { airConOperationMode: on ? 'POWER_ON' : 'POWER_OFF' } };
}

export function buildAirConditionerJobModePayload(mode: string): ThinqConnectResource {
	return { airConJobMode: { currentJobMode: mode } };
}

export function buildAirConditionerTargetTemperaturePayload(
	value: number,
	unit: AirConditionerTemperatureUnit,
): ThinqConnectResource {
	return { temperature: { targetTemperature: value, unit } };
}

export function buildAirConditionerWindStrengthPayload(strength: string): ThinqConnectResource {
	return { airFlow: { windStrength: strength } };
}

export function buildAirConditionerSwingPayload(axes: {
	rotateUpDown?: boolean;
	rotateLeftRight?: boolean;
}): ThinqConnectResource {
	const windDirection: Record<string, boolean> = {};
	if (axes.rotateUpDown !== undefined) {
		windDirection.rotateUpDown = axes.rotateUpDown;
	}
	if (axes.rotateLeftRight !== undefined) {
		windDirection.rotateLeftRight = axes.rotateLeftRight;
	}
	return { windDirection };
}
