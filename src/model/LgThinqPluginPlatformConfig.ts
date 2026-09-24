import { PlatformConfig } from 'matterbridge';

export interface ThinqDeviceCapabilityConfig {
	supportsHeat?: boolean;
	supportsFanSpeedControl?: boolean;
	supportsSwingMode?: boolean;
	supportsHumiditySensor?: boolean;
	supportsAirQualitySensor?: boolean;
	supportsEnergyMonitoring?: boolean;
	supportsFilterMonitoring?: boolean;
}

export interface MatterOverrideSettings {
	matterVendorName: string;
	matterVendorId: number;
}

export interface ThinqWasherControlConfig {
	allowRemoteStop?: boolean;
}

export interface ThinqAcFilterControlConfig {
	allowFilterReset?: boolean;
}

export interface ThinqDeviceConfigEntry {
	deviceId: string;
	deviceType?: 'AC' | 'WASHER';
	capabilities?: ThinqDeviceCapabilityConfig;
	productName?: string;
	productId?: number;
	washerControl?: ThinqWasherControlConfig;
	acFilterControl?: ThinqAcFilterControlConfig;
}

export interface ThinqAuthConfig {
	loginType: 'account' | 'token';
	username?: string;
	password?: string;
	refreshToken?: string;
	country: string;
	language: string;
	refreshIntervalSeconds?: number;
	filterMonitoringIntervalSeconds?: number;
	devices: ThinqDeviceConfigEntry[];
}

export interface AdvancedFeatureSetting {
	debug: boolean;
	clearStorageOnStartup: boolean;
	forceAuthentication: boolean;
	unregisterOnShutdown: boolean;
	overrideMatterConfiguration: boolean;
	matterOverrideSettings: MatterOverrideSettings;
}

export interface AdvancedFeatureConfiguration {
	settings: AdvancedFeatureSetting;
}

export interface LgThinqPluginPlatformConfig extends PlatformConfig {
	thinq: ThinqAuthConfig;
	advancedFeature: AdvancedFeatureConfiguration;
}

export function createDefaultAdvancedFeature(): AdvancedFeatureConfiguration {
	return {
		settings: {
			debug: false,
			clearStorageOnStartup: false,
			forceAuthentication: false,
			unregisterOnShutdown: false,
			overrideMatterConfiguration: false,
			matterOverrideSettings: {
				matterVendorName: 'Matterbridge',
				matterVendorId: 0xfff1,
			},
		},
	};
}

export function createDefaultThinqConfig(): ThinqAuthConfig {
	return {
		loginType: 'account',
		country: 'US',
		language: 'en-US',
		devices: [],
	};
}
