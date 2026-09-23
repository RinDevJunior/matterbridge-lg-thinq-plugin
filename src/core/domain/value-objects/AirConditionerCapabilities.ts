import type { ThinqDeviceConfigEntry } from '../../../model/LgThinkqPluginPlatformConfig.js';

/** Resolved per-device Matter capability set for a ThinQ AirConditioner endpoint. */
export interface AirConditionerCapabilities {
	readonly supportsHeat: boolean;
	readonly supportsFanSpeedControl: boolean;
	readonly supportsSwingMode: boolean;
	readonly supportsHumiditySensor: boolean;
	readonly supportsAirQualitySensor: boolean;
	readonly supportsEnergyMonitoring: boolean;
	readonly supportsFilterMonitoring: boolean;
}

export const DEFAULT_AIR_CONDITIONER_CAPABILITIES: AirConditionerCapabilities = {
	supportsHeat: true,
	supportsFanSpeedControl: true,
	supportsSwingMode: false,
	supportsHumiditySensor: false,
	supportsAirQualitySensor: false,
	supportsEnergyMonitoring: false,
	supportsFilterMonitoring: false,
};

/**
 * Merges configured per-device capability flags over the full-support default.
 * Existing flags (supportsHeat/supportsFanSpeedControl) default to `true`.
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
		supportsFanSpeedControl:
			capabilities?.supportsFanSpeedControl ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsFanSpeedControl,
		supportsSwingMode: capabilities?.supportsSwingMode ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsSwingMode,
		supportsHumiditySensor:
			capabilities?.supportsHumiditySensor ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsHumiditySensor,
		supportsAirQualitySensor:
			capabilities?.supportsAirQualitySensor ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsAirQualitySensor,
		supportsEnergyMonitoring:
			capabilities?.supportsEnergyMonitoring ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsEnergyMonitoring,
		supportsFilterMonitoring:
			capabilities?.supportsFilterMonitoring ?? DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsFilterMonitoring,
	};
}
