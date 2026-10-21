import { describe, expect, it } from 'vitest';

import { maskDeviceEntry, REDACTED } from '../../cli/maskDeviceEntry.js';

const SERIAL = 'ABCDEF123456AB12';
const MAC = 'AABBCCDDEEFF';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks a chain of object keys; throws if the shape is not what the test expects. */
function valueAt(root: unknown, path: string[]): unknown {
	let node: unknown = root;
	for (const key of path) {
		if (!isRecord(node)) {
			throw new Error(`expected an object before key "${key}"`);
		}
		node = node[key];
	}
	return node;
}

/** Wraps `inner` in `levels` single-key objects, using keys l1..lN (outermost first). */
function wrapLevels(inner: Record<string, unknown>, levels: number): Record<string, unknown> {
	let node: Record<string, unknown> = inner;
	for (let level = levels; level >= 1; level--) {
		node = { [`l${level}`]: node };
	}
	return node;
}

describe('maskDeviceEntry', () => {
	describe('serial and MAC masking', () => {
		it('should mask serialNo and macAddress to their last 4 characters when showSecrets is false', () => {
			// Arrange
			const entry = { serialNo: SERIAL, macAddress: MAC };

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual({ serialNo: '************AB12', macAddress: '********EEFF' });
		});

		it('should leave serialNo and macAddress unchanged when showSecrets is true', () => {
			// Arrange
			const entry = { serialNo: SERIAL, macAddress: MAC };

			// Act
			const result = maskDeviceEntry(entry, true);

			// Assert
			expect(result).toEqual({ serialNo: SERIAL, macAddress: MAC });
		});

		it('should mask a value of 4 characters or fewer entirely when showSecrets is false', () => {
			// Arrange
			const entry = { serialNo: 'AB12', macAddress: 'ABC' };

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual({ serialNo: '****', macAddress: '***' });
		});

		it('should stringify a numeric serial and mask it when showSecrets is false', () => {
			// Arrange
			const entry = { serialNo: 1234567890 };

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual({ serialNo: '******7890' });
		});

		it('should match identifier keys case-insensitively and cover serialNumber, mac and bssid', () => {
			// Arrange
			const entry = { SerialNo: SERIAL, MACADDRESS: MAC, serialNumber: SERIAL, mac: MAC, bssid: MAC };

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual({
				SerialNo: '************AB12',
				MACADDRESS: '********EEFF',
				serialNumber: '************AB12',
				mac: '********EEFF',
				bssid: '********EEFF',
			});
		});

		it('should mask identifiers inside arrays of objects and deeply nested objects', () => {
			// Arrange
			const entry = { snapshot: { nested: [{ macAddress: MAC }] } };

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(valueAt(result, ['snapshot', 'nested'])).toEqual([{ macAddress: '********EEFF' }]);
		});
	});

	describe('secret redaction', () => {
		const SECRET_ENTRY = {
			accessToken: 'fake-access-value',
			'x-emp-token': 'fake-emp-value',
			password: 'fake-password-value',
			clientSecret: 'fake-client-secret-value',
			pat: 'fake-pat-value',
			personalAccessToken: 'fake-personal-value',
			authorization: 'Bearer fake-auth-value',
		};

		it('should redact every token-like key to [REDACTED] when showSecrets is false', () => {
			// Arrange
			const entry = SECRET_ENTRY;

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual({
				accessToken: REDACTED,
				'x-emp-token': REDACTED,
				password: REDACTED,
				clientSecret: REDACTED,
				pat: REDACTED,
				personalAccessToken: REDACTED,
				authorization: REDACTED,
			});
		});

		it('should redact every token-like key to [REDACTED] when showSecrets is true', () => {
			// Arrange
			const entry = SECRET_ENTRY;

			// Act
			const result = maskDeviceEntry(entry, true);

			// Assert
			expect(result).toEqual({
				accessToken: REDACTED,
				'x-emp-token': REDACTED,
				password: REDACTED,
				clientSecret: REDACTED,
				pat: REDACTED,
				personalAccessToken: REDACTED,
				authorization: REDACTED,
			});
		});

		it('should keep a null token-like value as null when showSecrets is true', () => {
			// Arrange
			const entry = { accessToken: null };

			// Act
			const result = maskDeviceEntry(entry, true);

			// Assert
			expect(result).toEqual({ accessToken: null });
		});
	});

	describe('passthrough keys', () => {
		it('should leave deviceId, alias, modelName, manufactureModel and salesModel untouched', () => {
			// Arrange
			const entry = {
				deviceId: 'dev-1',
				alias: 'Living Room AC',
				modelName: 'RAC-1',
				manufactureModel: 'MFG-1',
				salesModel: 'SALES-1',
			};

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual(entry);
		});
	});

	describe('input handling', () => {
		it('should not mutate the input object when masking and redacting', () => {
			// Arrange
			const entry = { serialNo: SERIAL, nested: { accessToken: 'fake-access-value', macAddress: MAC } };
			const before = structuredClone(entry);

			// Act
			maskDeviceEntry(entry, false);

			// Assert
			expect(entry).toEqual(before);
		});

		it('should return primitives unchanged when the input is a string or number', () => {
			// Arrange / Act / Assert
			expect(maskDeviceEntry('plain-text', false)).toBe('plain-text');
			expect(maskDeviceEntry(42, false)).toBe(42);
		});

		it('should return null and undefined unchanged when the input is null or undefined', () => {
			// Arrange / Act / Assert
			expect(maskDeviceEntry(null, false)).toBeNull();
			expect(maskDeviceEntry(undefined, false)).toBeUndefined();
		});

		it('should return an empty object when the input is an empty object', () => {
			// Arrange
			const entry = {};

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			expect(result).toEqual({});
		});
	});

	describe('fail-closed depth limit', () => {
		it('should redact deep non-null values and keep null and undefined when nested 13 levels deep', () => {
			// Arrange
			const path = Array.from({ length: 12 }, (_, index) => `l${index + 1}`);
			const inner = {
				deepNull: null,
				deepUndefined: undefined,
				deepSecret: 'fake-deep-value',
				macAddress: MAC,
			};
			const entry = wrapLevels(inner, 12);

			// Act
			const result = maskDeviceEntry(entry, false);

			// Assert
			const deepest = valueAt(result, path);
			expect(valueAt(deepest, ['deepNull'])).toBeNull();
			expect(valueAt(deepest, ['deepUndefined'])).toBeUndefined();
			expect(valueAt(deepest, ['deepSecret'])).toBe(REDACTED);
			expect(valueAt(deepest, ['macAddress'])).toBe(REDACTED);
		});
	});
});
