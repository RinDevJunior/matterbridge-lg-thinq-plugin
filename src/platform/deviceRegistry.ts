/**
 * Registry for managing plugin devices (ThinQ now, webOS in a later phase).
 * Provides centralized storage and lookup for registered device handles, keyed by device id.
 * Empty skeleton for Phase 0 — device shapes land alongside their family's discovery/configurator (Phase 1/3).
 */
export class DeviceRegistry {
	private readonly devices = new Map<string, unknown>();

	/**
	 * Register a device by id.
	 */
	public register(deviceId: string, device: unknown): void {
		if (!deviceId) return;
		this.devices.set(deviceId, device);
	}

	/**
	 * Unregister a device by id.
	 */
	public unregister(deviceId: string): void {
		this.devices.delete(deviceId);
	}

	/**
	 * Get a device by id.
	 */
	public getDevice(deviceId: string): unknown {
		return this.devices.get(deviceId);
	}

	/**
	 * Get all registered devices.
	 */
	public getAllDevices(): unknown[] {
		return Array.from(this.devices.values());
	}

	/**
	 * Get the number of registered devices.
	 */
	public get size(): number {
		return this.devices.size;
	}

	/**
	 * Check if there are any registered devices.
	 */
	public hasDevices(): boolean {
		return this.devices.size > 0;
	}

	/**
	 * Clear all registered devices.
	 */
	public clear(): void {
		this.devices.clear();
	}
}
