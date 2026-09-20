import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LgThinkqPluginPlatformConfig } from '../../model/LgThinkqPluginPlatformConfig.js';
import { PlatformConfigManager } from '../../platform/platformConfigManager.js';
import { asPartial, createMockLogger } from '../helpers/testUtils.js';

describe('PlatformConfigManager', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
	});

	describe('create', () => {
		it('should apply defaults when thinq/webos/advancedFeature are undefined', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.rawConfig.thinq).toEqual({
				loginType: 'account',
				country: 'US',
				language: 'en-US',
				devices: [],
			});
			expect(manager.rawConfig.webos).toEqual({ devices: [] });
			expect(manager.rawConfig.advancedFeature).toEqual({
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
			});
		});

		it('should preserve existing values and not overwrite them', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'token',
					country: 'KR',
					language: 'ko-KR',
					refreshToken: 'test-token',
					devices: [],
				},
				webos: { devices: ['device1'] as unknown as unknown[] },
				advancedFeature: {
					settings: {
						debug: true,
						clearStorageOnStartup: true,
						forceAuthentication: true,
						unregisterOnShutdown: true,
						overrideMatterConfiguration: false,
						matterOverrideSettings: {
							matterVendorName: 'Matterbridge',
							matterVendorId: 0xfff1,
							matterProductName: 'LG Air Conditioner',
							matterProductId: 0x8000,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.rawConfig.thinq.loginType).toBe('token');
			expect(manager.rawConfig.thinq.country).toBe('KR');
			expect(manager.rawConfig.thinq.language).toBe('ko-KR');
			expect(manager.rawConfig.advancedFeature.settings.debug).toBe(true);
		});
	});

	describe('rawConfig getter', () => {
		it('should return the raw config object', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'token', country: 'US', language: 'en-US', refreshToken: 'token', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.rawConfig).toBe(config);
		});
	});

	describe('debug getter', () => {
		it('should return debug setting from advancedFeature', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
					settings: {
						debug: true,
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
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.debug).toBe(true);
		});
	});

	describe('isClearStorageOnStartupEnabled getter', () => {
		it('should return clearStorageOnStartup setting', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: true,
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
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.isClearStorageOnStartupEnabled).toBe(true);
		});
	});

	describe('isForceAuthenticationEnabled getter', () => {
		it('should return forceAuthentication setting', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: true,
						unregisterOnShutdown: false,
						overrideMatterConfiguration: false,
						matterOverrideSettings: {
							matterVendorName: 'Matterbridge',
							matterVendorId: 0xfff1,
							matterProductName: 'LG Air Conditioner',
							matterProductId: 0x8000,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.isForceAuthenticationEnabled).toBe(true);
		});
	});

	describe('unregisterOnShutdown getter', () => {
		it('should return unregisterOnShutdown setting', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: false,
						unregisterOnShutdown: true,
						overrideMatterConfiguration: false,
						matterOverrideSettings: {
							matterVendorName: 'Matterbridge',
							matterVendorId: 0xfff1,
							matterProductName: 'LG Air Conditioner',
							matterProductId: 0x8000,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.unregisterOnShutdown).toBe(true);
		});
	});

	describe('thinqLoginType getter', () => {
		it('should return loginType from thinq config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'token', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.thinqLoginType).toBe('token');
		});
	});

	describe('thinqUsername getter', () => {
		it('should return username from thinq config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', username: 'test@example.com', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.thinqUsername).toBe('test@example.com');
		});
	});

	describe('thinqPassword getter', () => {
		it('should return password from thinq config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', password: 'secret', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.thinqPassword).toBe('secret');
		});
	});

	describe('thinqRefreshToken getter', () => {
		it('should return refreshToken from thinq config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'token', refreshToken: 'refresh-token', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.thinqRefreshToken).toBe('refresh-token');
		});
	});

	describe('country getter', () => {
		it('should return country from thinq config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'KR', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.country).toBe('KR');
		});
	});

	describe('language getter', () => {
		it('should return language from thinq config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'US', language: 'ko-KR', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.language).toBe('ko-KR');
		});
	});

	describe('thinqRefreshIntervalSeconds getter', () => {
		it('should return configured refresh interval when set', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'US', language: 'en-US', refreshIntervalSeconds: 10, devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.thinqRefreshIntervalSeconds).toBe(10);
		});

		it('should return default refresh interval when not configured', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.thinqRefreshIntervalSeconds).toBe(60);
		});
	});

	describe('validateConfig', () => {
		it('should return true when loginType is token and refreshToken is set', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'token', refreshToken: 'token', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.validateConfig()).toBe(true);
		});

		it('should return false when loginType is token and refreshToken is not set', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'token', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.validateConfig()).toBe(false);
		});

		it('should return true when loginType is account and both username and password are set', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					username: 'test@example.com',
					password: 'secret',
					country: 'US',
					language: 'en-US',
					devices: [],
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.validateConfig()).toBe(true);
		});

		it('should return false when loginType is account and username is missing', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', password: 'secret', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.validateConfig()).toBe(false);
		});

		it('should return false when loginType is account and password is missing', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', username: 'test@example.com', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.validateConfig()).toBe(false);
		});
	});

	describe('getDeviceCapabilities', () => {
		it('should delegate to resolveAirConditionerCapabilities', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [
						{
							deviceId: 'device-1',
							capabilities: { supportsHeat: false, supportsFanSpeedControl: true },
						},
					],
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			const capabilities = manager.getDeviceCapabilities('device-1');
			expect(capabilities.supportsHeat).toBe(false);
			expect(capabilities.supportsFanSpeedControl).toBe(true);
		});

		it('should return defaults for device not in config', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			const capabilities = manager.getDeviceCapabilities('unknown-device');
			expect(capabilities.supportsHeat).toBe(true);
			expect(capabilities.supportsFanSpeedControl).toBe(true);
		});
	});

	describe('getSceneButtons', () => {
		it('should return scene buttons when device found with sceneButtons configured', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [
						{
							deviceId: 'device-1',
							sceneButtons: [
								{ name: 'PowerOff', opMode: 0 },
								{ name: 'Cool26', opMode: 1 },
							],
						},
					],
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			const buttons = manager.getSceneButtons('device-1');
			expect(buttons).toHaveLength(2);
			expect(buttons[0]).toEqual({ name: 'PowerOff', opMode: 0 });
			expect(buttons[1]).toEqual({ name: 'Cool26', opMode: 1 });
		});

		it('should return empty array when device found without sceneButtons key', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [
						{
							deviceId: 'device-1',
						},
					],
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			const buttons = manager.getSceneButtons('device-1');
			expect(buttons).toEqual([]);
		});

		it('should return empty array when device not found', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'US', language: 'en-US', devices: [] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			const buttons = manager.getSceneButtons('unknown-device');
			expect(buttons).toEqual([]);
		});

		it('should return empty array when devices array is undefined', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: { loginType: 'account', country: 'US', language: 'en-US', devices: undefined as unknown as any[] },
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			const buttons = manager.getSceneButtons('device-1');
			expect(buttons).toEqual([]);
		});
	});

	describe('overrideMatterConfiguration getter', () => {
		it('should return true when configured', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: false,
						unregisterOnShutdown: false,
						overrideMatterConfiguration: true,
						matterOverrideSettings: {
							matterVendorName: 'LG',
							matterVendorId: 0x1234,
							matterProductName: 'Custom AC',
							matterProductId: 0x5678,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.overrideMatterConfiguration).toBe(true);
		});

		it('should return false when configured', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
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
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.overrideMatterConfiguration).toBe(false);
		});
	});

	describe('matterOverrideSettings getter', () => {
		it('should return configured settings verbatim', () => {
			const customSettings = {
				matterVendorName: 'Custom Vendor',
				matterVendorId: 0xabcd,
				matterProductName: 'Premium AC',
				matterProductId: 0xef01,
			};
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: false,
						unregisterOnShutdown: false,
						overrideMatterConfiguration: true,
						matterOverrideSettings: customSettings,
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.matterOverrideSettings).toEqual(customSettings);
		});

		it('should return default settings when not explicitly configured', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.matterOverrideSettings).toEqual({
				matterVendorName: 'Matterbridge',
				matterVendorId: 0xfff1,
				matterProductName: 'LG Air Conditioner',
				matterProductId: 0x8000,
			});
		});
	});

	describe('getProductNameForDevice', () => {
		it('should return undefined when overrideMatterConfiguration is false', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [
						{
							deviceId: 'device-1',
							productName: 'Custom AC',
						},
					],
				},
				advancedFeature: {
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
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.getProductNameForDevice('device-1')).toBeUndefined();
		});

		it('should return undefined when device not found', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [],
				},
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: false,
						unregisterOnShutdown: false,
						overrideMatterConfiguration: true,
						matterOverrideSettings: {
							matterVendorName: 'Matterbridge',
							matterVendorId: 0xfff1,
							matterProductName: 'LG Air Conditioner',
							matterProductId: 0x8000,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.getProductNameForDevice('unknown-device')).toBeUndefined();
		});

		it('should return undefined when device found but productName is unset', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [
						{
							deviceId: 'device-1',
						},
					],
				},
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: false,
						unregisterOnShutdown: false,
						overrideMatterConfiguration: true,
						matterOverrideSettings: {
							matterVendorName: 'Matterbridge',
							matterVendorId: 0xfff1,
							matterProductName: 'LG Air Conditioner',
							matterProductId: 0x8000,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.getProductNameForDevice('device-1')).toBeUndefined();
		});

		it('should return product name when device found with productName set and override enabled', () => {
			const config = asPartial<LgThinkqPluginPlatformConfig>({
				thinq: {
					loginType: 'account',
					country: 'US',
					language: 'en-US',
					devices: [
						{
							deviceId: 'device-1',
							productName: 'Custom AC',
						},
					],
				},
				advancedFeature: {
					settings: {
						debug: false,
						clearStorageOnStartup: false,
						forceAuthentication: false,
						unregisterOnShutdown: false,
						overrideMatterConfiguration: true,
						matterOverrideSettings: {
							matterVendorName: 'Matterbridge',
							matterVendorId: 0xfff1,
							matterProductName: 'LG Air Conditioner',
							matterProductId: 0x8000,
						},
					},
				},
			});
			const manager = PlatformConfigManager.create(config, mockLogger);

			expect(manager.getProductNameForDevice('device-1')).toBe('Custom AC');
		});
	});
});
