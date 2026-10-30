import { LaundryWasher } from 'matterbridge/devices';
import { LaundryWasherControls, LaundryWasherMode } from 'matterbridge/matter/clusters';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import { buildWasherEndpoint } from '../../../platform/thinq/thinqWasherEndpointFactory.js';
import type { WasherEndpointClusterOptions } from '../../../platform/thinq/thinqWasherMatterPlan.js';
import { asPartial } from '../../helpers/testUtils.js';

vi.mock('matterbridge/devices', () => ({
	LaundryWasher: vi.fn(function (name: string, id: string) {
		return {
			name,
			id,
			createDefaultBasicInformationClusterServer: vi.fn().mockReturnThis(),
			addChildDeviceType: vi.fn(function (_childId: string) {
				return {
					createDefaultIdentifyClusterServer: vi.fn().mockReturnThis(),
					createDefaultOnOffClusterServer: vi.fn().mockReturnThis(),
					addRequiredClusterServers: vi.fn().mockReturnThis(),
				};
			}),
		};
	}),
}));

function createMockWasherDevice(): ThinqWasherDevice {
	return asPartial<ThinqWasherDevice>({
		id: 'washer-123',
		name: 'Living Room Washer',
		type: 'WASHER',
		modelName: 'VCDWL_QEUK',
		platformType: 'THINQ',
		online: true,
		snapshot: new ThinqSnapshot({
			'washerDryer.state': 'RUNNING',
		}),
	});
}

/** A fixed cluster-options object, so the factory is tested on its own (no plan resolution involved). */
function createClusterOptions(): WasherEndpointClusterOptions {
	return {
		currentMode: 3,
		supportedModes: [
			{ label: 'Cold', mode: 1, modeTags: [{ value: LaundryWasherMode.ModeTag.Auto }] },
			{ label: 'Normal', mode: 3, modeTags: [{ value: LaundryWasherMode.ModeTag.Normal }] },
		],
		spinSpeeds: ['800', '1400'],
		spinSpeedCurrent: 1,
		supportedTemperatureLevels: ['Cold', '40C'],
		selectedTemperatureLevel: 1,
		numberOfRinses: LaundryWasherControls.NumberOfRinses.Normal,
		supportedRinses: [LaundryWasherControls.NumberOfRinses.Normal],
	};
}

describe('thinqWasherEndpointFactory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('real serial number on BasicInformation', () => {
		it('should pass serialNumber as the BasicInformation serial and keep device.id for the LaundryWasher id', () => {
			// Arrange
			const device = { ...createMockWasherDevice(), serialNumber: 'FAKESERIAL01' };
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			expect(laundryWasherSpy).toHaveBeenCalledWith('Living Room Washer', 'washer-123');
			const mockInstance = laundryWasherSpy.mock.results[0]?.value;
			expect(mockInstance?.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Living Room Washer',
				'FAKESERIAL01',
				0xfff1,
				'Matterbridge',
				0x8000,
				'Matterbridge Laundry Washer',
			);
		});

		it('should fall back to device.id as the BasicInformation serial when serialNumber is absent', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			const mockInstance = laundryWasherSpy.mock.results[0]?.value;
			expect(mockInstance?.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Living Room Washer',
				'washer-123',
				0xfff1,
				'Matterbridge',
				0x8000,
				'Matterbridge Laundry Washer',
			);
		});

		it('should pass serialNumber together with all four identity overrides', () => {
			// Arrange
			const device = { ...createMockWasherDevice(), serialNumber: 'FAKESERIAL01' };
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device, {
				vendorId: 4996,
				vendorName: 'LG',
				productId: 1,
				productName: 'My Washer',
			});

			// Assert
			expect(laundryWasherSpy).toHaveBeenCalledWith('Living Room Washer', 'washer-123');
			const mockInstance = laundryWasherSpy.mock.results[0]?.value;
			expect(mockInstance?.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Living Room Washer',
				'FAKESERIAL01',
				4996,
				'LG',
				1,
				'My Washer',
			);
		});
	});

	describe('buildWasherEndpoint', () => {
		it('should create a LaundryWasher endpoint with device name and id', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			expect(laundryWasherSpy).toHaveBeenCalledWith('Living Room Washer', 'washer-123');
		});

		it('should pass exact device name and id to LaundryWasher constructor', () => {
			// Arrange
			const device = asPartial<ThinqWasherDevice>({
				id: 'custom-id-xyz',
				name: 'Custom Washer Name',
				type: 'WASHER',
				modelName: 'ModelXYZ',
				platformType: 'THINQ',
				online: true,
				snapshot: new ThinqSnapshot({}),
			});
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			expect(laundryWasherSpy).toHaveBeenCalledWith('Custom Washer Name', 'custom-id-xyz');
		});

		it('should return the LaundryWasher instance', () => {
			// Arrange
			const device = createMockWasherDevice();

			// Act
			const endpoint = buildWasherEndpoint(device);

			// Assert
			expect(endpoint).toBeDefined();
			expect(endpoint).toHaveProperty('name', 'Living Room Washer');
			expect(endpoint).toHaveProperty('id', 'washer-123');
		});

		it('should not add any child endpoint when called without options', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherMock = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			const mockInstance = laundryWasherMock.mock.results[0]?.value;
			expect(mockInstance?.addChildDeviceType).not.toHaveBeenCalled();
		});

		it('should not add any child endpoint when called with all identity options', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherMock = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device, {
				vendorId: 0xfff1,
				vendorName: 'Custom Vendor',
				productId: 0x8001,
				productName: 'Custom Product',
			});

			// Assert
			const mockInstance = laundryWasherMock.mock.results[0]?.value;
			expect(mockInstance?.addChildDeviceType).not.toHaveBeenCalled();
		});
	});

	describe('buildWasherEndpoint with clusterOptions (slice 1 display)', () => {
		it('should construct LaundryWasher with exactly two arguments when no clusterOptions is passed', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			expect(laundryWasherSpy.mock.calls[0]).toHaveLength(2);
		});

		it('should pass the clusterOptions list and index fields as the third LaundryWasher argument', () => {
			// Arrange
			const device = createMockWasherDevice();
			const clusterOptions = createClusterOptions();
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device, undefined, clusterOptions);

			// Assert
			const thirdArgument = laundryWasherSpy.mock.calls[0]?.[2];
			expect(laundryWasherSpy.mock.calls[0]).toHaveLength(3);
			expect(thirdArgument).toMatchObject({
				supportedModes: clusterOptions.supportedModes,
				currentMode: 3,
				spinSpeeds: ['800', '1400'],
				spinSpeedCurrent: 1,
				supportedTemperatureLevels: ['Cold', '40C'],
				selectedTemperatureLevel: 1,
				numberOfRinses: LaundryWasherControls.NumberOfRinses.Normal,
				supportedRinses: [LaundryWasherControls.NumberOfRinses.Normal],
			});
		});

		it('should not pass id, number, tagList or mode in the third LaundryWasher argument', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device, undefined, createClusterOptions());

			// Assert
			const thirdArgument = laundryWasherSpy.mock.calls[0]?.[2];
			expect(thirdArgument).not.toHaveProperty('id');
			expect(thirdArgument).not.toHaveProperty('number');
			expect(thirdArgument).not.toHaveProperty('tagList');
			expect(thirdArgument).not.toHaveProperty('mode');
		});

		it('should keep the same identity arguments to createDefaultBasicInformationClusterServer when clusterOptions is passed', () => {
			// Arrange
			const device = { ...createMockWasherDevice(), serialNumber: 'FAKESERIAL01' };
			const laundryWasherSpy = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device, undefined, createClusterOptions());

			// Assert
			expect(laundryWasherSpy).toHaveBeenCalledWith('Living Room Washer', 'washer-123', expect.any(Object));
			const mockInstance = laundryWasherSpy.mock.results[0]?.value;
			expect(mockInstance?.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Living Room Washer',
				'FAKESERIAL01',
				0xfff1,
				'Matterbridge',
				0x8000,
				'Matterbridge Laundry Washer',
			);
		});
	});
});
