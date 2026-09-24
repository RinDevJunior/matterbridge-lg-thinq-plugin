/**
 * Platform configuration manager.
 * Provides validation and defaults over the raw plugin config.
 */

import type { AnsiLogger } from 'matterbridge/logger';

import type { AirConditionerCapabilities } from '../core/domain/value-objects/AirConditionerCapabilities.js';
import { resolveAirConditionerCapabilities } from '../core/domain/value-objects/AirConditionerCapabilities.js';
import {
	createDefaultAdvancedFeature,
	createDefaultThinqConfig,
	LgThinkqPluginPlatformConfig,
	type MatterOverrideSettings,
	type ThinqAcFilterControlConfig,
	type ThinqWasherControlConfig,
} from '../model/LgThinkqPluginPlatformConfig.js';

const DEFAULT_THINQ_REFRESH_INTERVAL_SECONDS = 60;
const DEFAULT_FILTER_MONITORING_INTERVAL_SECONDS = 3600;

/**
 * Manages platform configuration with validation and defaults.
 */
export class PlatformConfigManager {
	private constructor(
		private readonly config: LgThinkqPluginPlatformConfig,
		private readonly log: AnsiLogger,
	) {
		this.config.thinq ??= createDefaultThinqConfig();
		this.config.webos ??= { devices: [] };
		this.config.advancedFeature ??= createDefaultAdvancedFeature();
	}

	/**
	 * Create a PlatformConfigManager with defaults applied.
	 */
	public static create(config: LgThinkqPluginPlatformConfig, log: AnsiLogger): PlatformConfigManager {
		return new PlatformConfigManager(config, log);
	}

	public get rawConfig(): LgThinkqPluginPlatformConfig {
		return this.config;
	}

	public get debug(): boolean {
		return this.config.advancedFeature.settings.debug;
	}

	public get isClearStorageOnStartupEnabled(): boolean {
		return this.config.advancedFeature.settings.clearStorageOnStartup;
	}

	public get isForceAuthenticationEnabled(): boolean {
		return this.config.advancedFeature.settings.forceAuthentication;
	}

	public get unregisterOnShutdown(): boolean {
		return this.config.advancedFeature.settings.unregisterOnShutdown;
	}

	public get thinqLoginType(): 'account' | 'token' {
		return this.config.thinq.loginType;
	}

	public get thinqUsername(): string | undefined {
		return this.config.thinq.username;
	}

	public get thinqPassword(): string | undefined {
		return this.config.thinq.password;
	}

	public get thinqRefreshToken(): string | undefined {
		return this.config.thinq.refreshToken;
	}

	public get country(): string {
		return this.config.thinq.country;
	}

	public get language(): string {
		return this.config.thinq.language;
	}

	public get thinqRefreshIntervalSeconds(): number {
		return this.config.thinq.refreshIntervalSeconds ?? DEFAULT_THINQ_REFRESH_INTERVAL_SECONDS;
	}

	public get thinqFilterMonitoringIntervalSeconds(): number {
		return this.config.thinq.filterMonitoringIntervalSeconds ?? DEFAULT_FILTER_MONITORING_INTERVAL_SECONDS;
	}

	public getDeviceCapabilities(deviceId: string): AirConditionerCapabilities {
		return resolveAirConditionerCapabilities(this.config.thinq.devices, deviceId);
	}

	public getWasherControlConfig(deviceId: string): ThinqWasherControlConfig {
		return this.config.thinq.devices?.find((d) => d.deviceId === deviceId)?.washerControl ?? {};
	}

	public getAcFilterControlConfig(deviceId: string): ThinqAcFilterControlConfig {
		return this.config.thinq.devices?.find((d) => d.deviceId === deviceId)?.acFilterControl ?? {};
	}

	public get overrideMatterConfiguration(): boolean {
		return this.config.advancedFeature.settings.overrideMatterConfiguration;
	}

	public get matterOverrideSettings(): MatterOverrideSettings {
		return this.config.advancedFeature.settings.matterOverrideSettings;
	}

	public getProductNameForDevice(deviceId: string): string | undefined {
		if (!this.overrideMatterConfiguration) return undefined;
		return this.config.thinq.devices?.find((d) => d.deviceId === deviceId)?.productName;
	}

	public validateConfig(): boolean {
		this.log.debug('Validating platform config');

		if (this.thinqLoginType === 'token') {
			return Boolean(this.thinqRefreshToken);
		}

		return Boolean(this.thinqUsername && this.thinqPassword);
	}
}
