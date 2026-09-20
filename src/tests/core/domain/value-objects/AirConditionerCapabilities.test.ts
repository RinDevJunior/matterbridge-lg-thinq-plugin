import { describe, expect, it } from 'vitest';

import {
	DEFAULT_AIR_CONDITIONER_CAPABILITIES,
	resolveAirConditionerCapabilities,
} from '../../../../core/domain/value-objects/AirConditionerCapabilities.js';
import type { ThinqDeviceConfigEntry } from '../../../../model/LgThinkqPluginPlatformConfig.js';

describe('AirConditionerCapabilities', () => {
	describe('DEFAULT_AIR_CONDITIONER_CAPABILITIES', () => {
		it('should have existing capabilities set to true', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsHeat).toBe(true);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsDry).toBe(true);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsFanSpeedControl).toBe(true);
		});

		it('should have new Phase A toggle capabilities set to false (opt-in)', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsJetMode).toBe(false);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsQuietMode).toBe(false);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsEnergySaveMode).toBe(false);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsAirCleanMode).toBe(false);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsLedControl).toBe(false);
		});

		it('should have Phase B swing mode capability set to false (opt-in)', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsSwingMode).toBe(false);
		});

		it('should have Phase C sensor capabilities set to false (opt-in)', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsHumiditySensor).toBe(false);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsAirQualitySensor).toBe(false);
		});

		it('should have Phase D energy monitoring capability set to false (opt-in)', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsEnergyMonitoring).toBe(false);
		});
	});

	describe('resolveAirConditionerCapabilities', () => {
		it('should return all-true default when devices array is undefined', () => {
			// Arrange & Act
			const result = resolveAirConditionerCapabilities(undefined, 'device-123');

			// Assert
			expect(result).toEqual(DEFAULT_AIR_CONDITIONER_CAPABILITIES);
		});

		it('should return all-true default when devices array is empty', () => {
			// Arrange & Act
			const result = resolveAirConditionerCapabilities([], 'device-123');

			// Assert
			expect(result).toEqual(DEFAULT_AIR_CONDITIONER_CAPABILITIES);
		});

		it('should return all-true default when device is not found in array', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-999', capabilities: { supportsHeat: false } }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual(DEFAULT_AIR_CONDITIONER_CAPABILITIES);
		});

		it('should return all-true default when device is found but has no capabilities key', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123' }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual(DEFAULT_AIR_CONDITIONER_CAPABILITIES);
		});

		it('should override supportsHeat only when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsHeat: false },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(false);
			expect(result.supportsDry).toBe(true); // default
			expect(result.supportsFanSpeedControl).toBe(true); // default
		});

		it('should override supportsDry only when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsDry: false },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(true); // default
			expect(result.supportsDry).toBe(false);
			expect(result.supportsFanSpeedControl).toBe(true); // default
		});

		it('should override supportsFanSpeedControl only when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsFanSpeedControl: false },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(true); // default
			expect(result.supportsDry).toBe(true); // default
			expect(result.supportsFanSpeedControl).toBe(false);
		});

		it('should override all three flags when all are specified as false', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: false,
						supportsDry: false,
						supportsFanSpeedControl: false,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(false);
			expect(result.supportsDry).toBe(false);
			expect(result.supportsFanSpeedControl).toBe(false);
		});

		it('should resolve correct device from multiple entries in array', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{ deviceId: 'device-001', capabilities: { supportsHeat: false } },
				{ deviceId: 'device-123', capabilities: { supportsDry: false } },
				{ deviceId: 'device-999', capabilities: { supportsFanSpeedControl: false } },
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(true); // default
			expect(result.supportsDry).toBe(false); // from device-123
			expect(result.supportsFanSpeedControl).toBe(true); // default
		});

		it('should preserve readonly properties', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsHeat: false, supportsDry: false, supportsFanSpeedControl: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(Object.getOwnPropertyDescriptor(result, 'supportsHeat')?.writable).not.toBe(false);
			// Result is not frozen, it's just a regular object with readonly interface
			expect(result).toEqual({
				supportsHeat: false,
				supportsDry: false,
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
			});
		});

		it('should handle device with capabilities object but undefined individual properties', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: undefined,
						supportsDry: true,
						supportsFanSpeedControl: undefined,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(true); // defaults to true when undefined
			expect(result.supportsDry).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true); // defaults to true when undefined
		});

		it('should handle explicit true values for all capabilities', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: true,
						supportsDry: true,
						supportsFanSpeedControl: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual(DEFAULT_AIR_CONDITIONER_CAPABILITIES);
		});

		it('should default new Phase A toggle flags to false when undefined', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123', capabilities: {} }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(false);
			expect(result.supportsQuietMode).toBe(false);
			expect(result.supportsEnergySaveMode).toBe(false);
			expect(result.supportsAirCleanMode).toBe(false);
			expect(result.supportsLedControl).toBe(false);
		});

		it('should override supportsJetMode when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsJetMode: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(true);
			expect(result.supportsQuietMode).toBe(false); // default
			expect(result.supportsEnergySaveMode).toBe(false); // default
			expect(result.supportsAirCleanMode).toBe(false); // default
			expect(result.supportsLedControl).toBe(false); // default
		});

		it('should override supportsQuietMode when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsQuietMode: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(false); // default
			expect(result.supportsQuietMode).toBe(true);
			expect(result.supportsEnergySaveMode).toBe(false); // default
			expect(result.supportsAirCleanMode).toBe(false); // default
			expect(result.supportsLedControl).toBe(false); // default
		});

		it('should override supportsEnergySaveMode when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsEnergySaveMode: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(false); // default
			expect(result.supportsQuietMode).toBe(false); // default
			expect(result.supportsEnergySaveMode).toBe(true);
			expect(result.supportsAirCleanMode).toBe(false); // default
			expect(result.supportsLedControl).toBe(false); // default
		});

		it('should override supportsAirCleanMode when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsAirCleanMode: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(false); // default
			expect(result.supportsQuietMode).toBe(false); // default
			expect(result.supportsEnergySaveMode).toBe(false); // default
			expect(result.supportsAirCleanMode).toBe(true);
			expect(result.supportsLedControl).toBe(false); // default
		});

		it('should override supportsLedControl when specified', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsLedControl: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(false); // default
			expect(result.supportsQuietMode).toBe(false); // default
			expect(result.supportsEnergySaveMode).toBe(false); // default
			expect(result.supportsAirCleanMode).toBe(false); // default
			expect(result.supportsLedControl).toBe(true);
		});

		it('should enable multiple new flags simultaneously', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsJetMode: true,
						supportsQuietMode: true,
						supportsEnergySaveMode: true,
						supportsLedControl: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsJetMode).toBe(true);
			expect(result.supportsQuietMode).toBe(true);
			expect(result.supportsEnergySaveMode).toBe(true);
			expect(result.supportsAirCleanMode).toBe(false); // not specified
			expect(result.supportsLedControl).toBe(true);
		});

		it('should preserve existing flag defaults (true) when resolving new flags', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsJetMode: true,
						supportsQuietMode: false,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			// Existing flags should still default to true
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsDry).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
			// New flags as specified
			expect(result.supportsJetMode).toBe(true);
			expect(result.supportsQuietMode).toBe(false);
		});

		it('should isolate capability flags across multiple devices', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-001',
					capabilities: { supportsJetMode: true },
				},
				{
					deviceId: 'device-002',
					capabilities: { supportsQuietMode: true },
				},
				{
					deviceId: 'device-003',
					capabilities: { supportsEnergySaveMode: true },
				},
			];

			// Act
			const result001 = resolveAirConditionerCapabilities(devices, 'device-001');
			const result002 = resolveAirConditionerCapabilities(devices, 'device-002');
			const result003 = resolveAirConditionerCapabilities(devices, 'device-003');

			// Assert
			expect(result001.supportsJetMode).toBe(true);
			expect(result001.supportsQuietMode).toBe(false);
			expect(result002.supportsJetMode).toBe(false);
			expect(result002.supportsQuietMode).toBe(true);
			expect(result003.supportsEnergySaveMode).toBe(true);
			expect(result003.supportsJetMode).toBe(false);
		});

		it('should default supportsSwingMode to false when undefined (Phase B)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123', capabilities: {} }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsSwingMode).toBe(false);
		});

		it('should override supportsSwingMode when specified as true (Phase B)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsSwingMode: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsSwingMode).toBe(true);
			// Verify other flags remain at their defaults
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
			expect(result.supportsJetMode).toBe(false);
		});

		it('should override supportsSwingMode when specified as false (Phase B)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsSwingMode: false },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsSwingMode).toBe(false);
		});

		it('should combine supportsSwingMode with other Phase B flags (Phase B)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsSwingMode: true,
						supportsJetMode: true,
						supportsQuietMode: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsSwingMode).toBe(true);
			expect(result.supportsJetMode).toBe(true);
			expect(result.supportsQuietMode).toBe(true);
		});

		it('should default supportsHumiditySensor to false when undefined (Phase C)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123', capabilities: {} }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHumiditySensor).toBe(false);
		});

		it('should override supportsHumiditySensor when specified as true (Phase C)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsHumiditySensor: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHumiditySensor).toBe(true);
			// Verify other flags remain at their defaults
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
			expect(result.supportsAirQualitySensor).toBe(false);
		});

		it('should default supportsAirQualitySensor to false when undefined (Phase C)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123', capabilities: {} }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsAirQualitySensor).toBe(false);
		});

		it('should override supportsAirQualitySensor when specified as true (Phase C)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsAirQualitySensor: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsAirQualitySensor).toBe(true);
			// Verify other flags remain at their defaults
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
			expect(result.supportsHumiditySensor).toBe(false);
		});

		it('should enable both Phase C sensor flags simultaneously', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHumiditySensor: true,
						supportsAirQualitySensor: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHumiditySensor).toBe(true);
			expect(result.supportsAirQualitySensor).toBe(true);
			// Verify existing flags still default to true
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsDry).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
		});

		it('should isolate Phase C sensor flags across multiple devices', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-001',
					capabilities: { supportsHumiditySensor: true },
				},
				{
					deviceId: 'device-002',
					capabilities: { supportsAirQualitySensor: true },
				},
				{
					deviceId: 'device-003',
					capabilities: {},
				},
			];

			// Act
			const result001 = resolveAirConditionerCapabilities(devices, 'device-001');
			const result002 = resolveAirConditionerCapabilities(devices, 'device-002');
			const result003 = resolveAirConditionerCapabilities(devices, 'device-003');

			// Assert
			expect(result001.supportsHumiditySensor).toBe(true);
			expect(result001.supportsAirQualitySensor).toBe(false);
			expect(result002.supportsHumiditySensor).toBe(false);
			expect(result002.supportsAirQualitySensor).toBe(true);
			expect(result003.supportsHumiditySensor).toBe(false);
			expect(result003.supportsAirQualitySensor).toBe(false);
		});

		it('should preserve full default object with all Phase C flags included', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: true,
						supportsDry: true,
						supportsFanSpeedControl: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual({
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
			});
		});

		it('should default supportsEnergyMonitoring to false when undefined (Phase D)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123', capabilities: {} }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsEnergyMonitoring).toBe(false);
		});

		it('should override supportsEnergyMonitoring when specified as true (Phase D)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsEnergyMonitoring: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsEnergyMonitoring).toBe(true);
			// Verify other flags remain at their defaults
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
			expect(result.supportsHumiditySensor).toBe(false);
		});

		it('should override supportsEnergyMonitoring when specified as false (Phase D)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsEnergyMonitoring: false },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsEnergyMonitoring).toBe(false);
		});

		it('should combine supportsEnergyMonitoring with other Phase D and earlier flags', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsEnergyMonitoring: true,
						supportsHumiditySensor: true,
						supportsAirQualitySensor: true,
						supportsSwingMode: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsEnergyMonitoring).toBe(true);
			expect(result.supportsHumiditySensor).toBe(true);
			expect(result.supportsAirQualitySensor).toBe(true);
			expect(result.supportsSwingMode).toBe(true);
			// Existing flags should still default to true
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
		});

		it('should isolate Phase D energy monitoring flag across multiple devices', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-001',
					capabilities: { supportsEnergyMonitoring: true },
				},
				{
					deviceId: 'device-002',
					capabilities: { supportsEnergyMonitoring: false },
				},
				{
					deviceId: 'device-003',
					capabilities: {},
				},
			];

			// Act
			const result001 = resolveAirConditionerCapabilities(devices, 'device-001');
			const result002 = resolveAirConditionerCapabilities(devices, 'device-002');
			const result003 = resolveAirConditionerCapabilities(devices, 'device-003');

			// Assert
			expect(result001.supportsEnergyMonitoring).toBe(true);
			expect(result002.supportsEnergyMonitoring).toBe(false);
			expect(result003.supportsEnergyMonitoring).toBe(false);
		});

		it('should preserve full default object with all Phase D flags included', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: true,
						supportsDry: true,
						supportsFanSpeedControl: true,
						supportsEnergyMonitoring: false,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual({
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
			});
		});
	});
});
