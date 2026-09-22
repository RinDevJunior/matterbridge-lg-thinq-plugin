import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqDeviceService } from '../../services/thinq/thinqDeviceService.js';
import { asPartial, createMockLogger } from '../../tests/helpers/testUtils.js';
import { ThinqDeviceDiscovery } from './thinqDeviceDiscovery.js';

describe('ThinqDeviceDiscovery', () => {
	let mockDeviceService: ThinqDeviceService;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let discovery: ThinqDeviceDiscovery;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockDeviceService = asPartial<ThinqDeviceService>({
			discoverDevices: vi.fn(),
		});
		discovery = new ThinqDeviceDiscovery(mockDeviceService, mockLogger);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('discoverDevices', () => {
		it('should return empty array when no devices discovered', async () => {
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([]);

			const result = await discovery.discoverDevices();

			expect(result).toEqual([]);
		});

		it('should include AC device type', async () => {
			const acDevice = asPartial<ThinqDevice>({
				type: 'AC',
				id: 'device-ac-1',
				name: 'Air Conditioner',
				modelName: 'ModelXYZ',
				online: true,
			});
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([acDevice]);

			const result = await discovery.discoverDevices();

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe('AC');
		});

		it('should include WASHER device type (v1 support)', async () => {
			const washerDevice = asPartial<ThinqDevice>({
				type: 'WASHER',
				id: 'device-washer-1',
				name: 'Washer',
				modelName: 'VCDWL_QEUK',
				online: true,
			});
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([washerDevice]);

			const result = await discovery.discoverDevices();

			expect(result).toHaveLength(1);
			expect(result[0].type).toBe('WASHER');
		});

		it('should skip unsupported washer variants (WASHER_NEW)', async () => {
			const washerNewDevice = asPartial<ThinqDevice>({
				type: 'WASHER_NEW',
				id: 'device-washer-new-1',
				name: 'Washer New',
			});
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([washerNewDevice]);

			await discovery.discoverDevices();

			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('ThinQ device type not supported, skipping: WASHER_NEW'),
			);
		});

		it('should log device ID in skip message', async () => {
			const device = asPartial<ThinqDevice>({
				type: 'REFRIGERATOR',
				id: 'test-device-id-123',
				name: 'Fridge',
			});
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([device]);

			await discovery.discoverDevices();

			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('test-device-id-123'));
		});

		it('should filter supported and unsupported devices correctly', async () => {
			const acDevice = asPartial<ThinqDevice>({
				type: 'AC',
				id: 'device-ac-1',
				name: 'Air Conditioner',
			});
			const washerDevice = asPartial<ThinqDevice>({
				type: 'WASHER',
				id: 'device-washer-1',
				name: 'Washer',
			});
			const anotherAcDevice = asPartial<ThinqDevice>({
				type: 'AC',
				id: 'device-ac-2',
				name: 'Bedroom AC',
			});
			const dishwasherDevice = asPartial<ThinqDevice>({
				type: 'DISHWASHER',
				id: 'device-dw-1',
				name: 'Dishwasher',
			});

			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([
				acDevice,
				washerDevice,
				anotherAcDevice,
				dishwasherDevice,
			]);

			const result = await discovery.discoverDevices();

			expect(result).toHaveLength(3);
			expect(result[0].id).toBe('device-ac-1');
			expect(result[1].id).toBe('device-washer-1');
			expect(result[2].id).toBe('device-ac-2');
		});

		it('should properly narrow AC device type', async () => {
			const acDevice = asPartial<ThinqDevice>({
				type: 'AC',
				id: 'device-ac-1',
				name: 'Air Conditioner',
				modelName: 'Model123',
				online: true,
			});
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue([acDevice]);

			const result = await discovery.discoverDevices();

			expect(result).toHaveLength(1);
			const discoveredDevice = result[0];
			// The dispatch method should return the device with AC type narrowed
			expect(discoveredDevice.type).toBe('AC');
		});

		it('should propagate errors from device service', async () => {
			const error = new Error('Device discovery failed');
			vi.mocked(mockDeviceService.discoverDevices).mockRejectedValue(error);

			await expect(discovery.discoverDevices()).rejects.toThrow('Device discovery failed');
		});

		it('should skip devices with other types like DRYER, REFRIGERATOR, OVEN', async () => {
			const devices: ThinqDevice[] = [
				asPartial<ThinqDevice>({ type: 'DRYER', id: 'device-1' }),
				asPartial<ThinqDevice>({ type: 'REFRIGERATOR', id: 'device-2' }),
				asPartial<ThinqDevice>({ type: 'OVEN', id: 'device-3' }),
				asPartial<ThinqDevice>({ type: 'MICROWAVE', id: 'device-4' }),
				asPartial<ThinqDevice>({ type: 'AC', id: 'device-5' }),
			];
			vi.mocked(mockDeviceService.discoverDevices).mockResolvedValue(devices);

			const result = await discovery.discoverDevices();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('device-5');
		});
	});
});
