import { ThinqConnectApiError } from '../../errors/index.js';

export const THINQ_CONNECT_EVENT_EXPIRE_HOURS = 24;
export const THINQ_CONNECT_EVENT_RENEW_BEFORE_MS = 12 * 3_600_000;
export const THINQ_CONNECT_EVENT_MAINTENANCE_MS = 3_600_000;
export const THINQ_CONNECT_EVENT_LIMIT_RETRY_MS = 6 * 3_600_000;
export const THINQ_CONNECT_EVENT_DEBOUNCE_MS = 1000;
export const THINQ_CONNECT_PUSH_RECOVERY_MS = 10 * 60_000;
export const THINQ_CONNECT_PUSH_STABLE_MS = 60_000;
export const THINQ_CONNECT_PUSH_BACKOFF_BASE_MS = 30_000;
export const THINQ_CONNECT_PUSH_BACKOFF_MAX_MS = 900_000;
export const THINQ_CONNECT_PUSH_RATE_LIMIT_FLOOR_MS = 300_000;
export const THINQ_CONNECT_PUSH_UNSUBSCRIBE_TIMEOUT_MS = 5000;

const JITTER_RATIO = 0.2;
const MAX_BACKOFF_EXPONENT = 20;

export type ThinqConnectPushErrorKind =
	'permanent' | 'rate-limit' | 'subscription-limit' | 'device-unsupported' | 'transient';

const PERMANENT_CODES: ReadonlySet<string> = new Set(['1103', '1218', '1202', '1209', '1305', '1308', '1307']);
const DEVICE_UNSUPPORTED_CODES: ReadonlySet<string> = new Set(['1205', '1210', '1211', '1212', '1214', '1220', '1221']);

export function classifyThinqConnectPushError(error: unknown): ThinqConnectPushErrorKind {
	if (!(error instanceof ThinqConnectApiError)) {
		return 'transient';
	}
	const code = error.metadata?.['resultCode'];
	if (typeof code !== 'string') {
		return 'transient';
	}
	if (code === '1312') {
		return 'subscription-limit';
	}
	if (code === '1306') {
		return 'rate-limit';
	}
	if (PERMANENT_CODES.has(code)) {
		return 'permanent';
	}
	return DEVICE_UNSUPPORTED_CODES.has(code) ? 'device-unsupported' : 'transient';
}

/** `min(900 s, 30 s * 2^attempt)` with +-20 % jitter; rate-limit errors never go below 300 s. */
export function computeThinqConnectPushBackoffMs(
	attempt: number,
	random: () => number,
	kind: ThinqConnectPushErrorKind = 'transient',
): number {
	const exponent = Math.min(Math.max(Math.trunc(attempt) || 0, 0), MAX_BACKOFF_EXPONENT);
	const base = Math.min(THINQ_CONNECT_PUSH_BACKOFF_MAX_MS, THINQ_CONNECT_PUSH_BACKOFF_BASE_MS * 2 ** exponent);
	const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
	const delay = Math.round(base * jitter);
	return kind === 'rate-limit' ? Math.max(delay, THINQ_CONNECT_PUSH_RATE_LIMIT_FLOOR_MS) : delay;
}

/** Extracts the bare host from `mqtts://host:8883/path`. */
export function parseThinqConnectMqttHost(mqttServer: string): string {
	const host = mqttServer
		.trim()
		.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '')
		.replace(/[/?#].*$/, '')
		.replace(/:\d*$/, '');
	if (!host) {
		throw new ThinqConnectApiError('ThinQ Connect MQTT server address is empty');
	}
	return host;
}

export interface ThinqConnectEventMessage {
	pushType: string;
	deviceId: string;
	reportKeys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads only names from an event; values (user list, report content) are never kept. */
export function parseThinqConnectEventMessage(payload: unknown): ThinqConnectEventMessage | undefined {
	if (!isRecord(payload) || !isRecord(payload['event'])) {
		return undefined;
	}
	const { pushType, deviceId, report } = payload['event'];
	if (typeof deviceId !== 'string' || !deviceId) {
		return undefined;
	}
	return {
		pushType: typeof pushType === 'string' ? pushType : 'UNKNOWN',
		deviceId,
		reportKeys: isRecord(report) ? Object.keys(report) : [],
	};
}
