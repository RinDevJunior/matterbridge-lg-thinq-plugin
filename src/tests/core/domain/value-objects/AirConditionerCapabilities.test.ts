import { describe, expect, it } from 'vitest';

import {
	DEFAULT_AIR_CONDITIONER_CAPABILITIES,
	resolveAirConditionerCapabilities,
} from '../../../../core/domain/value-objects/AirConditionerCapabilities.js';
import type { ThinqDeviceConfigEntry } from '../../../../model/LgThinqPluginPlatformConfig.js';

describe('AirConditionerCapabilities', () => {
	describe('DEFAULT_AIR_CONDITIONER_CAPABILITIES', () => {
		it('should have existing capabilities set to true', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsHeat).toBe(true);
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsFanSpeedControl).toBe(true);
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

		it('should have filter monitoring capability set to false (opt-in)', () => {
			// Assert
			expect(DEFAULT_AIR_CONDITIONER_CAPABILITIES.supportsFilterMonitoring).toBe(false);
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
			expect(result.supportsFanSpeedControl).toBe(false);
		});

		it('should override all three flags when all are specified as false', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: false,
						supportsFanSpeedControl: false,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(false);
			expect(result.supportsFanSpeedControl).toBe(false);
		});

		it('should resolve correct device from multiple entries in array', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{ deviceId: 'device-001', capabilities: { supportsHeat: false } },
				{ deviceId: 'device-123', capabilities: { supportsSwingMode: true } },
				{ deviceId: 'device-999', capabilities: { supportsFanSpeedControl: false } },
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(true); // default
			expect(result.supportsSwingMode).toBe(true); // from device-123
			expect(result.supportsFanSpeedControl).toBe(true); // default
		});

		it('should preserve readonly properties', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsHeat: false, supportsFanSpeedControl: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(Object.getOwnPropertyDescriptor(result, 'supportsHeat')?.writable).not.toBe(false);
			// Result is not frozen, it's just a regular object with readonly interface
			expect(result).toEqual({
				supportsHeat: false,
				supportsFanSpeedControl: true,
				supportsSwingMode: false,
				supportsHumiditySensor: false,
				supportsAirQualitySensor: false,
				supportsEnergyMonitoring: false,
				supportsFilterMonitoring: false,
			});
		});

		it('should handle device with capabilities object but undefined individual properties', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: undefined,
						supportsFanSpeedControl: undefined,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsHeat).toBe(true); // defaults to true when undefined
			expect(result.supportsFanSpeedControl).toBe(true); // defaults to true when undefined
		});

		it('should handle explicit true values for all capabilities', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: true,
						supportsFanSpeedControl: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual(DEFAULT_AIR_CONDITIONER_CAPABILITIES);
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

		it('should enable supportsSwingMode with other capabilities (Phase B)', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsSwingMode: true,
						supportsHeat: true,
						supportsFanSpeedControl: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsSwingMode).toBe(true);
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
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
						supportsFanSpeedControl: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual({
				supportsHeat: true,
				supportsFanSpeedControl: true,
				supportsSwingMode: false,
				supportsHumiditySensor: false,
				supportsAirQualitySensor: false,
				supportsEnergyMonitoring: false,
				supportsFilterMonitoring: false,
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
				supportsFanSpeedControl: true,
				supportsSwingMode: false,
				supportsHumiditySensor: false,
				supportsAirQualitySensor: false,
				supportsEnergyMonitoring: false,
				supportsFilterMonitoring: false,
			});
		});

		it('should default supportsFilterMonitoring to false when undefined', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [{ deviceId: 'device-123', capabilities: {} }];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsFilterMonitoring).toBe(false);
		});

		it('should override supportsFilterMonitoring when specified as true', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsFilterMonitoring: true },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsFilterMonitoring).toBe(true);
			// Verify other flags remain at their defaults
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
			expect(result.supportsEnergyMonitoring).toBe(false);
		});

		it('should override supportsFilterMonitoring when specified as false', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: { supportsFilterMonitoring: false },
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsFilterMonitoring).toBe(false);
		});

		it('should combine supportsFilterMonitoring with other flags', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsFilterMonitoring: true,
						supportsEnergyMonitoring: true,
						supportsHumiditySensor: true,
						supportsSwingMode: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result.supportsFilterMonitoring).toBe(true);
			expect(result.supportsEnergyMonitoring).toBe(true);
			expect(result.supportsHumiditySensor).toBe(true);
			expect(result.supportsSwingMode).toBe(true);
			// Existing flags should still default to true
			expect(result.supportsHeat).toBe(true);
			expect(result.supportsFanSpeedControl).toBe(true);
		});

		it('should isolate filter monitoring flag across multiple devices', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-001',
					capabilities: { supportsFilterMonitoring: true },
				},
				{
					deviceId: 'device-002',
					capabilities: { supportsFilterMonitoring: false },
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
			expect(result001.supportsFilterMonitoring).toBe(true);
			expect(result002.supportsFilterMonitoring).toBe(false);
			expect(result003.supportsFilterMonitoring).toBe(false);
		});

		it('should preserve full default object with all flags including filter monitoring', () => {
			// Arrange
			const devices: ThinqDeviceConfigEntry[] = [
				{
					deviceId: 'device-123',
					capabilities: {
						supportsHeat: true,
						supportsFanSpeedControl: true,
						supportsFilterMonitoring: true,
					},
				},
			];

			// Act
			const result = resolveAirConditionerCapabilities(devices, 'device-123');

			// Assert
			expect(result).toEqual({
				supportsHeat: true,
				supportsFanSpeedControl: true,
				supportsSwingMode: false,
				supportsHumiditySensor: false,
				supportsAirQualitySensor: false,
				supportsEnergyMonitoring: false,
				supportsFilterMonitoring: true,
			});
		});
	});
});
