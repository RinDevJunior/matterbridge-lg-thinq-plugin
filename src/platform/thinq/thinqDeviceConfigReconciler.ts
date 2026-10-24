import { isAirConditionerDevice, isWasherDevice, type ThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqDeviceConfigEntry } from '../../model/LgThinqPluginPlatformConfig.js';

/**
 * Strips the retired `washerControl.allowRemoteStart` / `allowRemoteStop` keys from existing entries.
 * Returns `true` iff at least one key was deleted. Never throws.
 */
export function removeLegacyWasherControlKeys(configDevices: ThinqDeviceConfigEntry[]): boolean {
	let changed = false;

	for (const entry of configDevices) {
		if (typeof entry.washerControl !== 'object' || entry.washerControl === null) {
			continue;
		}

		const washerControl = entry.washerControl as Record<string, unknown>;
		for (const legacyKey of ['allowRemoteStart', 'allowRemoteStop']) {
			if (legacyKey in washerControl && Reflect.deleteProperty(washerControl, legacyKey)) {
				changed = true;
			}
		}
	}

	return changed;
}

/**
 * Reconciles the config device entries with discovered devices by auto-populating/backfilling
 * the `deviceType` field on all entries (required for schema visibility gating) and creating
 * minimal entries for newly discovered devices. Also strips retired washer remote-control keys.
 *
 * Mutates `configDevices` in place. Returns `true` iff at least one push/backfill/strip happened.
 * Never throws — defensively skips any device/entry that cannot be classified.
 */
export function reconcileThinqDeviceConfigEntries(
	configDevices: ThinqDeviceConfigEntry[],
	discoveredDevices: ThinqDevice[],
): boolean {
	let changed = removeLegacyWasherControlKeys(configDevices);

	for (const discovered of discoveredDevices) {
		// Defensively determine the device type; skip if not recognizable.
		let deviceType: 'AC' | 'WASHER' | undefined;
		if (isAirConditionerDevice(discovered)) {
			deviceType = 'AC';
		} else if (isWasherDevice(discovered)) {
			deviceType = 'WASHER';
		} else {
			continue; // Skip devices that match neither guard.
		}

		const existingEntry = configDevices.find((d) => d.deviceId === discovered.id);
		if (!existingEntry) {
			// New device: create a minimal entry with just deviceId and deviceType.
			configDevices.push({ deviceId: discovered.id, deviceType });
			changed = true;
		} else if (existingEntry.deviceType !== deviceType) {
			// Existing entry with mismatched or missing deviceType: backfill/correct it.
			existingEntry.deviceType = deviceType;
			changed = true;
		}
	}

	return changed;
}
