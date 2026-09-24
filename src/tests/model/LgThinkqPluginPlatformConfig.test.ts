import { describe, expect, it } from 'vitest';

import { createDefaultAdvancedFeature, createDefaultThinqConfig } from '../../model/LgThinkqPluginPlatformConfig.js';

describe('LgThinkqPluginPlatformConfig', () => {
	describe('createDefaultAdvancedFeature', () => {
		it('should return expected default values', () => {
			const result = createDefaultAdvancedFeature();
			expect(result).toEqual({
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
			});
		});

		it('should include overrideMatterConfiguration field with value false', () => {
			const result = createDefaultAdvancedFeature();
			expect(result.settings.overrideMatterConfiguration).toBe(false);
		});

		it('should include matterOverrideSettings with default vendor names only', () => {
			const result = createDefaultAdvancedFeature();
			expect(result.settings.matterOverrideSettings).toEqual({
				matterVendorName: 'Matterbridge',
				matterVendorId: 0xfff1,
			});
			expect(result.settings.matterOverrideSettings).not.toHaveProperty('matterProductName');
			expect(result.settings.matterOverrideSettings).not.toHaveProperty('matterProductId');
		});

		it('should return a fresh object on each call', () => {
			const first = createDefaultAdvancedFeature();
			const second = createDefaultAdvancedFeature();

			// Verify both are equal
			expect(first).toEqual(second);

			// Mutate the first object
			first.settings.debug = true;

			// Verify the second object is unaffected
			expect(second.settings.debug).toBe(false);
		});
	});

	describe('createDefaultThinqConfig', () => {
		it('should return expected default values', () => {
			const result = createDefaultThinqConfig();
			expect(result).toEqual({
				loginType: 'account',
				country: 'US',
				language: 'en-US',
				devices: [],
			});
		});

		it('should return a fresh object on each call', () => {
			const first = createDefaultThinqConfig();
			const second = createDefaultThinqConfig();

			// Verify both are equal
			expect(first).toEqual(second);

			// Mutate the first object
			first.loginType = 'token';
			first.devices.push({ deviceId: 'test' });

			// Verify the second object is unaffected
			expect(second.loginType).toBe('account');
			expect(second.devices).toHaveLength(0);
		});
	});
});
