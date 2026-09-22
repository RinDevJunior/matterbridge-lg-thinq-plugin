import { describe, expect, it } from 'vitest';

import { asPartial, buildThinqDeviceData } from '../../../tests/helpers/testUtils.js';
import type { ThinqDevice } from './ThinqDevice.js';
import { isAirConditionerDevice, isValidThinqDeviceId, isWasherDevice, toThinqDevice } from './ThinqDevice.js';

describe('ThinqDevice', () => {
	describe('isValidThinqDeviceId', () => {
		it('should return true for a valid UUID v4 format', () => {
			const validId = '12345678-1234-1234-1234-123456789012';
			expect(isValidThinqDeviceId(validId)).toBe(true);
		});

		it('should return true for a valid uppercase UUID v4 format', () => {
			const validId = '12345678-ABCD-ABCD-ABCD-123456789ABC';
			expect(isValidThinqDeviceId(validId)).toBe(true);
		});

		it('should return false for a malformed UUID', () => {
			expect(isValidThinqDeviceId('12345678-1234-1234-1234')).toBe(false);
		});

		it('should return false for a non-UUID string', () => {
			expect(isValidThinqDeviceId('not-a-uuid')).toBe(false);
		});

		it('should return false for non-string values', () => {
			expect(isValidThinqDeviceId(null)).toBe(false);
			expect(isValidThinqDeviceId(undefined)).toBe(false);
			expect(isValidThinqDeviceId(12345)).toBe(false);
		});

		it('should return false for an empty string', () => {
			expect(isValidThinqDeviceId('')).toBe(false);
		});
	});

	describe('isAirConditionerDevice', () => {
		it('should return true for a device with type AC', () => {
			const device = asPartial<ThinqDevice>({ type: 'AC' });
			expect(isAirConditionerDevice(device)).toBe(true);
		});

		it('should return false for a non-AC device type', () => {
			const device = asPartial<ThinqDevice>({ type: 'WASHER' });
			expect(isAirConditionerDevice(device)).toBe(false);
		});

		it('should return false for any other type string', () => {
			const device = asPartial<ThinqDevice>({ type: 'REFRIGERATOR' });
			expect(isAirConditionerDevice(device)).toBe(false);
		});
	});

	describe('isWasherDevice', () => {
		it('should return true for a device with type WASHER', () => {
			const device = asPartial<ThinqDevice>({ type: 'WASHER' });
			expect(isWasherDevice(device)).toBe(true);
		});

		it('should return false for AC device type', () => {
			const device = asPartial<ThinqDevice>({ type: 'AC' });
			expect(isWasherDevice(device)).toBe(false);
		});

		it('should return false for WASHER_NEW type (not supported in v1)', () => {
			const device = asPartial<ThinqDevice>({ type: 'WASHER_NEW' });
			expect(isWasherDevice(device)).toBe(false);
		});

		it('should return false for WASH_TOWER type (not supported in v1)', () => {
			const device = asPartial<ThinqDevice>({ type: 'WASH_TOWER' });
			expect(isWasherDevice(device)).toBe(false);
		});

		it('should return false for WASH_TOWER_2 type (not supported in v1)', () => {
			const device = asPartial<ThinqDevice>({ type: 'WASH_TOWER_2' });
			expect(isWasherDevice(device)).toBe(false);
		});

		it('should return false for any other type string', () => {
			const device = asPartial<ThinqDevice>({ type: 'REFRIGERATOR' });
			expect(isWasherDevice(device)).toBe(false);
		});
	});

	describe('toThinqDevice', () => {
		it('should map raw ThinqDeviceData to ThinqDevice with all fields', () => {
			const data = buildThinqDeviceData({
				deviceId: 'test-id',
				alias: 'Test Device',
				deviceType: 401,
				modelName: 'ModelXYZ',
				online: true,
			});

			const device = toThinqDevice(data);

			expect(device.id).toBe('test-id');
			expect(device.name).toBe('Test Device');
			expect(device.type).toBe('AC');
			expect(device.modelName).toBe('ModelXYZ');
			expect(device.online).toBe(true);
			expect(device.platformType).toBe('THINQ');
		});

		it('should use modemInfo.modelName as fallback when modelName is absent', () => {
			const data = buildThinqDeviceData({
				modelName: undefined,
				modemInfo: { modelName: 'ModemModel', appVersion: '1.0' },
			});

			const device = toThinqDevice(data);

			expect(device.modelName).toBe('ModemModel');
		});

		it('should use manufacture.manufactureModel as fallback when both modelName and modemInfo.modelName are absent', () => {
			const data = buildThinqDeviceData({
				modelName: undefined,
				modemInfo: undefined,
				manufacture: { manufactureModel: 'ManuModel' },
			});

			const device = toThinqDevice(data);

			expect(device.modelName).toBe('ManuModel');
		});

		it('should use empty string as final fallback for modelName', () => {
			const data = buildThinqDeviceData({
				modelName: undefined,
				modemInfo: undefined,
				manufacture: undefined,
			});

			const device = toThinqDevice(data);

			expect(device.modelName).toBe('');
		});

		it('should resolve deviceType to correct type string', () => {
			const testCases = [
				{ deviceType: 401, expectedType: 'AC' },
				{ deviceType: 201, expectedType: 'WASHER' },
				{ deviceType: 202, expectedType: 'DRYER' },
				{ deviceType: 204, expectedType: 'DISHWASHER' },
				{ deviceType: 301, expectedType: 'OVEN' },
				{ deviceType: 302, expectedType: 'MICROWAVE' },
				{ deviceType: 101, expectedType: 'REFRIGERATOR' },
				{ deviceType: 403, expectedType: 'DEHUMIDIFIER' },
			];

			for (const { deviceType, expectedType } of testCases) {
				const data = buildThinqDeviceData({ deviceType });
				const device = toThinqDevice(data);
				expect(device.type).toBe(expectedType);
			}
		});

		it('should fallback to string representation of unknown deviceType', () => {
			const data = buildThinqDeviceData({ deviceType: 9999 });

			const device = toThinqDevice(data);

			expect(device.type).toBe('9999');
		});

		it('should use snapshot.online as fallback when data.online is absent', () => {
			const data = buildThinqDeviceData({
				online: undefined,
				snapshot: { online: true },
			});

			const device = toThinqDevice(data);

			expect(device.online).toBe(true);
		});

		it('should use false as final fallback for online when both are absent', () => {
			const data = buildThinqDeviceData({
				online: undefined,
				snapshot: { online: undefined },
			});

			const device = toThinqDevice(data);

			expect(device.online).toBe(false);
		});

		it('should create a ThinqSnapshot from the snapshot data', () => {
			const data = buildThinqDeviceData({
				snapshot: { online: true, 'airState.operation': 1, 'airState.windStrength': 2 },
			});

			const device = toThinqDevice(data);

			expect(device.snapshot).toBeDefined();
			expect(device.snapshot.isPowerOn).toBe(true);
			expect(device.snapshot.windStrength).toBe(2);
		});

		it('should carry modelJsonUri when present', () => {
			const modelUri = 'https://example.com/model.json';
			const data = buildThinqDeviceData({
				modelJsonUri: modelUri,
			});

			const device = toThinqDevice(data);

			expect(device.modelJsonUri).toBe(modelUri);
		});

		it('should have undefined modelJsonUri when absent', () => {
			const data = buildThinqDeviceData({
				modelJsonUri: undefined,
			});

			const device = toThinqDevice(data);

			expect(device.modelJsonUri).toBeUndefined();
		});
	});
});
