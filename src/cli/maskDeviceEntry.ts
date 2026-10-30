import { maskSecret } from '../utils/mask.js';

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 12;
const IDENTIFIER_KEYS = new Set([
	'serialno',
	'serialnumber',
	'serial',
	'macaddress',
	'mac',
	'wifimac',
	'btmac',
	'bssid',
]);
const SECRET_KEY_FRAGMENTS = ['token', 'password', 'secret', 'authorization', 'apikey', 'api_key'];
const SECRET_KEYS = new Set(['pat', 'personalaccesstoken']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isSecretKey = (key: string): boolean => {
	const lower = key.toLowerCase();
	return SECRET_KEYS.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
};

// Fail-closed: beyond MAX_DEPTH a non-null value is redacted rather than copied unmasked.
function maskEntry(key: string | undefined, value: unknown, showSecrets: boolean, depth: number): unknown {
	if (depth > MAX_DEPTH) {
		return value === null || value === undefined ? value : REDACTED;
	}

	if (key !== undefined && value !== null && value !== undefined && isSecretKey(key)) {
		return REDACTED;
	}

	if (
		key !== undefined &&
		IDENTIFIER_KEYS.has(key.toLowerCase()) &&
		(typeof value === 'string' || typeof value === 'number')
	) {
		return showSecrets ? value : maskSecret(String(value), 4);
	}

	if (Array.isArray(value)) {
		return value.map((item) => maskEntry(undefined, item, showSecrets, depth + 1));
	}

	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, childValue]) => [
				childKey,
				maskEntry(childKey, childValue, showSecrets, depth + 1),
			]),
		);
	}

	return value;
}

/** Returns a deep, masked copy of a raw device-list entry: serial/MAC fields masked, tokens/secrets always redacted. */
export function maskDeviceEntry(value: unknown, showSecrets: boolean): unknown {
	return maskEntry(undefined, value, showSecrets, 0);
}
