import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { FanControl } from 'matterbridge/matter/clusters';

import type { ThinqAirConditionerDevice, ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import { PlatformConfigManager } from '../platformConfigManager.js';
import {
	registerAirConditionerCommandHandlers,
	THINQ_FAN_SPEED_AUTO,
	THINQ_FAN_SPEED_LOW,
	THINQ_FAN_SPEED_MEDIUM,
} from './thinqAirConditionerCommandHandlers.js';
import { buildAirConditionerEndpoint } from './thinqAirConditionerEndpointFactory.js';
import { registerFilterResetCommandHandler } from './thinqAirConditionerFilterResetCommandHandler.js';
import { registerWasherCommandHandlers } from './thinqWasherCommandHandlers.js';
import { buildWasherEndpoint } from './thinqWasherEndpointFactory.js';
import { extractWasherStopCommand, type WasherStopCommandPayload } from './thinqWasherStopCommandResolver.js';

const DEFAULT_TEMPERATURE_CELSIUS = 20;
const MAX_HEAT_SETPOINT_LIMIT_CELSIUS = 30;
const MIN_COOL_SETPOINT_LIMIT_CELSIUS = 18;

export function mapWindStrengthToFanMode(windStrength: number | undefined): FanControl.FanMode {
	if (windStrength === undefined || windStrength === THINQ_FAN_SPEED_AUTO) {
		return FanControl.FanMode.Auto;
	}
	if (windStrength <= THINQ_FAN_SPEED_LOW) {
		return FanControl.FanMode.Low;
	}
	if (windStrength <= THINQ_FAN_SPEED_MEDIUM) {
		return FanControl.FanMode.Medium;
	}
	return FanControl.FanMode.High;
}

export function mapWindStrengthToFixedFanMode(windStrength: number | undefined): FanControl.FanMode {
	return windStrength === undefined ? FanControl.FanMode.Off : FanControl.FanMode.High;
}

/**
 * Builds Matterbridge `AirConditioner` device endpoints from a ThinQ AirConditioner snapshot
 * (mirrors `matterbridge-example-dynamic-platform/src/module.ts:2726-2734`).
 */
export class ThinqDeviceConfigurator {
	constructor(
		private readonly logger: AnsiLogger,
		private readonly apiClient: ThinqApiClient,
		private readonly configManager: PlatformConfigManager,
	) {}

	public async registerAirConditioner(device: ThinqAirConditionerDevice): Promise<MatterbridgeEndpoint> {
		const snapshot = device.snapshot;
		const currentTemperature = snapshot.currentTemperatureCelsius ?? DEFAULT_TEMPERATURE_CELSIUS;
		const targetTemperature = snapshot.targetTemperatureCelsius ?? DEFAULT_TEMPERATURE_CELSIUS;
		const capabilities = this.configManager.getDeviceCapabilities(device.id);

		this.logger.debug(`registerAirConditioner: entry for deviceId=${device.id}`);
		this.logger.info(`Registering ThinQ AirConditioner: ${device.name} (${device.id})`);

		const initialFanMode = capabilities.supportsFanSpeedControl
			? mapWindStrengthToFanMode(snapshot.windStrength)
			: mapWindStrengthToFixedFanMode(snapshot.windStrength);

		const matterOverride = this.configManager.overrideMatterConfiguration
			? this.configManager.matterOverrideSettings
			: undefined;
		const productNameOverride = this.configManager.getProductNameForDevice(device.id);

		const airConditioner = buildAirConditionerEndpoint(
			device,
			capabilities,
			{
				currentTemperature,
				targetTemperature,
				minHeatSetpointLimitCelsius: 0,
				maxHeatSetpointLimitCelsius: MAX_HEAT_SETPOINT_LIMIT_CELSIUS,
				minCoolSetpointLimitCelsius: MIN_COOL_SETPOINT_LIMIT_CELSIUS,
				maxCoolSetpointLimitCelsius: 50,
			},
			initialFanMode,
			{
				vendorId: matterOverride?.matterVendorId,
				vendorName: matterOverride?.matterVendorName,
				productId: matterOverride?.matterProductId,
				productName: productNameOverride ?? matterOverride?.matterProductName,
			},
		)
			.createDefaultTemperatureMeasurementClusterServer(currentTemperature * 100)
			.addRequiredClusterServers();

		// Hardcoded: the AC is always exposed as its own standalone Matter node (server mode) so it can get its own
		// power tile in Apple Home. Not user-configurable.
		airConditioner.mode = 'server';

		registerAirConditionerCommandHandlers(airConditioner, device, this.apiClient, this.logger, capabilities);

		const filterResetControl = this.configManager.getAcFilterControlConfig(device.id);
		registerFilterResetCommandHandler(
			airConditioner,
			device,
			this.apiClient,
			this.logger,
			capabilities,
			filterResetControl,
		);

		this.logger.debug(`registerAirConditioner: completed for deviceId=${device.id}`);
		return Promise.resolve(airConditioner);
	}

	public async registerWasher(device: ThinqWasherDevice): Promise<MatterbridgeEndpoint> {
		this.logger.debug(`registerWasher: entry for deviceId=${device.id}`);
		this.logger.info(`Registering ThinQ Washer: ${device.name} (${device.id})`);

		const washer = buildWasherEndpoint(device);

		// Hardcoded: the washer is always exposed as its own standalone Matter node (server mode), matching the AC.
		washer.mode = 'server';

		const washerControl = this.configManager.getWasherControlConfig(device.id);
		const stopCommandPayload = await this.resolveWasherStopCommandPayload(device);
		registerWasherCommandHandlers(washer, device, this.apiClient, this.logger, washerControl, stopCommandPayload);

		this.logger.debug(`registerWasher: completed for deviceId=${device.id}`);
		return washer;
	}

	/**
	 * Resolves a real `WMStop`/`WMOff` command payload from the device's own downloaded model JSON.
	 * Runs unconditionally at registration (read-only GET, no washer state mutated) regardless of
	 * whether `washerControl.allowRemoteStop` is set, so the resolved payload is visible in the logs
	 * for manual sanity-checking before the opt-in flag is ever turned on. Never throws — any
	 * fetch/parse failure resolves to `undefined`, so a broken model-JSON URL can never block
	 * washer registration.
	 */
	private async resolveWasherStopCommandPayload(
		device: ThinqWasherDevice,
	): Promise<WasherStopCommandPayload | undefined> {
		if (!device.modelJsonUri) {
			return undefined;
		}

		try {
			const model = await this.apiClient.getDeviceModel(device.modelJsonUri);
			const payload = extractWasherStopCommand(model);
			if (payload) {
				this.logger.info(
					`ThinQ Washer ${device.id}: resolved stop-command payload from device model: ${JSON.stringify(payload)}`,
				);
			} else {
				this.logger.info(`ThinQ Washer ${device.id}: device model has no WMStop/WMOff entry.`);
			}
			return payload;
		} catch (error) {
			this.logger.debug(
				`ThinQ Washer ${device.id}: failed to resolve stop-command payload from device model: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}
}
