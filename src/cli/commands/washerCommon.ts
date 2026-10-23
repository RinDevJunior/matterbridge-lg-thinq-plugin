import { AnsiLogger } from 'matterbridge/logger';

import { isWasherDevice, type ThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import { ThinqSession } from '../../services/thinq/session.js';
import { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import type { CliSession } from '../types.js';
import { maskSecret } from '../utils.js';

export const WASHER_ABSENT = '(absent)';

export const WASHER_TRACKED_KEYS: readonly string[] = [
	'state',
	'preState',
	'wifiSDS',
	'remoteStart',
	'ctrCmdAvail',
	'ospStandBy',
	'doorLock',
	'doorClose',
	'childLock',
	'error',
	'course',
	'downloadCourse',
	'baseDownloadCourseData',
	'spin',
	'temp',
	'rinse',
	'soilWash',
	'loadLevel',
	'initialTimeMinute',
	'remainTimeMinute',
];

export type WasherFields = Record<string, string>;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Snapshot of the tracked `washerDryer.*` fields (plus any `*remote*` key), each as JSON or `(absent)`. */
export function readWasherFields(device: ThinqDevice): WasherFields {
	const washer = device.snapshot.raw.washerDryer;
	const record: Record<string, unknown> = isRecord(washer) ? washer : {};

	const keys = new Set<string>(WASHER_TRACKED_KEYS);
	for (const key of Object.keys(record)) {
		if (/remote/i.test(key)) {
			keys.add(key);
		}
	}

	const fields: WasherFields = {};
	for (const key of [...keys].sort()) {
		fields[key] = record[key] === undefined ? WASHER_ABSENT : JSON.stringify(record[key]);
	}
	fields.online = JSON.stringify(device.online);
	return fields;
}

/** Reads one field back as its parsed value; `undefined` when absent or unreadable. */
export function parseWasherField(fields: WasherFields, key: string): unknown {
	const raw = fields[key];
	if (raw === undefined || raw === WASHER_ABSENT) {
		return undefined;
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}

export function formatWasherFieldLines(fields: WasherFields): string[] {
	return Object.entries(fields).map(([key, value]) => `washerDryer.${key} = ${value}`);
}

export function diffWasherFields(before: WasherFields, after: WasherFields): string[] {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	const lines: string[] = [];
	for (const key of [...keys].sort()) {
		const previous = before[key] ?? WASHER_ABSENT;
		const next = after[key] ?? WASHER_ABSENT;
		if (previous !== next) {
			lines.push(`${key}: ${previous} -> ${next}`);
		}
	}
	return lines.length === 0 ? ['No tracked field changed.'] : lines;
}

/** Sorted union of the keys whose value differs between two snapshots (missing counts as `WASHER_ABSENT`). */
export function changedWasherFieldKeys(before: WasherFields, after: WasherFields): string[] {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...keys].sort().filter((key) => (before[key] ?? WASHER_ABSENT) !== (after[key] ?? WASHER_ABSENT));
}

/** Device UUID's last 12 hex digits are the MAC address, so only the last 4 characters are ever printed. */
export function maskDeviceId(id: string): string {
	return maskSecret(id, 4);
}

const RESULT_CODE_TEXT: Readonly<Record<string, string>> = {
	'0000': 'OK: LG accepted and processed the request.',
	'0101': 'Rejected by LG: device or request not recognised.',
	'0102': 'Rejected by LG: ThinQ access token expired or invalid.',
	'0103': 'Rejected by LG: control not allowed for this device.',
	'0106': 'Rejected by LG: device not reachable from the cloud.',
	'0110': 'Rejected by LG: command not allowed in the current washer state.',
	'0111':
		'RESPONSE_DELAY_DEVICE: LG accepted the request but the washer did not answer in time. This alone does not prove the body is wrong.',
	'0112': 'Rejected by LG: device did not respond.',
	'0114': 'Rejected by LG: parameter value not accepted.',
	'0115': 'Rejected by LG: command not supported by this model.',
	'9006': 'Rejected by LG: session or access denied.',
};

export function describeThinqResultCode(code: string): string {
	return RESULT_CODE_TEXT[code] ?? 'Unknown LG result code';
}

export interface WasherSendFailure {
	readonly status: string;
	readonly resultCode?: string;
	readonly lines: string[];
}

/**
 * Describes a failed send. For an axios-like error only the HTTP status and response `data` are read
 * (never `config`, headers, request or tokens). Any other error contributes its message only.
 */
export function describeSendFailure(error: unknown): WasherSendFailure {
	if (isRecord(error) && isRecord(error.response)) {
		const response = error.response;
		const rawStatus = response.status;
		const status = typeof rawStatus === 'number' || typeof rawStatus === 'string' ? String(rawStatus) : 'unknown';
		const data = response.data;
		const resultCode = isRecord(data) && typeof data.resultCode === 'string' ? data.resultCode : undefined;
		const body =
			data === undefined || data === '' || (isRecord(data) && Object.keys(data).length === 0)
				? '(empty body)'
				: JSON.stringify(data);
		return { status, resultCode, lines: [`HTTP status: ${status}`, `Reply body: ${body}`] };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { status: 'n/a', lines: [`Error: ${message}`] };
}

export function createWasherClient(session: CliSession, logger: AnsiLogger): ThinqApiClient {
	const { userData, country, language } = session;
	const thinqSession = new ThinqSession(userData.accessToken, userData.refreshToken, userData.expiresAtEpochSeconds);
	const apiClient = new ThinqApiClient(thinqSession, country, language, logger);
	if (userData.userNumber) {
		apiClient.setUserNumber(userData.userNumber);
	}
	return apiClient;
}

export function findWasherTarget(devices: ThinqDevice[], deviceId: string | undefined): ThinqDevice | undefined {
	return deviceId === undefined ? devices.find(isWasherDevice) : devices.find((device) => device.id === deviceId);
}
