export interface WasherStopCommandPayload {
	readonly command?: string;
	readonly dataKey?: string;
	readonly dataValue?: unknown;
	readonly dataSetList?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function toWasherStopCommandPayload(entry: Record<string, unknown>): WasherStopCommandPayload {
	const payload: {
		command?: string;
		dataKey?: string;
		dataValue?: unknown;
		dataSetList?: Record<string, unknown>;
	} = {};

	if (typeof entry.command === 'string') {
		payload.command = entry.command;
	}
	if (typeof entry.dataKey === 'string') {
		payload.dataKey = entry.dataKey;
	}
	if ('dataValue' in entry) {
		payload.dataValue = entry.dataValue;
	}
	if (isRecord(entry.dataSetList)) {
		payload.dataSetList = entry.dataSetList;
	} else if (isRecord(entry.data)) {
		payload.dataSetList = entry.data;
	}

	return payload;
}

export type WasherPauseCommandPayload = WasherStopCommandPayload;

/**
 * Reads one `ControlWifi` entry from a device's own downloaded model JSON. Pure, no I/O — returns
 * `undefined` on any missing/malformed shape instead of throwing, so callers can treat "no usable
 * command" as a normal (fail-closed) outcome.
 */
function extractControlWifiEntry(
	deviceModel: Record<string, unknown>,
	key: 'WMStop' | 'WMOff' | 'WMWakeup' | 'ospWakeup',
): WasherStopCommandPayload | undefined {
	if (!isRecord(deviceModel)) {
		return undefined;
	}

	const controlWifi = deviceModel.ControlWifi;
	if (!isRecord(controlWifi)) {
		return undefined;
	}

	const entry = controlWifi[key];
	if (!isRecord(entry)) {
		return undefined;
	}

	return toWasherStopCommandPayload(entry);
}

/**
 * Extracts LG's `WMStop` control payload. Despite its name, LG's `WMStop` is the PAUSE control
 * (`controlDataType: 'PAUSE'`), so it backs Matter `pause`. Never falls back to `WMOff`.
 */
export function extractWasherPauseCommand(deviceModel: Record<string, unknown>): WasherPauseCommandPayload | undefined {
	return extractControlWifiEntry(deviceModel, 'WMStop');
}

/**
 * Extracts LG's `WMOff` control payload. This is the POWEROFF control (`controlDataType: 'POWEROFF'`),
 * so it backs Matter `stop`. Never falls back to `WMStop`: that would turn a pause into a power-off.
 */
export function extractWasherStopCommand(deviceModel: Record<string, unknown>): WasherStopCommandPayload | undefined {
	return extractControlWifiEntry(deviceModel, 'WMOff');
}

export type WasherWakeupCommandPayload = WasherStopCommandPayload;

/**
 * Extracts LG's `WMWakeup` control payload. CLI only; not wired into the plugin runtime.
 */
export function extractWasherWakeupCommand(
	deviceModel: Record<string, unknown>,
): WasherWakeupCommandPayload | undefined {
	return extractControlWifiEntry(deviceModel, 'WMWakeup');
}

/**
 * Extracts LG's `ospWakeup` control payload. CLI only; not wired into the plugin runtime.
 */
export function extractWasherOspWakeupCommand(
	deviceModel: Record<string, unknown>,
): WasherWakeupCommandPayload | undefined {
	return extractControlWifiEntry(deviceModel, 'ospWakeup');
}
