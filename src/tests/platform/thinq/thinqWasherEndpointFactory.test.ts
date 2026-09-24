import { LaundryWasher } from 'matterbridge/devices';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import { buildWasherEndpoint } from '../../../platform/thinq/thinqWasherEndpointFactory.js';
import { asPartial } from '../../helpers/testUtils.js';

vi.mock('matterbridge/devices', () => ({
	LaundryWasher: vi.fn(function (name: string, id: string) {
		return {
			name,
			id,
			createDefaultBasicInformationClusterServer: vi.fn().mockReturnThis(),
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
	});
});
