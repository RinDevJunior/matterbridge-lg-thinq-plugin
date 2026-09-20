import { PlatformConfig } from 'matterbridge';

export interface ThinqDeviceCapabilityConfig {
	supportsHeat?: boolean;
	supportsDry?: boolean;
	supportsFanSpeedControl?: boolean;
	supportsJetMode?: boolean;
	supportsQuietMode?: boolean;
	supportsEnergySaveMode?: boolean;
	supportsAirCleanMode?: boolean;
	supportsLedControl?: boolean;
	supportsSwingMode?: boolean;
	supportsHumiditySensor?: boolean;
	supportsAirQualitySensor?: boolean;
	supportsEnergyMonitoring?: boolean;
}

export interface ThinqSceneButtonConfig {
	name: string;
	opMode: number;
}

export interface MatterOverrideSettings {
	matterVendorName: string;
	matterVendorId: number;
	matterProductName: string;
	matterProductId: number;
}

export interface ThinqDeviceConfigEntry {
	deviceId: string;
	capabilities?: ThinqDeviceCapabilityConfig;
	sceneButtons?: ThinqSceneButtonConfig[];
	productName?: string;
}

export interface ThinqAuthConfig {
	loginType: 'account' | 'token';
	username?: string;
	password?: string;
	refreshToken?: string;
	country: string;
	language: string;
	refreshIntervalSeconds?: number;
	devices: ThinqDeviceConfigEntry[];
}

export interface WebosPluginConfig {
	devices: unknown[];
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

export interface LgThinkqPluginPlatformConfig extends PlatformConfig {
	thinq: ThinqAuthConfig;
	webos: WebosPluginConfig;
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
				matterProductName: 'LG Air Conditioner',
				matterProductId: 0x8000,
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
