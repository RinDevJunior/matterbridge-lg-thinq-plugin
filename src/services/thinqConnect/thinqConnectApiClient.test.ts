import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import { createMockLogger } from '../../tests/helpers/testUtils.js';
import { ThinqConnectApiClient } from './thinqConnectApiClient.js';

const FAKE_PAT = 'pat-secret-1234567890';
const AIC_DEVICES_URL = 'https://api-aic.lgthinq.com/devices';
const KIC_DEVICES_URL = 'https://api-kic.lgthinq.com/devices';

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

		it('should url-encode the device id when it contains a slash', async () => {
			// Arrange
			const encodedUrl = 'https://api-aic.lgthinq.com/devices/TQS%2F1/profile';
			mockAxios.onGet(encodedUrl).reply(200, { response: {} });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			await client.getDeviceProfile('TQS/1');

			// Assert
			expect(mockAxios.history.get[0].url).toBe(encodedUrl);
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

		it('should return an empty object when response is an array', async () => {
			// Arrange
			mockAxios.onGet(AIC_PROFILE_URL).reply(200, { response: [{ a: 1 }] });
			const client = new ThinqConnectApiClient(FAKE_PAT, 'US', mockLogger);

			// Act
			const result = await client.getDeviceProfile('dev-1');

			// Assert
			expect(result).toEqual({});
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
});
