import type { ThinqDeviceConfigEntry } from '../../../model/LgThinkqPluginPlatformConfig.js';

/** Resolved per-device Matter capability set for a ThinQ AirConditioner endpoint. */
export interface AirConditionerCapabilities {
	readonly supportsHeat: boolean;
	readonly supportsDry: boolean;
	readonly supportsFanSpeedControl: boolean;
	readonly supportsJetMode: boolean;
	readonly supportsQuietMode: boolean;
	readonly supportsEnergySaveMode: boolean;
	readonly supportsAirCleanMode: boolean;
	readonly supportsLedControl: boolean;
	readonly supportsSwingMode: boolean;
	readonly supportsHumiditySensor: boolean;
	readonly supportsAirQualitySensor: boolean;
	readonly supportsEnergyMonitoring: boolean;
}

export const DEFAULT_AIR_CONDITIONER_CAPABILITIES: AirConditionerCapabilities = {
	supportsHeat: true,
	supportsDry: true,
	supportsFanSpeedControl: true,
	supportsJetMode: false,
	supportsQuietMode: false,
	supportsEnergySaveMode: false,
	supportsAirCleanMode: false,
	supportsLedControl: false,
	supportsSwingMode: false,
	supportsHumiditySensor: false,
	supportsAirQualitySensor: false,
	supportsEnergyMonitoring: false,
};

/**
 * Merges configured per-device capability flags over the full-support default.
 * Existing flags (supportsHeat/supportsDry/supportsFanSpeedControl) default to `true`.
 * New flags (all others) default to `false` (opt-in).
 */
export function resolveAirConditionerCapabilities(
	devices: ThinqDeviceConfigEntry[] | undefined,
	deviceId: string,
): AirConditionerCapabilities {
	const entry = devices?.find((device) => device.deviceId === deviceId);
	const capabilities = entry?.capabilities;

	return {
		supportsHeat: capabilities?.supportsHeat ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsHeat,
		supportsDry: capabilities?.supportsDry ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsDry,
		supportsFanSpeedControl:
			capabilities?.supportsFanSpeedControl ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsFanSpeedControl,
		supportsJetMode: capabilities?.supportsJetMode ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsJetMode,
		supportsQuietMode: capabilities?.supportsQuietMode ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsQuietMode,
		supportsEnergySaveMode:
			capabilities?.supportsEnergySaveMode ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsEnergySaveMode,
		supportsAirCleanMode:
			capabilities?.supportsAirCleanMode ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsAirCleanMode,
		supportsLedControl: capabilities?.supportsLedControl ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsLedControl,
		supportsSwingMode: capabilities?.supportsSwingMode ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsSwingMode,
		supportsHumiditySensor:
			capabilities?.supportsHumiditySensor ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsHumiditySensor,
		supportsAirQualitySensor:
			capabilities?.supportsAirQualitySensor ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsAirQualitySensor,
		supportsEnergyMonitoring:
			capabilities?.supportsEnergyMonitoring ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsEnergyMonitoring,
	};
}
