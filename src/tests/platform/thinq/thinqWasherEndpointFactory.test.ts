import { LaundryWasher } from 'matterbridge/devices';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import {
	buildWasherEndpoint,
	WASHER_REMOTE_START_STOP_SWITCH_ID,
} from '../../../platform/thinq/thinqWasherEndpointFactory.js';
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

describe('thinqWasherEndpointFactory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

		it('should call addChildDeviceType with correct parameters', () => {
			// Arrange
			const device = createMockWasherDevice();
			const laundryWasherMock = vi.mocked(LaundryWasher);

			// Act
			buildWasherEndpoint(device);

			// Assert
			const mockInstance = laundryWasherMock.mock.results[0]?.value;
			const addChildCall = vi.mocked(mockInstance?.addChildDeviceType).mock.calls[0];

			// Verify addChildDeviceType was called with correct switch ID
			expect(mockInstance?.addChildDeviceType).toHaveBeenCalledWith(
				WASHER_REMOTE_START_STOP_SWITCH_ID,
				expect.any(Array),
			);

			// Verify the device-type array contains onOffPlugInUnit (by checking it's an array with at least one element)
			expect(addChildCall?.[1]).toEqual(expect.any(Array));
			expect((addChildCall?.[1] as any[]).length).toBeGreaterThan(0);

			// Verify the returned child mock's cluster server methods were called
			const childMock = vi.mocked(mockInstance?.addChildDeviceType).mock.results[0]?.value;
			expect(childMock?.createDefaultIdentifyClusterServer).toHaveBeenCalled();
			expect(childMock?.createDefaultOnOffClusterServer).toHaveBeenCalledWith(false);
			expect(childMock?.addRequiredClusterServers).toHaveBeenCalled();
		});
	});
});
