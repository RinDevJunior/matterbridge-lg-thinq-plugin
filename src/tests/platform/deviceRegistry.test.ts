import { describe, expect, it } from 'vitest';

import { DeviceRegistry } from '../../platform/deviceRegistry.js';

describe('DeviceRegistry', () => {
	describe('register', () => {
		it('should register a device and retrieve it', () => {
			const registry = new DeviceRegistry();
			const device = { id: '123', name: 'Test Device' };

			registry.register('device-1', device);
			expect(registry.getDevice('device-1')).toBe(device);
		});

		it('should not register device with empty id', () => {
			const registry = new DeviceRegistry();
			const device = { id: '123', name: 'Test Device' };

			registry.register('', device);
			expect(registry.getDevice('')).toBeUndefined();
			expect(registry.size).toBe(0);
		});

		it('should overwrite device when registering with same id', () => {
			const registry = new DeviceRegistry();
			const device1 = { id: '123', name: 'Device 1' };
			const device2 = { id: '456', name: 'Device 2' };

			registry.register('device-1', device1);
			registry.register('device-1', device2);

			expect(registry.getDevice('device-1')).toBe(device2);
			expect(registry.size).toBe(1);
		});
	});

	describe('unregister', () => {
		it('should remove a registered device', () => {
			const registry = new DeviceRegistry();
			const device = { id: '123', name: 'Test Device' };

			registry.register('device-1', device);
			expect(registry.size).toBe(1);

			registry.unregister('device-1');
			expect(registry.getDevice('device-1')).toBeUndefined();
			expect(registry.size).toBe(0);
		});

		it('should silently ignore unregistering non-existent device', () => {
			const registry = new DeviceRegistry();
			expect(() => registry.unregister('non-existent')).not.toThrow();
			expect(registry.size).toBe(0);
		});
	});

	describe('getDevice', () => {
		it('should return undefined for unregistered device', () => {
			const registry = new DeviceRegistry();
			expect(registry.getDevice('non-existent')).toBeUndefined();
		});

		it('should return registered device', () => {
			const registry = new DeviceRegistry();
			const device = { id: '123', name: 'Test Device' };

			registry.register('device-1', device);
			expect(registry.getDevice('device-1')).toBe(device);
		});
	});

	describe('getAllDevices', () => {
		it('should return empty array when no devices registered', () => {
			const registry = new DeviceRegistry();
			expect(registry.getAllDevices()).toEqual([]);
		});

		it('should return all registered devices', () => {
			const registry = new DeviceRegistry();
			const device1 = { id: '123', name: 'Device 1' };
			const device2 = { id: '456', name: 'Device 2' };
			const device3 = { id: '789', name: 'Device 3' };

			registry.register('device-1', device1);
			registry.register('device-2', device2);
			registry.register('device-3', device3);

			const allDevices = registry.getAllDevices();
			expect(allDevices).toHaveLength(3);
			expect(allDevices).toEqual(expect.arrayContaining([device1, device2, device3]));
		});
	});

	describe('size getter', () => {
		it('should return 0 when no devices registered', () => {
			const registry = new DeviceRegistry();
			expect(registry.size).toBe(0);
		});

		it('should return count after register', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });
			registry.register('device-2', { id: '456' });

			expect(registry.size).toBe(2);
		});

		it('should decrement count after unregister', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });
			registry.register('device-2', { id: '456' });

			registry.unregister('device-1');
			expect(registry.size).toBe(1);
		});

		it('should return 0 after clear', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });
			registry.register('device-2', { id: '456' });

			registry.clear();
			expect(registry.size).toBe(0);
		});
	});

	describe('hasDevices', () => {
		it('should return false when no devices registered', () => {
			const registry = new DeviceRegistry();
			expect(registry.hasDevices()).toBe(false);
		});

		it('should return true when devices are registered', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });

			expect(registry.hasDevices()).toBe(true);
		});

		it('should return false after all devices removed', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });
			registry.register('device-2', { id: '456' });

			registry.unregister('device-1');
			expect(registry.hasDevices()).toBe(true);

			registry.unregister('device-2');
			expect(registry.hasDevices()).toBe(false);
		});
	});

	describe('clear', () => {
		it('should remove all devices', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });
			registry.register('device-2', { id: '456' });
			registry.register('device-3', { id: '789' });

			expect(registry.size).toBe(3);
			registry.clear();
			expect(registry.size).toBe(0);
			expect(registry.hasDevices()).toBe(false);
		});

		it('should allow re-registering after clear', () => {
			const registry = new DeviceRegistry();
			registry.register('device-1', { id: '123' });

			registry.clear();
			expect(registry.size).toBe(0);

			registry.register('device-1', { id: '123' });
			expect(registry.size).toBe(1);
		});
	});
});
