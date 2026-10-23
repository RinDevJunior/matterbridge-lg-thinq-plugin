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
	temperatureUnit?: AirConditionerTemperatureUnit;
	celsiusTargetRange?: AirConditionerRangeProfile;
	windStep?: AirConditionerRangeProfile;
	rotateUpDown: boolean;
	rotateLeftRight: boolean;
	hasHumidity: boolean;
	hasCurrentTemperature: boolean;
	hasFilterInfo: boolean;
}

export interface AirConditionerRawState {
	powerOn?: boolean;
	jobMode?: string;
	temperatureUnit?: AirConditionerTemperatureUnit;
	currentTemperature?: number;
	targetTemperature?: number;
	windStrength?: string;
	windStep?: number;
	runState?: string;
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

function readTemperatureUnit(profile: ThinqConnectPayload | undefined): AirConditionerTemperatureUnit {
	const value = readEnumProfile(profileProperty(profile, 'temperature', 'unit'))?.readValues ?? [];
	return value.includes('F') && !value.includes('C') ? 'F' : 'C';
}

function readCelsiusTargetRange(profile: ThinqConnectPayload | undefined): AirConditionerRangeProfile | undefined {
	const properties = firstObject(firstObject(profile)?.property);
	const entries = properties?.temperatureInUnits;
	if (!Array.isArray(entries)) {
		return undefined;
	}
	const celsius = entries.find((entry) => isPlainObject(entry) && entry.unit === 'C');
	if (!isPlainObject(celsius)) {
		return undefined;
	}
	for (const key of ['coolTargetTemperature', 'autoTargetTemperature', 'targetTemperature']) {
		const node = celsius[key];
		const range = readRangeProfile(isPlainObject(node) ? node : undefined);
		if (range) {
			return range;
		}
	}
	return undefined;
}

export function readAirConditionerProfile(profile: ThinqConnectPayload | undefined): AirConditionerProfile {
	return {
		power: readEnumProfile(profileProperty(profile, 'operation', 'airConOperationMode')),
		jobMode: readEnumProfile(profileProperty(profile, 'airConJobMode', 'currentJobMode')),
		windStrength: readEnumProfile(profileProperty(profile, 'airFlow', 'windStrength')),
		targetTemperature: readRangeProfile(profileProperty(profile, 'temperature', 'targetTemperature')),
		temperatureUnit: readTemperatureUnit(profile),
		celsiusTargetRange: readCelsiusTargetRange(profile),
		windStep: readRangeProfile(profileProperty(profile, 'airFlow', 'windStep')),
		rotateUpDown: stringItems(profileProperty(profile, 'windDirection', 'rotateUpDown')?.mode).includes('w'),
		rotateLeftRight: stringItems(profileProperty(profile, 'windDirection', 'rotateLeftRight')?.mode).includes('w'),
		hasHumidity: profileProperty(profile, 'airQualitySensor', 'humidity') !== undefined,
		hasCurrentTemperature: profileProperty(profile, 'temperature', 'currentTemperature') !== undefined,
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
		windStep: asNumber(airFlow?.windStep),
		runState: asString(firstObject(root.runState)?.currentState),
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

export function resolveTargetTemperatureUnit(profile: AirConditionerProfile): AirConditionerTemperatureUnit {
	return profile.temperatureUnit ?? 'C';
}

export function resolveCelsiusTargetRange(profile: AirConditionerProfile): AirConditionerRangeProfile | undefined {
	if (resolveTargetTemperatureUnit(profile) === 'C') {
		return profile.targetTemperature;
	}
	const range = profile.targetTemperature;
	return (
		profile.celsiusTargetRange ??
		(range && {
			...range,
			min: fahrenheitToCelsius(range.min),
			max: fahrenheitToCelsius(range.max),
			step: (range.step * 5) / 9,
		})
	);
}

export function isAirConditionerFaultState(value: string | undefined): boolean {
	return value !== undefined && /ERROR|FAULT|FAIL/i.test(value);
}

export interface AirConditionerWindStepScale {
	min: number;
	max: number;
	step: number;
	count: number;
}

const WIND_STEP_MIN_COUNT = 2;
const WIND_STEP_MAX_COUNT = 10;

export function readWindStepScale(profile: AirConditionerProfile): AirConditionerWindStepScale | undefined {
	const range = profile.windStep;
	if (!range?.writable) {
		return undefined;
	}
	const { min, max, step } = range;
	if (!Number.isInteger(min) || !Number.isInteger(max) || !Number.isInteger(step) || step < 1) {
		return undefined;
	}
	const count = Math.floor((max - min) / step) + 1;
	if (count < WIND_STEP_MIN_COUNT || count > WIND_STEP_MAX_COUNT) {
		return undefined;
	}
	return { min, max, step, count };
}

export function windStepToPercent(scale: AirConditionerWindStepScale, step: number): number {
	const index = Math.min(scale.count, Math.max(1, Math.round((step - scale.min) / scale.step) + 1));
	return Math.round((index * 100) / scale.count);
}

export function percentToWindStep(scale: AirConditionerWindStepScale, percent: number): number | undefined {
	if (percent <= 0) {
		return undefined;
	}
	const index = Math.min(scale.count, Math.max(1, Math.ceil((percent * scale.count) / 100)));
	return scale.min + (index - 1) * scale.step;
}

export function evaluateAirConditionerWindStepWrite(profile: AirConditionerProfile, step: number): string | undefined {
	const range = profile.windStep;
	if (!range) {
		return 'Profile has no airFlow.windStep.';
	}
	if (!range.writable) {
		return 'airFlow.windStep is not writable for this device.';
	}
	if (!Number.isInteger(step) || step < range.min || step > range.max) {
		return `Wind step ${step} is outside the profile range ${range.min}-${range.max}.`;
	}
	if (range.step > 0 && (step - range.min) % range.step !== 0) {
		return `Wind step ${step} is not aligned to the profile step ${range.step}.`;
	}
	return undefined;
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

export function buildAirConditionerWindStepPayload(step: number): ThinqConnectResource {
	return { airFlow: { windStep: step } };
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
