import type { AnsiLogger } from 'matterbridge/logger';

/** Structural twin of the `thinq.devices[]` entry shape; kept local so ThinQ Connect never imports V1 config types. */
export interface ThinqConnectConfigEntry {
	deviceId: string;
	deviceType?: 'AC' | 'WASHER';
}

/** Structural subset of `ThinqConnectDevice` from the API client. */
export interface ThinqConnectDeviceRef {
	deviceId: string;
	deviceInfo?: { deviceType?: string };
}

export interface ThinqConnectConfigSyncDeps {
	listDevices: () => Promise<ThinqConnectDeviceRef[]>;
	thinqConfig: { devices?: ThinqConnectConfigEntry[] };
	saveConfig: () => void;
	logger: AnsiLogger;
}

const DEVICE_TYPE_BY_CONNECT_TYPE = new Map<string, 'AC' | 'WASHER'>([
	['DEVICE_AIR_CONDITIONER', 'AC'],
	['DEVICE_WASHER', 'WASHER'],
]);

/**
 * Creates `{ deviceId, deviceType }` entries for unknown ThinQ Connect washers/air conditioners and backfills
 * a missing or wrong `deviceType`. Never touches `ignore`, `productName`, `productId` and never deletes.
 * Mutates `configDevices` in place. Returns `true` iff at least one push or backfill happened. Never throws.
 */
export function reconcileThinqConnectDeviceConfigEntries(
	configDevices: ThinqConnectConfigEntry[],
	devices: ThinqConnectDeviceRef[],
): boolean {
	let changed = false;

	for (const device of devices) {
		const deviceType = DEVICE_TYPE_BY_CONNECT_TYPE.get(device.deviceInfo?.deviceType ?? '');
		if (!device.deviceId || deviceType === undefined) {
			continue;
		}

		const existingEntry = configDevices.find((entry) => entry.deviceId === device.deviceId);
		if (!existingEntry) {
			configDevices.push({ deviceId: device.deviceId, deviceType });
			changed = true;
		} else if (existingEntry.deviceType !== deviceType) {
			existingEntry.deviceType = deviceType;
			changed = true;
		}
	}

	return changed;
}

/**
 * Discovers ThinQ Connect devices and reconciles `thinq.devices[]` before registration, so per-device settings
 * (`ignore`, product overrides) become editable in the settings UI. Never rethrows: a failure only skips the sync.
 */
export async function syncThinqConnectDeviceConfigEntries(deps: ThinqConnectConfigSyncDeps): Promise<void> {
	const { listDevices, thinqConfig, saveConfig, logger } = deps;
	thinqConfig.devices ??= [];

	try {
		const devices = await listDevices();
		const countBefore = thinqConfig.devices.length;
		const changed = reconcileThinqConnectDeviceConfigEntries(thinqConfig.devices, devices);
		if (!changed) {
			return;
		}

		logger.info(`ThinQ Connect: created ${thinqConfig.devices.length - countBefore} device config entr(y/ies).`);
		try {
			saveConfig();
		} catch (error) {
			logger.error(
				`Failed to persist auto-populated ThinQ Connect device config: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} catch (error) {
		logger.warn(`ThinQ Connect: device config sync skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}
