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

/**
 * Extracts a real `WMStop`/`WMOff` command payload from a device's own downloaded model JSON
 * (`ControlWifi` slice). Pure, no I/O — returns `undefined` on any missing/malformed shape instead of
 * throwing, so callers can treat "no usable command" as a normal (fail-closed) outcome.
 */
export function extractWasherStopCommand(deviceModel: Record<string, unknown>): WasherStopCommandPayload | undefined {
	if (!isRecord(deviceModel)) {
		return undefined;
	}

	const controlWifi = deviceModel.ControlWifi;
	if (!isRecord(controlWifi)) {
		return undefined;
	}

	const stopEntry = isRecord(controlWifi.WMStop) ? controlWifi.WMStop : undefined;
	const offEntry = isRecord(controlWifi.WMOff) ? controlWifi.WMOff : undefined;
	const entry = stopEntry ?? offEntry;

	if (!entry) {
		return undefined;
	}

	return toWasherStopCommandPayload(entry);
}
