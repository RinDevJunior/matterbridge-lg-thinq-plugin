import {
	airQualitySensor,
	electricalSensor,
	MatterbridgeEndpoint,
	powerSource,
	roomAirConditioner,
} from 'matterbridge';
import { AirQuality, FanControl, PowerTopology } from 'matterbridge/matter/clusters';

import type { ThinqAirConditionerDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { AirConditionerCapabilities } from '../../core/domain/value-objects/AirConditionerCapabilities.js';

export interface AirConditionerEndpointSetpoints {
	currentTemperature: number;
	targetTemperature: number;
	minHeatSetpointLimitCelsius: number;
	maxHeatSetpointLimitCelsius: number;
	minCoolSetpointLimitCelsius: number;
	maxCoolSetpointLimitCelsius: number;
}

/**
 * Hand-composes an `AirConditioner`-shaped `MatterbridgeEndpoint`, mirroring
 * `@matterbridge/core`'s own `AirConditioner` constructor, but branching the
 * Thermostat/FanControl cluster construction on the device's configured capabilities
 * (`Behaviors.require()` throws on a 2nd call for the same cluster id, so the feature
 * set must be chosen up-front — see `.claude/memory.md`).
 */
export interface BuildAirConditionerEndpointOptions {
	vendorId?: number;
	vendorName?: string;
	productId?: number;
	productName?: string;
}

export function buildAirConditionerEndpoint(
	device: ThinqAirConditionerDevice,
	capabilities: AirConditionerCapabilities,
	setpoints: AirConditionerEndpointSetpoints,
	initialFanMode: FanControl.FanMode,
	options?: BuildAirConditionerEndpointOptions,
): MatterbridgeEndpoint {
	const {
		currentTemperature,
		targetTemperature,
		minHeatSetpointLimitCelsius,
		maxHeatSetpointLimitCelsius,
		minCoolSetpointLimitCelsius,
		maxCoolSetpointLimitCelsius,
	} = setpoints;

	const endpoint = new MatterbridgeEndpoint(
		capabilities.supportsEnergyMonitoring
			? [roomAirConditioner, powerSource, electricalSensor]
			: [roomAirConditioner, powerSource],
		{
			id: `${device.name.replaceAll(' ', '')}-${device.id.replaceAll(' ', '')}`,
		},
	)
		.createDefaultIdentifyClusterServer()
		.createDefaultBasicInformationClusterServer(
			device.name,
			device.id,
			options?.vendorId ?? 0xfff1,
			options?.vendorName ?? 'Matterbridge',
			options?.productId ?? 0x8000,
			options?.productName ?? 'Matterbridge Air Conditioner',
		)
		.createDefaultPowerSourceWiredClusterServer()
		.createDeadFrontOnOffClusterServer(true);

	if (capabilities.supportsHeat) {
		endpoint.createDefaultThermostatClusterServer(
			currentTemperature,
			targetTemperature,
			targetTemperature,
			1,
			minHeatSetpointLimitCelsius,
			maxHeatSetpointLimitCelsius,
			minCoolSetpointLimitCelsius,
			maxCoolSetpointLimitCelsius,
		);
	} else {
		endpoint.createDefaultCoolingThermostatClusterServer(
			currentTemperature,
			targetTemperature,
			minCoolSetpointLimitCelsius,
			maxCoolSetpointLimitCelsius,
		);
	}
	endpoint.createDefaultThermostatUserInterfaceConfigurationClusterServer();

	if (capabilities.supportsFanSpeedControl && capabilities.supportsSwingMode) {
		endpoint.createCompleteFanControlClusterServer(
			initialFanMode,
			FanControl.FanModeSequence.OffLowMedHighAuto,
			0,
			0,
			undefined,
			undefined,
			undefined,
			{ rockLeftRight: true, rockUpDown: true, rockRound: true },
			{ rockLeftRight: false, rockUpDown: false, rockRound: false },
		);
	} else if (capabilities.supportsFanSpeedControl) {
		endpoint.createDefaultFanControlClusterServer(initialFanMode, FanControl.FanModeSequence.OffLowMedHighAuto, 0, 0);
	} else {
		endpoint.createOnOffFanControlClusterServer(initialFanMode);
	}

	if (capabilities.supportsHumiditySensor) {
		// RelativeHumidityMeasurement is an optional cluster of roomAirConditioner itself (matterbridgeDeviceTypes.js),
		// same as TemperatureMeasurement below — no separate child endpoint needed.
		endpoint.createDefaultRelativeHumidityMeasurementClusterServer(0);
	}

	if (capabilities.supportsAirQualitySensor) {
		endpoint
			.addChildDeviceType('AirQualitySensor', [airQualitySensor])
			.createDefaultIdentifyClusterServer()
			.createDefaultAirQualityClusterServer(AirQuality.AirQualityEnum.Unknown)
			.createDefaultPm25ConcentrationMeasurementClusterServer()
			.createDefaultPm10ConcentrationMeasurementClusterServer();
	}

	if (capabilities.supportsEnergyMonitoring) {
		// Electrical measurement lives on the AC endpoint itself (electricalSensor device type). PowerTopology is
		// mandatory for electricalSensor; NodeTopology because the AC is now its own standalone Matter node (server
		// mode), not shared with a bridge. activePower starts at 0 (not null) because Apple may hide null.
		endpoint
			.createDefaultPowerTopologyClusterServer(PowerTopology.Feature.NodeTopology)
			.createDefaultElectricalPowerMeasurementClusterServer(null, null, 0, null);
	}

	if (capabilities.supportsFilterMonitoring) {
		endpoint.createDefaultHepaFilterMonitoringClusterServer();
	}

	return endpoint;
}
