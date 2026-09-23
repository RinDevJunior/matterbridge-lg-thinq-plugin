import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import {
	AirQuality,
	ElectricalPowerMeasurement,
	FanControl,
	OnOff,
	Pm10ConcentrationMeasurement,
	Pm25ConcentrationMeasurement,
	RelativeHumidityMeasurement,
	TemperatureMeasurement,
	Thermostat,
} from 'matterbridge/matter/clusters';

import type { AirConditionerCapabilities } from '../../core/domain/value-objects/AirConditionerCapabilities.js';
import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';
import { applyAuxiliaryToggleSnapshot } from './thinqAirConditionerAuxiliaryToggles.js';
import {
	THINQ_FAN_SPEED_AUTO,
	THINQ_FAN_SPEED_LOW,
	THINQ_FAN_SPEED_MEDIUM,
} from './thinqAirConditionerCommandHandlers.js';
import { mapWindStrengthToFanMode, mapWindStrengthToFixedFanMode } from './thinqDeviceConfigurator.js';

/** LG `airState.opMode` values (`homebridge-lg-thinq/src/devices/AirConditioner.ts`). */
const THINQ_OP_MODE_COOL = 0;
const THINQ_OP_MODE_DRY = 1;
const THINQ_OP_MODE_FAN = 2;
const THINQ_OP_MODE_HEAT = 4;
const THINQ_OP_MODE_AIR_CLEAN = 5;
const THINQ_OP_MODE_AUTO = 6;

const WIND_STRENGTH_LOW_PERCENT = 20;
const WIND_STRENGTH_MEDIUM_PERCENT = 50;
const WIND_STRENGTH_HIGH_PERCENT = 90;

const KEY_OPERATION = 'airState.operation';
const KEY_OP_MODE = 'airState.opMode';
const KEY_TEMP_CURRENT = 'airState.tempState.current';
const KEY_TEMP_TARGET = 'airState.tempState.target';
const KEY_WIND_STRENGTH = 'airState.windStrength';
const KEY_SWING_VERTICAL = 'airState.wDir.vStep';
const KEY_SWING_HORIZONTAL = 'airState.wDir.hStep';

/** Maps a ThinQ `airState.windStrength` value to a Matter `FanControl.percentCurrent` (Auto has no percent equivalent). */
export function mapWindStrengthToPercent(windStrength: number | undefined): number | undefined {
	if (windStrength === undefined || windStrength === THINQ_FAN_SPEED_AUTO) {
		return undefined;
	}
	if (windStrength <= THINQ_FAN_SPEED_LOW) {
		return WIND_STRENGTH_LOW_PERCENT;
	}
	if (windStrength <= THINQ_FAN_SPEED_MEDIUM) {
		return WIND_STRENGTH_MEDIUM_PERCENT;
	}
	return WIND_STRENGTH_HIGH_PERCENT;
}

/**
 * Maps ThinQ power-state + `airState.opMode` to a Matter `Thermostat.SystemMode`.
 * Apple Home's Thermostat UI only exposes Off/Heat/Cool/Auto, so Dry and Fan-only opModes
 * (which have no equivalent Apple-visible slot) collapse into Cool.
 */
export function mapOperationModeToSystemMode(
	operationMode: number | undefined,
	isPowerOn: boolean,
	capabilities: AirConditionerCapabilities,
): Thermostat.SystemMode {
	if (!isPowerOn) {
		return Thermostat.SystemMode.Off;
	}

	switch (operationMode) {
		case THINQ_OP_MODE_AUTO:
			return capabilities.supportsHeat ? Thermostat.SystemMode.Auto : Thermostat.SystemMode.Cool;
		case THINQ_OP_MODE_COOL:
			return Thermostat.SystemMode.Cool;
		case THINQ_OP_MODE_HEAT:
			return capabilities.supportsHeat ? Thermostat.SystemMode.Heat : Thermostat.SystemMode.Cool;
		case THINQ_OP_MODE_FAN:
			return Thermostat.SystemMode.Cool;
		case THINQ_OP_MODE_DRY:
			return Thermostat.SystemMode.Cool;
		case THINQ_OP_MODE_AIR_CLEAN:
		default:
			return capabilities.supportsHeat ? Thermostat.SystemMode.Auto : Thermostat.SystemMode.Cool;
	}
}

/** Resolves systemMode update from a snapshot, returning undefined if the write should be skipped. */
function resolveSystemModeUpdate(
	airConditioner: MatterbridgeEndpoint,
	snapshot: ThinqSnapshot,
	capabilities: AirConditionerCapabilities,
): Thermostat.SystemMode | undefined {
	if (!snapshot.has(KEY_OPERATION)) {
		if (!snapshot.has(KEY_OP_MODE)) {
			return undefined;
		}
		// operation absent, opMode present: derive power from current OnOff attribute
		const currentPowerOn = (airConditioner.getAttribute(OnOff.id, 'onOff') as boolean | undefined) === true;
		if (!currentPowerOn) {
			return undefined;
		}
		return mapOperationModeToSystemMode(snapshot.operationMode, true, capabilities);
	}

	// operation present
	const isPowerOn = snapshot.isPowerOn;
	if (isPowerOn && !snapshot.has(KEY_OP_MODE)) {
		// operation present and 1, opMode absent: skip systemMode
		return undefined;
	}

	return mapOperationModeToSystemMode(snapshot.operationMode, isPowerOn, capabilities);
}

/**
 * True when the AC is known to be off: the snapshot's `airState.operation` if present, otherwise the endpoint's
 * current OnOff attribute (unknown/undefined is treated as NOT off).
 */
function isKnownOff(airConditioner: MatterbridgeEndpoint, snapshot: ThinqSnapshot): boolean {
	if (snapshot.has(KEY_OPERATION)) {
		return !snapshot.isPowerOn;
	}
	return (airConditioner.getAttribute(OnOff.id, 'onOff') as boolean | undefined) === false;
}

/** Resolves rock setting from a snapshot, returning undefined if neither swing axis key is present. */
function resolveRockSetting(
	airConditioner: MatterbridgeEndpoint,
	snapshot: ThinqSnapshot,
): { rockLeftRight: boolean; rockUpDown: boolean; rockRound: boolean } | undefined {
	const hasVertical = snapshot.has(KEY_SWING_VERTICAL);
	const hasHorizontal = snapshot.has(KEY_SWING_HORIZONTAL);

	if (!hasVertical && !hasHorizontal) {
		return undefined;
	}

	let verticalOn = snapshot.isVerticalSwingOn;
	let horizontalOn = snapshot.isHorizontalSwingOn;

	// Fallback to current attribute if only one axis is present
	if (!hasVertical) {
		const currentRockSetting = airConditioner.getAttribute(FanControl.id, 'rockSetting') as
			{ rockUpDown?: boolean } | undefined;
		verticalOn = currentRockSetting?.rockUpDown ?? false;
	}

	if (!hasHorizontal) {
		const currentRockSetting = airConditioner.getAttribute(FanControl.id, 'rockSetting') as
			{ rockLeftRight?: boolean } | undefined;
		horizontalOn = currentRockSetting?.rockLeftRight ?? false;
	}

	return {
		rockLeftRight: horizontalOn,
		rockUpDown: verticalOn,
		rockRound: verticalOn && horizontalOn,
	};
}

/**
 * Pushes a freshly polled ThinQ snapshot onto the Matter `AirConditioner` endpoint's attributes
 * (device → Apple Home). Uses `updateAttribute` (idempotent) to avoid redundant attribute-report churn.
 */
export async function applyThinqSnapshotToAirConditioner(
	airConditioner: MatterbridgeEndpoint,
	snapshot: ThinqSnapshot,
	capabilities: AirConditionerCapabilities,
	logger: AnsiLogger,
): Promise<void> {
	const deviceId = airConditioner.serialNumber ?? airConditioner.uniqueId ?? 'unknown';
	const hasPower = snapshot.has(KEY_OPERATION);
	const systemModeUpdate = resolveSystemModeUpdate(airConditioner, snapshot, capabilities);
	const rockSetting =
		capabilities.supportsFanSpeedControl && capabilities.supportsSwingMode
			? resolveRockSetting(airConditioner, snapshot)
			: undefined;

	const attributesToPush: string[] = [];
	const attributesToSkip: string[] = [];

	if (hasPower) {
		attributesToPush.push('power');
	} else {
		attributesToSkip.push('power');
	}

	if (systemModeUpdate !== undefined) {
		attributesToPush.push('systemMode');
	} else {
		attributesToSkip.push('systemMode');
	}

	if (snapshot.currentTemperatureCelsius !== undefined) {
		attributesToPush.push('currentTemp');
	} else if (snapshot.has(KEY_TEMP_CURRENT)) {
		attributesToSkip.push('currentTemp');
	}

	if (snapshot.targetTemperatureCelsius !== undefined) {
		attributesToPush.push('targetTemp');
	} else if (snapshot.has(KEY_TEMP_TARGET)) {
		attributesToSkip.push('targetTemp');
	}

	if (snapshot.has(KEY_WIND_STRENGTH)) {
		attributesToPush.push('fanSpeed');
	} else if (capabilities.supportsFanSpeedControl) {
		attributesToSkip.push('fanSpeed');
	}

	logger.debug(
		`applyThinqSnapshotToAirConditioner: entry for deviceId=${deviceId}, pushing ${attributesToPush.length} attributes: ${attributesToPush.join(', ')}`,
	);

	if (attributesToSkip.length > 0) {
		logger.debug(`applyThinqSnapshotToAirConditioner: skipped (source key absent): ${attributesToSkip.join(', ')}`);
	}

	if (hasPower) {
		await airConditioner.updateAttribute(OnOff.id, 'onOff', snapshot.isPowerOn, logger);
	}

	const currentTemperatureCelsius = snapshot.currentTemperatureCelsius;
	if (currentTemperatureCelsius !== undefined) {
		await airConditioner.updateAttribute(
			TemperatureMeasurement.id,
			'measuredValue',
			currentTemperatureCelsius * 100,
			logger,
		);
		await airConditioner.updateAttribute(Thermostat.id, 'localTemperature', currentTemperatureCelsius * 100, logger);
	}

	const targetTemperatureCelsius = snapshot.targetTemperatureCelsius;
	if (targetTemperatureCelsius !== undefined) {
		await airConditioner.updateAttribute(
			Thermostat.id,
			'occupiedCoolingSetpoint',
			targetTemperatureCelsius * 100,
			logger,
		);
		if (capabilities.supportsHeat) {
			await airConditioner.updateAttribute(
				Thermostat.id,
				'occupiedHeatingSetpoint',
				targetTemperatureCelsius * 100,
				logger,
			);
		}
	}

	if (systemModeUpdate !== undefined) {
		await airConditioner.updateAttribute(Thermostat.id, 'systemMode', systemModeUpdate, logger);
	}

	if (snapshot.has(KEY_WIND_STRENGTH)) {
		if (capabilities.supportsFanSpeedControl) {
			await airConditioner.updateAttribute(
				FanControl.id,
				'fanMode',
				mapWindStrengthToFanMode(snapshot.windStrength),
				logger,
			);

			const percentCurrent = mapWindStrengthToPercent(snapshot.windStrength);
			if (percentCurrent !== undefined) {
				await airConditioner.updateAttribute(FanControl.id, 'percentCurrent', percentCurrent, logger);
			}
		} else {
			await airConditioner.updateAttribute(
				FanControl.id,
				'fanMode',
				mapWindStrengthToFixedFanMode(snapshot.windStrength),
				logger,
			);
		}
	}

	if (capabilities.supportsFanSpeedControl && capabilities.supportsSwingMode && rockSetting !== undefined) {
		await airConditioner.updateAttribute(FanControl.id, 'rockSetting', rockSetting, logger);
	}

	await applyAuxiliaryToggleSnapshot(airConditioner, snapshot, capabilities, logger);

	if (capabilities.supportsHumiditySensor) {
		const humidityPercent = snapshot.humidityPercent;
		if (humidityPercent !== undefined) {
			const humiditySensorChild = airConditioner.getChildEndpointById('HumiditySensor');
			if (humiditySensorChild) {
				await humiditySensorChild.updateAttribute(
					RelativeHumidityMeasurement.id,
					'measuredValue',
					humidityPercent * 100,
					logger,
				);
			}
		}
	}

	if (capabilities.supportsAirQualitySensor) {
		const airQualitySensorChild = airConditioner.getChildEndpointById('AirQualitySensor');
		if (airQualitySensorChild) {
			const airQualityOverall = snapshot.airQualityOverall;
			if (airQualityOverall !== undefined) {
				await airQualitySensorChild.updateAttribute(AirQuality.id, 'airQuality', airQualityOverall, logger);
			}

			const pm25Value = snapshot.pm25;
			if (pm25Value !== undefined) {
				await airQualitySensorChild.updateAttribute(
					Pm25ConcentrationMeasurement.id,
					'measuredValue',
					pm25Value,
					logger,
				);
			}

			const pm10Value = snapshot.pm10;
			if (pm10Value !== undefined) {
				await airQualitySensorChild.updateAttribute(
					Pm10ConcentrationMeasurement.id,
					'measuredValue',
					pm10Value,
					logger,
				);
			}
		}
	}

	if (capabilities.supportsEnergyMonitoring) {
		// LG reports a floor raw value (~50 W) while the AC is off; never show that as consumption.
		const watts = isKnownOff(airConditioner, snapshot) ? 0 : snapshot.powerConsumptionWatts;
		if (watts !== undefined) {
			await airConditioner.updateAttribute(
				ElectricalPowerMeasurement.id,
				'activePower',
				Math.round(watts * 1000),
				logger,
			);
		}
	}
}
