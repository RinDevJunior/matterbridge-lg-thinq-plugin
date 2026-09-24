import { describe, expect, it } from 'vitest';

import type { ThinqAirConditionerDevice, ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import type { ThinqDeviceConfigEntry } from '../../../model/LgThinkqPluginPlatformConfig.js';
import { reconcileThinqDeviceConfigEntries } from '../../../platform/thinq/thinqDeviceConfigReconciler.js';
import { asPartial } from '../../helpers/testUtils.js';

describe('reconcileThinqDeviceConfigEntries', () => {
	describe('empty configDevices with discovered AC device', () => {
		it('should push new AC entry and return true', () => {
			// Arrange
			const configDevices: ThinqDeviceConfigEntry[] = [];
			const discovered = asPartial<ThinqAirConditionerDevice>({
				id: 'ac-001',
				type: 'AC',
			});

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, [discovered]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toHaveLength(1);
			expect(configDevices[0]).toEqual({
				deviceId: 'ac-001',
				deviceType: 'AC',
			});
		});
	});

	describe('empty configDevices with discovered washer device', () => {
		it('should push new washer entry and return true', () => {
			// Arrange
			const configDevices: ThinqDeviceConfigEntry[] = [];
			const discovered = asPartial<ThinqWasherDevice>({
				id: 'washer-001',
				type: 'WASHER',
			});

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, [discovered]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toHaveLength(1);
			expect(configDevices[0]).toEqual({
				deviceId: 'washer-001',
				deviceType: 'WASHER',
			});
		});
	});

	describe('existing entry with correct deviceType', () => {
		it('should not mutate the entry and return false', () => {
			// Arrange
			const existing: ThinqDeviceConfigEntry = {
				deviceId: 'ac-001',
				deviceType: 'AC',
				capabilities: {
					supportsHeat: true,
					supportsFanSpeedControl: false,
				},
				productName: 'Custom AC',
			};
			const configDevices = [existing];
			const originalReference = configDevices[0];
			const discovered = asPartial<ThinqAirConditionerDevice>({
				id: 'ac-001',
				type: 'AC',
			});

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, [discovered]);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices[0]).toBe(originalReference);
			expect(configDevices[0]).toEqual(existing);
			expect(configDevices[0].capabilities).toEqual({
				supportsHeat: true,
				supportsFanSpeedControl: false,
			});
		});
	});

	describe('existing entry with missing or stale deviceType', () => {
		it('should backfill missing deviceType and return true', () => {
			// Arrange
			const existing: ThinqDeviceConfigEntry = {
				deviceId: 'ac-001',
				capabilities: {
					supportsHeat: true,
				},
			};
			const configDevices = [existing];
			const discovered = asPartial<ThinqAirConditionerDevice>({
				id: 'ac-001',
				type: 'AC',
			});

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, [discovered]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices[0].deviceType).toBe('AC');
			expect(configDevices[0].capabilities).toEqual({
				supportsHeat: true,
			});
		});

		it('should correct stale deviceType and return true', () => {
			// Arrange
			const existing: ThinqDeviceConfigEntry = {
				deviceId: 'device-001',
				deviceType: 'WASHER',
				productName: 'Old Value',
			};
			const configDevices = [existing];
			const discovered = asPartial<ThinqAirConditionerDevice>({
				id: 'device-001',
				type: 'AC',
			});

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, [discovered]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices[0].deviceType).toBe('AC');
			expect(configDevices[0].productName).toBe('Old Value');
		});
	});

	describe('mixed input: existing correct + new device', () => {
		it('should add new device without touching existing entry', () => {
			// Arrange
			const existing: ThinqDeviceConfigEntry = {
				deviceId: 'ac-001',
				deviceType: 'AC',
				capabilities: { supportsHeat: true },
			};
			const configDevices = [existing];
			const existingReference = configDevices[0];
			const discovered = [
				asPartial<ThinqAirConditionerDevice>({
					id: 'ac-001',
					type: 'AC',
				}),
				asPartial<ThinqWasherDevice>({
					id: 'washer-001',
					type: 'WASHER',
				}),
			];

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, discovered);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toHaveLength(2);
			expect(configDevices[0]).toBe(existingReference);
			expect(configDevices[0].capabilities).toEqual({ supportsHeat: true });
			expect(configDevices[1]).toEqual({
				deviceId: 'washer-001',
				deviceType: 'WASHER',
			});
		});
	});

	describe('discovered device that is neither AC nor washer', () => {
		it('should skip unrecognized device type silently', () => {
			// Arrange
			const configDevices: ThinqDeviceConfigEntry[] = [];
			const discovered = asPartial<{ id: string; type: string }>({
				id: 'dryer-001',
				type: 'DRYER',
			});

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, [discovered as any]);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toHaveLength(0);
		});
	});

	describe('multiple discovered devices, only some new', () => {
		it('should add only new devices and skip existing ones', () => {
			// Arrange
			const existing: ThinqDeviceConfigEntry = {
				deviceId: 'ac-001',
				deviceType: 'AC',
			};
			const configDevices = [existing];
			const discovered = [
				asPartial<ThinqAirConditionerDevice>({
					id: 'ac-001',
					type: 'AC',
				}),
				asPartial<ThinqWasherDevice>({
					id: 'washer-001',
					type: 'WASHER',
				}),
				asPartial<ThinqWasherDevice>({
					id: 'washer-002',
					type: 'WASHER',
				}),
			];

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, discovered);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toHaveLength(3);
			expect(configDevices[0].deviceId).toBe('ac-001');
			expect(configDevices[1].deviceId).toBe('washer-001');
			expect(configDevices[2].deviceId).toBe('washer-002');
		});
	});

	describe('empty discovered devices list', () => {
		it('should not modify configDevices and return false', () => {
			// Arrange
			const existing: ThinqDeviceConfigEntry = {
				deviceId: 'ac-001',
				deviceType: 'AC',
			};
			const configDevices = [existing];

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, []);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toHaveLength(1);
			expect(configDevices[0]).toEqual(existing);
		});
	});

	describe('no changes needed', () => {
		it('should return false when all devices already have correct types', () => {
			// Arrange
			const configDevices: ThinqDeviceConfigEntry[] = [
				{ deviceId: 'ac-001', deviceType: 'AC' },
				{ deviceId: 'washer-001', deviceType: 'WASHER' },
			];
			const discovered = [
				asPartial<ThinqAirConditionerDevice>({
					id: 'ac-001',
					type: 'AC',
				}),
				asPartial<ThinqWasherDevice>({
					id: 'washer-001',
					type: 'WASHER',
				}),
			];

			// Act
			const changed = reconcileThinqDeviceConfigEntries(configDevices, discovered);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toHaveLength(2);
		});
	});
});
