import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import { asPartial, createMockLogger } from '../../tests/helpers/testUtils.js';
import { ThinqConnectApiClient, type ThinqConnectEnergyUsageQuery } from './thinqConnectApiClient.js';

const FAKE_PAT = 'pat-secret-1234567890';
const AIC_DEVICES_URL = 'https://api-aic.lgthinq.com/devices';
const KIC_DEVICES_URL = 'https://api-kic.lgthinq.com/devices';

/** Builds a PAT of the given length from allowlisted characters only. */
function buildPat(length: number): string {
	return 'Ab1._~+/=-'.repeat(Math.ceil(length / 10)).slice(0, length);
}

function captureError(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return undefined;
}

async function captureAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return undefined;
}

function collectLogCallArgs(logger: ReturnType<typeof createMockLogger>): unknown[] {
	return Object.values(logger)
		.filter((value): value is Mock => vi.isMockFunction(value))
		.flatMap((fn) => fn.mock.calls);
}

describe('ThinqConnectApiClient', () => {
	let mockAxios: MockAdapter;
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockAxios = new MockAdapter(axios as ConstructorParameters<typeof MockAdapter>[0]);
		mockLogger = createMockLogger();
	});

	afterEach(() => {
		mockAxios.reset();
		vi.clearAllMocks();
	});

	describe('getDevices', () => {
		it('should send GET to the aic host when country is US', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get).toHaveLength(1);
			expect(mockAxios.history.get[0].url).toBe(AIC_DEVICES_URL);
			expect(mockAxios.history.get[0].method).toBe('get');
		});

		it('should send GET to the kic host when country is KR', async () => {
			// Arrange
			mockAxios.onGet(KIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'KR', mockLogger);

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get[0].url).toBe(KIC_DEVICES_URL);
		});

		it('should send the expected request headers when called', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'us', mockLogger);

			// Act
			await client.getDevices();

			// Assert
			const headers = mockAxios.history.get[0].headers ?? {};
			expect(headers['Authorization']).toBe(`Bearer ${FAKE_PAT}`);
			expect(headers['x-country']).toBe('US');
			expect(headers['x-api-key']).toBe('v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3');
			expect(headers['x-service-phase']).toBe('OP');
			expect(headers['x-client-id']).toMatch(/^thinq-open-/);
			expect(headers['x-message-id']).toMatch(/^[A-Za-z0-9_-]{22}$/);
		});

		it('should generate a different x-message-id but the same x-client-id on each call', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDevices();
			await client.getDevices();

			// Assert
			const [first, second] = mockAxios.history.get;
			expect(first.headers?.['x-message-id']).not.toBe(second.headers?.['x-message-id']);
			expect(first.headers?.['x-client-id']).toBe(second.headers?.['x-client-id']);
		});

		it('should use the explicit clientId verbatim when provided', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, 'my-custom-client');

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get[0].headers?.['x-client-id']).toBe('my-custom-client');
		});

		it('should return the devices from the response body when response is present', async () => {
			// Arrange
			const devices = [{ deviceId: 'd1', deviceInfo: { deviceType: 'DEVICE_WASHER', alias: 'W' } }];
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: devices });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDevices();

			// Assert
			expect(result).toEqual(devices);
		});

		it('should return an empty array when response body has no response field', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, {});
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDevices();

			// Assert
			expect(result).toEqual([]);
		});
	});

	describe('validateToken', () => {
		it('should return device count 2 when two devices are visible', async () => {
			// Arrange
			const devices = [{ deviceId: 'd1' }, { deviceId: 'd2' }];
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: devices });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.validateToken();

			// Assert
			expect(result.deviceCount).toBe(2);
			expect(result.devices).toEqual(devices);
		});

		it('should return device count 0 when no devices are visible', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.validateToken();

			// Assert
			expect(result.deviceCount).toBe(0);
			expect(result.devices).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('should throw ThinqConnectApiError with friendly text, code and status when HTTP 401 with known code', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(401, { error: { code: '1103', message: 'x' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDevices());

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			const apiError = error as ThinqConnectApiError;
			expect(apiError.message).toContain('Personal Access Token is invalid or expired');
			expect(apiError.message).toContain('1103');
			expect(apiError.metadata).toEqual({ resultCode: '1103' });
			expect(apiError.statusCode).toBe(401);
		});

		it('should use the server message when HTTP error has an unknown code', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(400, { error: { code: '9999', message: 'boom' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDevices());

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toBe('boom (code 9999)');
			expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '9999' });
		});

		it('should report HTTP status when HTTP error has no error body', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(500);
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDevices());

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toContain('HTTP 500');
			expect((error as ThinqConnectApiError).statusCode).toBe(500);
		});

		it('should throw ThinqConnectApiError starting with "ThinQ Connect request failed" on network error', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).networkError();
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDevices());

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toMatch(/^ThinQ Connect request failed/);
		});
	});

	describe('constructor', () => {
		it('should throw ThinqConnectApiError with resultCode 1103 when PAT is empty', () => {
			// Arrange
			const pat = '';

			// Act
			const error = captureError(() => new ThinqConnectApiClient(pat, 'US', mockLogger));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1103' });
		});

		it('should throw ThinqConnectApiError when PAT is whitespace only', () => {
			// Arrange
			const pat = '   ';

			// Act
			const error = captureError(() => new ThinqConnectApiClient(pat, 'US', mockLogger));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
		});

		it('should throw ThinqConnectApiError when country is unsupported', () => {
			// Arrange
			const country = 'ZZ';

			// Act
			const error = captureError(() => new ThinqConnectApiClient(FAKE_PAT, country, mockLogger));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1307' });
		});
	});

	describe('personal access token validation', () => {
		it.each([
			['whitespace and newlines only', ' \n\t '],
			['an empty string', ''],
		])('should throw ThinqConnectApiError with the required message when PAT is %s', (_label, pat) => {
			// Act
			const error = captureError(() => new ThinqConnectApiClient(pat, 'US', mockLogger));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toBe('A ThinQ Personal Access Token is required');
			expect(mockAxios.history.get).toHaveLength(0);
		});

		it.each([
			['shorter than 20 characters', buildPat(19)],
			['longer than 512 characters', buildPat(513)],
			['containing a space', 'abcdefghij klmnopqrstuvwxyz'],
			['containing a tab', 'abcdefghij\tklmnopqrstuvwxyz'],
			['containing a newline', 'abcdefghij\nklmnopqrstuvwxyz'],
			['containing a carriage return', 'abcdefghij\rklmnopqrstuvwxyz'],
			['containing a NUL control character', 'abcdefghij\u0000klmnopqrstuvwxyz'],
			['containing a BEL control character', 'abcdefghij\u0007klmnopqrstuvwxyz'],
			['containing an exclamation mark', 'abcdefghij!klmnopqrstuvwxyz'],
			['containing an at sign', 'abcdefghij@klmnopqrstuvwxyz'],
			['containing a hash', 'abcdefghij#klmnopqrstuvwxyz'],
			['containing a percent sign', 'abcdefghij%klmnopqrstuvwxyz'],
			['containing a question mark', 'abcdefghij?klmnopqrstuvwxyz'],
			['containing a backslash', 'abcdefghij\\klmnopqrstuvwxyz'],
			['containing a non-ASCII letter', 'abcdefghijéklmnopqrstuvwxyz'],
		])('should throw ThinqConnectApiError with resultCode 1103 when PAT is %s', (_label, pat) => {
			// Act
			const error = captureError(() => new ThinqConnectApiClient(pat, 'US', mockLogger));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1103' });
			expect((error as ThinqConnectApiError).message).not.toContain(pat);
			expect(mockAxios.history.get).toHaveLength(0);
		});

		it.each([
			['20 characters (lower bound)', 20],
			['512 characters (upper bound)', 512],
		])('should send the token as Bearer auth when PAT is %s', async (_label, length) => {
			// Arrange
			const pat = buildPat(length);
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(pat, 'US', mockLogger);

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get[0].headers?.['Authorization']).toBe(`Bearer ${pat}`);
		});

		it('should accept every allowlisted character when PAT uses letters, digits and ._~+/=-', async () => {
			// Arrange
			const pat = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~+/=-';
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(pat, 'US', mockLogger);

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get[0].headers?.['Authorization']).toBe(`Bearer ${pat}`);
		});

		it('should trim leading and trailing whitespace before sending the token', async () => {
			// Arrange
			const pat = buildPat(30);
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(`  ${pat}\n`, 'US', mockLogger);

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get[0].headers?.['Authorization']).toBe(`Bearer ${pat}`);
		});
	});

	describe('country validation', () => {
		it.each(['', '   ', 'ZZ', 'US/../x', 'https://evil.example', 'US?x=1'])(
			'should throw ThinqConnectApiError with resultCode 1307 when country is "%s"',
			(country) => {
				// Act
				const error = captureError(() => new ThinqConnectApiClient(FAKE_PAT, country, mockLogger));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1307' });
				expect(mockAxios.history.get).toHaveLength(0);
			},
		);

		it.each([
			['DE', 'https://api-eic.lgthinq.com/devices'],
			['jp', 'https://api-kic.lgthinq.com/devices'],
			[' ca ', AIC_DEVICES_URL],
		])('should build the base url from the region table when country is "%s"', async (country, expectedUrl) => {
			// Arrange
			mockAxios.onGet(expectedUrl).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, country, mockLogger);

			// Act
			await client.getDevices();

			// Assert
			expect(mockAxios.history.get[0].url).toBe(expectedUrl);
		});
	});

	describe('device id validation', () => {
		const PAYLOAD = { operation: { washerOperationMode: 'START' } };
		const DEVICE_CALLS: [string, (client: ThinqConnectApiClient, deviceId: string) => Promise<unknown>][] = [
			['getDeviceProfile', (client, deviceId) => client.getDeviceProfile(deviceId)],
			['getDeviceState', (client, deviceId) => client.getDeviceState(deviceId)],
			['controlDevice', (client, deviceId) => client.controlDevice(deviceId, PAYLOAD)],
		];
		const INVALID_DEVICE_IDS = ['', 'a'.repeat(129), 'TQS/1', 'a?b', 'a#b', 'a%2Fb', '..', 'a..b', 'a b', '../other'];

		describe.each(DEVICE_CALLS)('%s', (_name, call) => {
			it.each(INVALID_DEVICE_IDS)('should reject device id "%s" with no request made', async (deviceId) => {
				// Arrange
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

				// Act
				const error = await captureAsyncError(() => call(client, deviceId));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect(mockAxios.history.get).toHaveLength(0);
				expect(mockAxios.history.post).toHaveLength(0);
			});
		});

		it('should build the profile, state and control urls when device id is valid', async () => {
			// Arrange
			const base = 'https://api-aic.lgthinq.com/devices/abc-123_DEF';
			mockAxios.onGet(`${base}/profile`).reply(200, { response: {} });
			mockAxios.onGet(`${base}/state`).reply(200, { response: {} });
			mockAxios.onPost(`${base}/control`).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceProfile('abc-123_DEF');
			await client.getDeviceState('abc-123_DEF');
			await client.controlDevice('abc-123_DEF', PAYLOAD);

			// Assert
			expect(mockAxios.history.get.map((request) => request.url)).toEqual([`${base}/profile`, `${base}/state`]);
			expect(mockAxios.history.post[0].url).toBe(`${base}/control`);
		});

		it('should accept a device id of exactly 128 characters', async () => {
			// Arrange
			const deviceId = 'a'.repeat(128);
			const url = `https://api-aic.lgthinq.com/devices/${deviceId}/state`;
			mockAxios.onGet(url).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceState(deviceId);

			// Assert
			expect(mockAxios.history.get[0].url).toBe(url);
		});
	});

	describe('secret safety', () => {
		it('should not leak the PAT into logger calls after a successful call', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(200, { response: [{ deviceId: 'd1' }] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.validateToken();

			// Assert
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
		});

		it('should not leak the PAT into logger calls or the thrown error after a failing call', async () => {
			// Arrange
			mockAxios.onGet(AIC_DEVICES_URL).reply(401, { error: { code: '1103', message: 'x' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDevices());

			// Assert
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
			expect(
				JSON.stringify({
					message: (error as ThinqConnectApiError).message,
					metadata: (error as ThinqConnectApiError).metadata,
				}),
			).not.toContain(FAKE_PAT);
		});
	});

	describe('getEnergyProfile and getEnergyUsage', () => {
		const ENERGY_BASE = 'https://api-aic.lgthinq.com/devices/energy/dev-1';
		const DAILY_QUERY: ThinqConnectEnergyUsageQuery = {
			period: 'DAILY',
			startDate: '20250901',
			endDate: '20250907',
		};

		it('should send GET to the energy profile path on the aic host when country is US', async () => {
			// Arrange
			mockAxios.onGet().reply(200, { response: { resultCode: '0000', result: { property: ['energyUsage'] } } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getEnergyProfile('dev-1');

			// Assert
			expect(mockAxios.history.get).toHaveLength(1);
			expect(mockAxios.history.get[0]?.url).toBe(`${ENERGY_BASE}/profile`);
		});

		it('should return the response object of the energy profile', async () => {
			// Arrange
			mockAxios.onGet().reply(200, { response: { resultCode: '0000', result: { property: ['energyUsage'] } } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getEnergyProfile('dev-1');

			// Assert
			expect(result).toEqual({ resultCode: '0000', result: { property: ['energyUsage'] } });
		});

		it.each([
			['missing', {}],
			['an array', { response: [1, 2] }],
			['a string', { response: 'nope' }],
		])('should return an empty object when the response is %s', async (_label, body) => {
			// Arrange
			mockAxios.onGet().reply(200, body);
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getEnergyProfile('dev-1');

			// Assert
			expect(result).toEqual({});
		});

		it('should build the usage query in the order property, period, startDate, endDate', async () => {
			// Arrange
			mockAxios.onGet().reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getEnergyUsage('dev-1', { ...DAILY_QUERY, property: 'energyUsage' });

			// Assert
			expect(mockAxios.history.get[0]?.url).toBe(
				`${ENERGY_BASE}/usage?property=energyUsage&period=DAILY&startDate=20250901&endDate=20250907`,
			);
		});

		it('should omit the property parameter when no property is given', async () => {
			// Arrange
			mockAxios.onGet().reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getEnergyUsage('dev-1', DAILY_QUERY);

			// Assert
			expect(mockAxios.history.get[0]?.url).toBe(
				`${ENERGY_BASE}/usage?period=DAILY&startDate=20250901&endDate=20250907`,
			);
		});

		it('should accept a MONTHLY query with YYYYMM dates', async () => {
			// Arrange
			mockAxios.onGet().reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getEnergyUsage('dev-1', { period: 'MONTHLY', startDate: '202501', endDate: '202503' });

			// Assert
			expect(mockAxios.history.get[0]?.url).toBe(`${ENERGY_BASE}/usage?period=MONTHLY&startDate=202501&endDate=202503`);
		});

		it.each([
			['a 31-day DAILY span', { startDate: '20250901', endDate: '20251001' }],
			['a 12-month MONTHLY span', { period: 'MONTHLY' as const, startDate: '202501', endDate: '202512' }],
		])('should accept %s', async (_label, overrides) => {
			// Arrange
			mockAxios.onGet().reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act & Assert
			await expect(client.getEnergyUsage('dev-1', { ...DAILY_QUERY, ...overrides })).resolves.toEqual({});
			expect(mockAxios.history.get).toHaveLength(1);
		});

		it.each([
			['a device id with spaces', 'dev 1', DAILY_QUERY, 'ThinQ Connect device id has an invalid format'],
			['a 129-character device id', 'a'.repeat(129), DAILY_QUERY, 'ThinQ Connect device id has an invalid format'],
			[
				'an unknown period',
				'dev-1',
				{ ...DAILY_QUERY, period: 'WEEKLY' as ThinqConnectEnergyUsageQuery['period'] },
				'energy period must be DAILY or MONTHLY',
			],
			['a DAILY date with dashes', 'dev-1', { ...DAILY_QUERY, startDate: '2025-09-01' }, 'dates must be valid'],
			[
				'a DAILY date that is not a real day',
				'dev-1',
				{ ...DAILY_QUERY, startDate: '20250230' },
				'dates must be valid',
			],
			['a DAILY date in YYYYMM form', 'dev-1', { ...DAILY_QUERY, startDate: '202509' }, 'dates must be valid'],
			[
				'a MONTHLY date in YYYYMMDD form',
				'dev-1',
				{ period: 'MONTHLY' as const, startDate: '20250901', endDate: '20250901' },
				'dates must be valid',
			],
			[
				'a MONTHLY month of 13',
				'dev-1',
				{ period: 'MONTHLY' as const, startDate: '202513', endDate: '202513' },
				'dates must be valid',
			],
			[
				'a start date after the end date',
				'dev-1',
				{ ...DAILY_QUERY, startDate: '20250907', endDate: '20250901' },
				'must not be after endDate',
			],
			['a 32-day DAILY span', 'dev-1', { ...DAILY_QUERY, startDate: '20250901', endDate: '20251002' }, '31 days'],
			[
				'a 13-month MONTHLY span',
				'dev-1',
				{ period: 'MONTHLY' as const, startDate: '202501', endDate: '202601' },
				'limited to 12 months',
			],
			[
				'a property containing an ampersand',
				'dev-1',
				{ ...DAILY_QUERY, property: 'energyUsage&x=1' },
				'energy property has an invalid format',
			],
			[
				'a property containing a space',
				'dev-1',
				{ ...DAILY_QUERY, property: 'energy usage' },
				'energy property has an invalid format',
			],
		])('should reject before any HTTP call when the request has %s', async (_label, deviceId, query, message) => {
			// Arrange
			mockAxios.onGet().reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act & Assert
			await expect(client.getEnergyUsage(deviceId, asPartial<ThinqConnectEnergyUsageQuery>(query))).rejects.toThrow(
				message,
			);
			expect(mockAxios.history.get).toHaveLength(0);
		});

		it('should throw a ThinqConnectApiError with resultCode 1221 and a not-supported message on an HTTP error', async () => {
			// Arrange
			mockAxios.onGet().reply(400, { error: { code: '1221' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act & Assert
			await expect(client.getEnergyProfile('dev-1')).rejects.toMatchObject({
				metadata: { resultCode: '1221' },
			});
			await expect(client.getEnergyProfile('dev-1')).rejects.toThrow(/not supported/);
		});

		it('should return a 200 body with resultCode 1221 unchanged without throwing', async () => {
			// Arrange
			mockAxios.onGet().reply(200, { response: { resultCode: '1221' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getEnergyUsage('dev-1', DAILY_QUERY);

			// Assert
			expect(result).toEqual({ resultCode: '1221' });
		});

		it('should never log the PAT while calling the energy endpoints', async () => {
			// Arrange
			mockAxios.onGet(new RegExp('/usage')).reply(400, { error: { code: '1221' } });
			mockAxios.onGet().reply(200, { response: { resultCode: '0000' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getEnergyProfile('dev-1');
			await client.getEnergyUsage('dev-1', DAILY_QUERY).catch(() => undefined);

			// Assert
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
		});

		it('should keep the same invalid-format message for getDeviceProfile with a bad id', async () => {
			// Arrange
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act & Assert
			await expect(client.getDeviceProfile('bad id')).rejects.toThrow('ThinQ Connect device id has an invalid format');
			expect(mockAxios.history.get).toHaveLength(0);
		});
	});

	describe('controlDevice', () => {
		const AIC_CONTROL_URL = 'https://api-aic.lgthinq.com/devices/dev-1/control';
		const START_PAYLOAD = { operation: { washerOperationMode: 'START' } };

		it('should POST the JSON body to the control url on the aic host when country is US', async () => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.controlDevice('dev-1', { operation: { washerOperationMode: 'POWER_ON' } });

			// Assert
			expect(mockAxios.history.post).toHaveLength(1);
			expect(mockAxios.history.post[0].url).toBe(AIC_CONTROL_URL);
			expect(JSON.parse(mockAxios.history.post[0].data as string)).toEqual({
				operation: { washerOperationMode: 'POWER_ON' },
			});
		});

		it('should send x-conditional-control true and the same auth headers as GET requests', async () => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.controlDevice('dev-1', START_PAYLOAD);

			// Assert
			const headers = mockAxios.history.post[0].headers ?? {};
			expect(headers['x-conditional-control']).toBe('true');
			expect(headers['Authorization']).toBe(`Bearer ${FAKE_PAT}`);
			expect(headers['x-country']).toBe('US');
			expect(headers['x-client-id']).toMatch(/^thinq-open-/);
			expect(headers['x-api-key']).toBe('v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3');
			expect(headers['x-service-phase']).toBe('OP');
			expect(headers['x-message-id']).toMatch(/^[A-Za-z0-9_-]{22}$/);
		});

		it('should throw ThinqConnectApiError and make no request when device id contains a slash', async () => {
			// Arrange
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.controlDevice('TQS/1', START_PAYLOAD));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect(mockAxios.history.post).toHaveLength(0);
		});

		it('should build the control url when device id uses allowed characters', async () => {
			// Arrange
			const controlUrl = 'https://api-aic.lgthinq.com/devices/abc-123_DEF/control';
			mockAxios.onPost(controlUrl).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.controlDevice('abc-123_DEF', START_PAYLOAD);

			// Assert
			expect(mockAxios.history.post[0].url).toBe(controlUrl);
		});

		it('should return the response object when LG replies with a response object', async () => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).reply(200, { response: { foo: 1 } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.controlDevice('dev-1', START_PAYLOAD);

			// Assert
			expect(result).toEqual({ foo: 1 });
		});

		it.each([
			['missing', {}],
			['a non-object', { response: 'ok' }],
		])('should return an empty object when the response is %s', async (_label, body) => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).reply(200, body);
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.controlDevice('dev-1', START_PAYLOAD);

			// Assert
			expect(result).toEqual({});
		});

		it('should return the array unchanged when the control response is an array', async () => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).reply(200, { response: [{ a: 1 }] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.controlDevice('dev-1', START_PAYLOAD);

			// Assert
			expect(result).toEqual([{ a: 1 }]);
			expect(Array.isArray(result)).toBe(true);
		});

		it.each([
			['2302', 'Command is not supported in the current state. (code 2302)'],
			['2209', 'Device did not answer in time. (code 2209)'],
			['2301', 'Remote control is OFF on the device. (code 2301)'],
		])(
			'should throw ThinqConnectApiError with description, code %s and status 400 when LG replies with that code',
			async (code, expectedMessage) => {
				// Arrange
				mockAxios.onPost(AIC_CONTROL_URL).reply(400, { error: { code, message: 'server text' } });
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

				// Act
				const error = await captureAsyncError(() => client.controlDevice('dev-1', START_PAYLOAD));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				const apiError = error as ThinqConnectApiError;
				expect(apiError.message).toBe(expectedMessage);
				expect(apiError.metadata).toEqual({ resultCode: code });
				expect(apiError.statusCode).toBe(400);
			},
		);

		it('should throw ThinqConnectApiError starting with "ThinQ Connect request failed" on network error', async () => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).networkError();
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.controlDevice('dev-1', START_PAYLOAD));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toMatch(/^ThinQ Connect request failed/);
		});

		it('should not leak the PAT into logger calls or the thrown error when the control request fails', async () => {
			// Arrange
			mockAxios.onPost(AIC_CONTROL_URL).reply(400, { error: { code: '2302', message: 'x' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.controlDevice('dev-1', START_PAYLOAD));

			// Assert
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
			expect(JSON.stringify({ message: (error as ThinqConnectApiError).message })).not.toContain(FAKE_PAT);
		});
	});

	describe('getDeviceProfile and getDeviceState', () => {
		const AIC_PROFILE_URL = 'https://api-aic.lgthinq.com/devices/dev-1/profile';
		const AIC_STATE_URL = 'https://api-aic.lgthinq.com/devices/dev-1/state';
		const KIC_PROFILE_URL = 'https://api-kic.lgthinq.com/devices/dev-1/profile';

		it('should send GET to the profile url on the aic host when country is US', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceProfile('dev-1');

			// Assert
			expect(mockAxios.history.get).toHaveLength(1);
			expect(mockAxios.history.get[0].url).toBe(AIC_PROFILE_URL);
		});

		it('should send GET to the state url on the aic host when country is US', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceState('dev-1');

			// Assert
			expect(mockAxios.history.get[0].url).toBe(AIC_STATE_URL);
		});

		it('should send GET to the profile url on the kic host when country is KR', async () => {
			// Arrange
			mockAxios.onGet(KIC_PROFILE_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'KR', mockLogger);

			// Act
			await client.getDeviceProfile('dev-1');

			// Assert
			expect(mockAxios.history.get[0].url).toBe(KIC_PROFILE_URL);
		});

		it('should throw ThinqConnectApiError and make no request when device id contains a slash', async () => {
			// Arrange
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDeviceProfile('TQS/1'));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect(mockAxios.history.get).toHaveLength(0);
		});

		it('should build the profile url when device id uses allowed characters', async () => {
			// Arrange
			const profileUrl = 'https://api-aic.lgthinq.com/devices/abc-123_DEF/profile';
			mockAxios.onGet(profileUrl).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceProfile('abc-123_DEF');

			// Assert
			expect(mockAxios.history.get[0].url).toBe(profileUrl);
		});

		it('should send the same auth and identity headers as getDevices when reading the state', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceState('dev-1');

			// Assert
			const headers = mockAxios.history.get[0].headers ?? {};
			expect(headers['Authorization']).toBe(`Bearer ${FAKE_PAT}`);
			expect(headers['x-country']).toBe('US');
			expect(headers['x-api-key']).toBe('v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3');
			expect(headers['x-service-phase']).toBe('OP');
			expect(headers['x-client-id']).toMatch(/^thinq-open-/);
			expect(headers['x-message-id']).toMatch(/^[A-Za-z0-9_-]{22}$/);
		});

		it('should return the response object when the body has a response object', async () => {
			// Arrange
			const response = { property: { operation: { washerOperationMode: { mode: ['w'] } } } };
			mockAxios.onGet(AIC_PROFILE_URL).reply(200, { response });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceProfile('dev-1');

			// Assert
			expect(result).toEqual(response);
		});

		it('should return an empty object when the body has no response field', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).reply(200, {});
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceState('dev-1');

			// Assert
			expect(result).toEqual({});
		});

		it('should return the array unchanged when profile response is an array', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(200, { response: [{ a: 1 }] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceProfile('dev-1');

			// Assert
			expect(result).toEqual([{ a: 1 }]);
		});

		it('should return the washer location array unchanged when state response is an array', async () => {
			// Arrange
			const washerState = [{ location: { locationName: 'MAIN' }, runState: { currentState: 'INITIAL' } }];
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: washerState });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceState('dev-1');

			// Assert
			expect(result).toEqual(washerState);
			expect(Array.isArray(result)).toBe(true);
		});

		it('should return the state object unchanged when state response is a plain object (AC)', async () => {
			// Arrange
			const acState = { airState: { operation: 1, tempState: { current: 22 } } };
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: acState });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceState('dev-1');

			// Assert
			expect(result).toEqual(acState);
			expect(Array.isArray(result)).toBe(false);
		});

		it('should return an empty array unchanged when state response is an empty array', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: [] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceState('dev-1');

			// Assert
			expect(result).toEqual([]);
		});

		it('should return an empty object when response is null', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: null });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceState('dev-1');

			// Assert
			expect(result).toEqual({});
		});

		it('should throw ThinqConnectApiError with description and code 2301 when HTTP 400 carries code 2301', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(400, { error: { code: '2301', message: 'server text' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDeviceProfile('dev-1'));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			const apiError = error as ThinqConnectApiError;
			expect(apiError.message).toBe('Remote control is OFF on the device. (code 2301)');
			expect(apiError.metadata).toEqual({ resultCode: '2301' });
			expect(apiError.statusCode).toBe(400);
		});

		it('should report HTTP status when the state request fails without an error body', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).reply(500);
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDeviceState('dev-1'));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toContain('HTTP 500');
		});

		it('should throw ThinqConnectApiError starting with "ThinQ Connect request failed" on state network error', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).networkError();
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDeviceState('dev-1'));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toMatch(/^ThinQ Connect request failed/);
		});

		it('should issue only GET requests when reading profile and state', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(200, { response: {} });
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceProfile('dev-1');
			await client.getDeviceState('dev-1');

			// Assert
			expect(mockAxios.history.get).toHaveLength(2);
			expect(mockAxios.history.post).toHaveLength(0);
			expect(mockAxios.history.put).toHaveLength(0);
			expect(mockAxios.history.delete).toHaveLength(0);
		});

		it('should not leak the PAT into logger calls after a successful profile and state read', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(200, { response: {} });
			mockAxios.onGet(AIC_STATE_URL).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceProfile('dev-1');
			await client.getDeviceState('dev-1');

			// Assert
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
		});

		it('should not leak the PAT into logger calls or the thrown error when the profile read fails with a known code', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(400, { error: { code: '2301', message: 'server text' } });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDeviceProfile('dev-1'));

			// Assert
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
			expect(
				JSON.stringify({
					message: (error as ThinqConnectApiError).message,
					metadata: (error as ThinqConnectApiError).metadata,
				}),
			).not.toContain(FAKE_PAT);
		});

		it('should not leak the PAT into the thrown error when the state request fails on the network', async () => {
			// Arrange
			mockAxios.onGet(AIC_STATE_URL).networkError();
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const error = await captureAsyncError(() => client.getDeviceState('dev-1'));

			// Assert
			expect((error as ThinqConnectApiError).message).not.toContain(FAKE_PAT);
			expect(JSON.stringify(collectLogCallArgs(mockLogger))).not.toContain(FAKE_PAT);
		});
	});
	describe('push client methods (route, client, certificate, event subscriptions)', () => {
		const ROUTE_URL = 'https://api-aic.lgthinq.com/route';
		const CLIENT_URL = 'https://api-aic.lgthinq.com/client';
		const CERT_URL = 'https://api-aic.lgthinq.com/client/certificate';
		const EVENT_BASE = 'https://api-aic.lgthinq.com/event/dev-1';
		const CLIENT_ID = 'thinq-open-11111111-2222-3333-4444-555555555555';
		const CSR_BODY = 'CSRBODY';
		const CERT_PEM = '-----BEGIN CERTIFICATE-----\nCERTDATA\n-----END CERTIFICATE-----';

		describe('getClientId', () => {
			it('should return the client id passed to the constructor when one is given', () => {
				// Arrange
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const result = client.getClientId();

				// Assert
				expect(result).toBe(CLIENT_ID);
			});

			it('should return a thinq-open prefixed id when no client id is given', () => {
				// Arrange
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

				// Act
				const result = client.getClientId();

				// Assert
				expect(result).toMatch(/^thinq-open-[0-9a-f-]{36}$/);
			});
		});

		describe('getRoute', () => {
			it('should return the mqttServer when the route response has one', async () => {
				// Arrange
				const server = 'mqtts://a3x-ats.iot.us-west-2.amazonaws.com:8883';
				mockAxios.onGet(ROUTE_URL).reply(200, { response: { mqttServer: server } });
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const result = await client.getRoute();

				// Assert
				expect(result).toEqual({ mqttServer: server });
				expect(mockAxios.history.get[0]?.url).toBe(ROUTE_URL);
			});

			it('should send the standard headers including the client id when requesting the route', async () => {
				// Arrange
				mockAxios.onGet(ROUTE_URL).reply(200, { response: { mqttServer: 'mqtts://h:8883' } });
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				await client.getRoute();

				// Assert
				const headers = mockAxios.history.get[0]?.headers;
				expect(headers?.['Authorization']).toBe(`Bearer ${FAKE_PAT}`);
				expect(headers?.['x-client-id']).toBe(CLIENT_ID);
				expect(headers?.['x-country']).toBe('US');
				expect(headers?.['x-api-key']).toEqual(expect.any(String));
			});

			it.each([
				['response is missing', {}],
				['response is an array', { response: [] }],
				['response is null', { response: null }],
				['mqttServer is missing', { response: {} }],
				['mqttServer is a number', { response: { mqttServer: 42 } }],
				['mqttServer is empty', { response: { mqttServer: '' } }],
			])('should throw ThinqConnectApiError when %s', async (_label, body) => {
				// Arrange
				mockAxios.onGet(ROUTE_URL).reply(200, body);
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.getRoute());

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect((error as ThinqConnectApiError).message).toBe('ThinQ Connect route response has no mqttServer');
			});
		});

		describe('registerClient', () => {
			it('should POST the flat client body to /client when registering', async () => {
				// Arrange
				mockAxios.onPost(CLIENT_URL).reply(200, {});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				await client.registerClient();

				// Assert
				expect(mockAxios.history.post).toHaveLength(1);
				expect(mockAxios.history.post[0]?.url).toBe(CLIENT_URL);
				expect(JSON.parse(mockAxios.history.post[0]?.data)).toEqual({
					type: 'MQTT',
					'service-code': 'SVC202',
					'device-type': '607',
					allowExist: true,
				});
			});

			it('should send the stable client id header when registering', async () => {
				// Arrange
				mockAxios.onPost(CLIENT_URL).reply(200, {});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				await client.registerClient();

				// Assert
				expect(mockAxios.history.post[0]?.headers?.['x-client-id']).toBe(CLIENT_ID);
			});
		});

		describe('requestClientCertificate', () => {
			it('should POST the csr and return the certificate and subscriptions when the response is valid', async () => {
				// Arrange
				mockAxios.onPost(CERT_URL).reply(200, {
					response: { result: { certificatePem: CERT_PEM, subscriptions: ['app/clients/x/push'] } },
				});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const result = await client.requestClientCertificate(CSR_BODY);

				// Assert
				expect(result).toEqual({ certificatePem: CERT_PEM, subscriptions: ['app/clients/x/push'] });
				expect(mockAxios.history.post[0]?.url).toBe(CERT_URL);
				expect(JSON.parse(mockAxios.history.post[0]?.data)).toEqual({ 'service-code': 'SVC202', csr: CSR_BODY });
			});

			it('should keep only non-empty string subscription entries when some are not strings', async () => {
				// Arrange
				mockAxios.onPost(CERT_URL).reply(200, {
					response: { result: { certificatePem: CERT_PEM, subscriptions: [42, 'app/clients/x/push', ''] } },
				});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const result = await client.requestClientCertificate(CSR_BODY);

				// Assert
				expect(result.subscriptions).toEqual(['app/clients/x/push']);
			});

			it.each([
				['certificatePem is missing', { result: { subscriptions: ['t'] } }],
				['certificatePem is empty', { result: { certificatePem: '', subscriptions: ['t'] } }],
				['subscriptions is missing', { result: { certificatePem: CERT_PEM } }],
				['subscriptions is empty', { result: { certificatePem: CERT_PEM, subscriptions: [] } }],
				['every subscription is non-string', { result: { certificatePem: CERT_PEM, subscriptions: [123, null] } }],
			])('should throw ThinqConnectApiError when %s', async (_label, body) => {
				// Arrange
				mockAxios.onPost(CERT_URL).reply(200, { response: body });
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.requestClientCertificate(CSR_BODY));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
			});

			it.each([
				['result is missing', {}],
				['result is not an object', { result: 'text' }],
				['response is null', { response: null }],
			])('should throw ThinqConnectApiError when %s', async (_label, body) => {
				// Arrange
				mockAxios.onPost(CERT_URL).reply(200, body);
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.requestClientCertificate(CSR_BODY));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect((error as ThinqConnectApiError).message).toBe('ThinQ Connect certificate response has no result');
			});

			it.each(['', '   '])('should throw without sending a request when csr is blank (%j)', async (csr) => {
				// Arrange
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.requestClientCertificate(csr));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect(mockAxios.history.post).toHaveLength(0);
			});

			it('should not log the PAT, CSR or certificate when requesting a certificate', async () => {
				// Arrange
				mockAxios.onPost(CERT_URL).reply(200, {
					response: { result: { certificatePem: CERT_PEM, subscriptions: ['app/clients/x/push'] } },
				});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				await client.requestClientCertificate(CSR_BODY);

				// Assert
				const logged = JSON.stringify(collectLogCallArgs(mockLogger));
				expect(logged).not.toContain(FAKE_PAT);
				expect(logged).not.toContain(CSR_BODY);
				expect(logged).not.toContain('CERTDATA');
			});
		});

		describe('subscribeDeviceEvents', () => {
			it.each([
				[undefined, 24],
				[1, 1],
				[12, 12],
				[24, 24],
			])('should POST the expire body to /event/{id}/subscribe when hours is %s', async (hours, expected) => {
				// Arrange
				mockAxios.onPost(`${EVENT_BASE}/subscribe`).reply(200, {});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				await client.subscribeDeviceEvents('dev-1', hours);

				// Assert
				expect(mockAxios.history.post[0]?.url).toBe(`${EVENT_BASE}/subscribe`);
				expect(JSON.parse(mockAxios.history.post[0]?.data)).toEqual({ expire: { unit: 'HOUR', timer: expected } });
			});

			it.each([0, 25, 1.5, -1, Number.NaN])(
				'should throw without sending a request when expiry is %s hours',
				async (hours) => {
					// Arrange
					const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

					// Act
					const error = await captureAsyncError(() => client.subscribeDeviceEvents('dev-1', hours));

					// Assert
					expect(error).toBeInstanceOf(ThinqConnectApiError);
					expect(mockAxios.history.post).toHaveLength(0);
				},
			);

			it.each(['', 'bad id!', 'dev/1', 'a'.repeat(129)])(
				'should throw without sending a request when device id is %j',
				async (deviceId) => {
					// Arrange
					const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

					// Act
					const error = await captureAsyncError(() => client.subscribeDeviceEvents(deviceId));

					// Assert
					expect(error).toBeInstanceOf(ThinqConnectApiError);
					expect(mockAxios.history.post).toHaveLength(0);
				},
			);

			it('should throw with the subscription-limit message when the API returns 1312', async () => {
				// Arrange
				mockAxios.onPost(`${EVENT_BASE}/subscribe`).reply(400, { error: { code: '1312', message: 'x' } });
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.subscribeDeviceEvents('dev-1'));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect((error as ThinqConnectApiError).message).toBe(
					'Too many device event subscriptions for this account. (code 1312)',
				);
				expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1312' });
			});
		});

		describe('unsubscribeDeviceEvents', () => {
			it('should send DELETE to /event/{id}/unsubscribe when called', async () => {
				// Arrange
				mockAxios.onDelete(`${EVENT_BASE}/unsubscribe`).reply(200, {});
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				await client.unsubscribeDeviceEvents('dev-1');

				// Assert
				expect(mockAxios.history.delete).toHaveLength(1);
				expect(mockAxios.history.delete[0]?.method).toBe('delete');
				expect(mockAxios.history.delete[0]?.url).toBe(`${EVENT_BASE}/unsubscribe`);
				expect(mockAxios.history.post).toHaveLength(0);
			});

			it('should throw with the mapped message when the API returns 1204', async () => {
				// Arrange
				mockAxios.onDelete(`${EVENT_BASE}/unsubscribe`).reply(400, { error: { code: '1204', message: 'x' } });
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.unsubscribeDeviceEvents('dev-1'));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect((error as ThinqConnectApiError).message).toBe('Device is not subscribed to events. (code 1204)');
				expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1204' });
			});

			it.each(['', 'bad id!'])('should throw without sending a request when device id is %j', async (deviceId) => {
				// Arrange
				const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger, CLIENT_ID);

				// Act
				const error = await captureAsyncError(() => client.unsubscribeDeviceEvents(deviceId));

				// Assert
				expect(error).toBeInstanceOf(ThinqConnectApiError);
				expect(mockAxios.history.delete).toHaveLength(0);
			});
		});
	});
});
