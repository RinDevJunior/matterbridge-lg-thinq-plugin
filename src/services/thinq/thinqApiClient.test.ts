import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenExpiredError } from '../../errors/index.js';
import { buildGatewayResponse, buildThinqDeviceData, createMockLogger } from '../../tests/helpers/testUtils.js';
import { ThinqSession } from './session.js';
import { ThinqApiClient } from './thinqApiClient.js';

describe('ThinqApiClient', () => {
	let mockAxios: MockAdapter;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let apiClient: ThinqApiClient;
	let session: ThinqSession;

	const gatewayData = buildGatewayResponse();

	beforeEach(() => {
		vi.clearAllMocks();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockAxios = new MockAdapter(axios as any);
		mockLogger = createMockLogger();
		session = new ThinqSession('access-token-123', 'refresh-token-123', Math.floor(Date.now() / 1000) + 3600);
		apiClient = new ThinqApiClient(session, 'US', 'en', mockLogger);
	});

	afterEach(() => {
		mockAxios.reset();
		vi.clearAllMocks();
	});

	describe('getGateway', () => {
		it('should cache gateway after first call', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			const result1 = await apiClient.getGateway();
			const result2 = await apiClient.getGateway();

			expect(result1).toEqual(gatewayData);
			expect(result2).toEqual(gatewayData);
			expect(mockAxios.history.get).toHaveLength(1);
		});

		it('should return gateway data on successful request', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			const result = await apiClient.getGateway();

			expect(result).toEqual(gatewayData);
		});
	});

	describe('getListHomes', () => {
		it('should cache homes after first call', async () => {
			const homes = [{ homeId: 'home-1' }, { homeId: 'home-2' }];
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(200, { result: { item: homes } });

			const result1 = await apiClient.getListHomes();
			const result2 = await apiClient.getListHomes();

			expect(result1).toEqual(homes);
			expect(result2).toEqual(homes);
		});

		it('should return empty array when no homes found', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(200, { result: { item: undefined } });

			const result = await apiClient.getListHomes();

			expect(result).toEqual([]);
		});
	});

	describe('getListDevices', () => {
		it('should fetch devices from all homes', async () => {
			const homes = [{ homeId: 'home-1' }, { homeId: 'home-2' }];
			const devicesHome1 = [buildThinqDeviceData({ deviceId: 'device-1' })];
			const devicesHome2 = [buildThinqDeviceData({ deviceId: 'device-2' })];

			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(200, { result: { item: homes } });
			mockAxios
				.onGet(`${gatewayData.thinq2Uri}/service/homes/home-1`)
				.reply(200, { result: { devices: devicesHome1 } });
			mockAxios
				.onGet(`${gatewayData.thinq2Uri}/service/homes/home-2`)
				.reply(200, { result: { devices: devicesHome2 } });

			const result = await apiClient.getListDevices();

			expect(result).toHaveLength(2);
			expect(result[0].deviceId).toBe('device-1');
			expect(result[1].deviceId).toBe('device-2');
		});

		it('should skip homes with no devices', async () => {
			const homes = [{ homeId: 'home-1' }, { homeId: 'home-2' }];
			const devices = [buildThinqDeviceData({ deviceId: 'device-1' })];

			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(200, { result: { item: homes } });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes/home-1`).reply(200, { result: { devices } });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes/home-2`).reply(200, { result: { devices: undefined } });

			const result = await apiClient.getListDevices();

			expect(result).toHaveLength(1);
			expect(result[0].deviceId).toBe('device-1');
		});
	});

	describe('sendCommand', () => {
		it('should throw error when deviceId is empty', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			await expect(apiClient.sendCommand('', { dataKey: 'test' })).rejects.toThrow('Invalid deviceId');
		});

		it('should throw error when deviceId is whitespace only', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			await expect(apiClient.sendCommand('   ', { dataKey: 'test' })).rejects.toThrow('Invalid deviceId');
		});

		it('should send command with payload', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(200);

			await apiClient.sendCommand('device-123', { dataKey: 'test', dataValue: 'value' });

			expect(mockAxios.history.post).toHaveLength(1);
		});
	});

	describe('sendKeepAlive', () => {
		it('should throw error when deviceId is empty', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			await expect(apiClient.sendKeepAlive('')).rejects.toThrow('Invalid deviceId');
		});

		it('should throw error when deviceId is whitespace only', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			await expect(apiClient.sendKeepAlive('   ')).rejects.toThrow('Invalid deviceId');
		});

		it('should send keep-alive with correct payload', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control`).reply(200);

			await apiClient.sendKeepAlive('device-123');

			expect(mockAxios.history.post).toHaveLength(1);
			const request = mockAxios.history.post[0];
			const body = JSON.parse(request.data as string);
			expect(body).toEqual({
				ctrlKey: 'allEventEnable',
				command: 'Set',
				dataKey: 'airState.mon.timeout',
				dataValue: '70',
			});
		});

		it('should propagate rejection when POST fails', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control`).reply(500);

			await expect(apiClient.sendKeepAlive('device-123')).rejects.toThrow();
		});
	});

	describe('refreshToken', () => {
		it('should refresh the session access token', async () => {
			const oldSession = new ThinqSession('old-access', 'refresh-token-123', Math.floor(Date.now() / 1000));
			mockAxios
				.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token'))
				.reply(200, { access_token: 'new-access-token', expires_in: '3600' });

			const result = await apiClient.refreshToken(oldSession);

			expect(result.accessToken).toBe('new-access-token');
			expect(result.refreshToken).toBe('refresh-token-123');
		});

		it('should throw TokenExpiredError on refresh failure', async () => {
			const oldSession = new ThinqSession('old-access', 'refresh-token-123', Math.floor(Date.now() / 1000));
			mockAxios.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token')).reply(500);

			await expect(apiClient.refreshToken(oldSession)).rejects.toThrow(TokenExpiredError);
		});
	});

	describe('setSession', () => {
		it('should replace the active session', () => {
			const newSession = new ThinqSession('new-access', 'new-refresh', Math.floor(Date.now() / 1000) + 7200);

			apiClient.setSession(newSession);

			expect(apiClient['session']).toBe(newSession);
		});
	});

	describe('setUserNumber', () => {
		it('should set the user number and compute client ID', () => {
			apiClient.setUserNumber('user-123');

			expect(apiClient['userNumber']).toBe('user-123');
			expect(apiClient['clientId']).toBeDefined();
			expect(apiClient['clientId']).not.toBe('');
		});
	});

	describe('getUserNumber', () => {
		it('should return user number from profile response', async () => {
			mockAxios
				.onGet(new RegExp('https://.*.lgeapi.com/users/profile'))
				.reply(200, { status: undefined, account: { userNo: 'user-number-123' } });

			const result = await apiClient.getUserNumber('access-token-123');

			expect(result).toBe('user-number-123');
		});

		it('should throw error when status is 2', async () => {
			mockAxios.onGet(new RegExp('https://.*.lgeapi.com/users/profile')).reply(200, {
				status: 2,
				message: 'Profile lookup failed',
				account: { userNo: '' },
			});

			await expect(apiClient.getUserNumber('access-token-123')).rejects.toThrow('Profile lookup failed');
		});
	});

	describe('request 401 retry logic', () => {
		it('should retry once on 401 response', async () => {
			const homes = [{ homeId: 'home-1' }];
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// First call returns 401, second call returns 200
			const homesAdapter = mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`);
			homesAdapter.replyOnce(401);
			homesAdapter.replyOnce(200, { result: { item: homes } });

			mockAxios.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token')).reply(200, {
				access_token: 'new-access-token',
				expires_in: '3600',
			});

			const result = await apiClient.getListHomes();

			expect(result).toEqual(homes);
		});

		it('should throw TokenExpiredError on 401 after retry', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// Both calls return 401
			const homesAdapter = mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`);
			homesAdapter.replyOnce(401);
			homesAdapter.replyOnce(401);

			mockAxios.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token')).reply(200, {
				access_token: 'new-access-token',
				expires_in: '3600',
			});

			await expect(apiClient.getListHomes()).rejects.toThrow(TokenExpiredError);
		});

		it('should not retry on non-401 errors', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(500);

			await expect(apiClient.getListHomes()).rejects.toThrow();
			expect(mockAxios.history.get.filter((h) => h.url?.includes('/service/homes'))).toHaveLength(1);
		});
	});

	describe('request resultCode 0102 retry logic', () => {
		it('should retry once on 400 response with resultCode 0102', async () => {
			const homes = [{ homeId: 'home-1' }];
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// First call returns 400 with resultCode 0102, second call returns 200
			const homesAdapter = mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`);
			homesAdapter.replyOnce(400, { resultCode: '0102', result: '' });
			homesAdapter.replyOnce(200, { result: { item: homes } });

			mockAxios.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token')).reply(200, {
				access_token: 'new-access-token',
				expires_in: '3600',
			});

			const result = await apiClient.getListHomes();

			expect(result).toEqual(homes);
		});

		it('should throw TokenExpiredError on 400 resultCode 0102 after retry', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// Both calls return 400 with resultCode 0102
			const homesAdapter = mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`);
			homesAdapter.replyOnce(400, { resultCode: '0102', result: '' });
			homesAdapter.replyOnce(400, { resultCode: '0102', result: '' });

			mockAxios.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token')).reply(200, {
				access_token: 'new-access-token',
				expires_in: '3600',
			});

			await expect(apiClient.getListHomes()).rejects.toThrow(TokenExpiredError);
		});

		it('should self-heal sendCommand on 400 resultCode 0102 retry', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// First call to control-sync returns 400 with resultCode 0102, second call returns 200
			const controlSyncAdapter = mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`);
			controlSyncAdapter.replyOnce(400, { resultCode: '0102', result: '' });
			controlSyncAdapter.replyOnce(200);

			mockAxios.onPost(new RegExp('https://.*.lgeapi.com/oauth/1.0/oauth2/token')).reply(200, {
				access_token: 'new-access-token',
				expires_in: '3600',
			});

			await apiClient.sendCommand('device-123', {
				command: 'Operation',
				dataKey: 'airState.operation',
				dataValue: 1,
			});

			// Verify two POST calls to control-sync: original + retry
			expect(
				mockAxios.history.post.filter((h) => h.url?.includes('/service/devices/device-123/control-sync')),
			).toHaveLength(2);
		});

		it('should not retry on different resultCode under 400', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// Reply with 400 and different resultCode (not 0102)
			mockAxios
				.onGet(`${gatewayData.thinq2Uri}/service/homes`)
				.reply(400, { resultCode: '0110', result: 'some other error' });

			await expect(apiClient.getListHomes()).rejects.toThrow();

			// Verify only one GET call to /service/homes (no retry)
			expect(mockAxios.history.get.filter((h) => h.url?.includes('/service/homes'))).toHaveLength(1);

			// Verify no token refresh was attempted
			expect(mockAxios.history.post.filter((h) => h.url?.includes('oauth2/token'))).toHaveLength(0);
		});

		it('should not crash on 400 with no response body', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// Reply with 400 and no body (undefined data)
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(400);

			await expect(apiClient.getListHomes()).rejects.toThrow();

			// Verify only one GET call to /service/homes (no retry)
			expect(mockAxios.history.get.filter((h) => h.url?.includes('/service/homes'))).toHaveLength(1);

			// Verify no token refresh was attempted
			expect(mockAxios.history.post.filter((h) => h.url?.includes('oauth2/token'))).toHaveLength(0);
		});

		it('should not crash on 400 with non-JSON string body', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			// Reply with 400 and non-JSON string body
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(400, 'Bad Request');

			await expect(apiClient.getListHomes()).rejects.toThrow();

			// Verify only one GET call to /service/homes (no retry)
			expect(mockAxios.history.get.filter((h) => h.url?.includes('/service/homes'))).toHaveLength(1);

			// Verify no token refresh was attempted
			expect(mockAxios.history.post.filter((h) => h.url?.includes('oauth2/token'))).toHaveLength(0);
		});
	});

	describe('getMqttRouteInfo', () => {
		it('should fetch MQTT route info from the correct URL', async () => {
			const mqttRouteInfo = { mqttServer: 'mqtt.example.com:8883' };
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet('https://common.lgthinq.com/route').reply(200, { result: mqttRouteInfo });

			const result = await apiClient.getMqttRouteInfo();

			expect(result).toEqual(mqttRouteInfo);
		});

		it('should include auth headers in the request', async () => {
			apiClient.setUserNumber('user-123');
			const mqttRouteInfo = { mqttServer: 'mqtt.example.com:8883' };
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet('https://common.lgthinq.com/route').reply(200, { result: mqttRouteInfo });

			await apiClient.getMqttRouteInfo();

			const request = mockAxios.history.get.find((h) => h.url?.includes('common.lgthinq.com'));
			expect(request?.headers?.['x-api-key']).toBeDefined();
			expect(request?.headers?.['x-emp-token']).toBe('access-token-123');
		});
	});

	describe('registerMqttClient', () => {
		it('should register MQTT client with empty body', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/users/client`).reply(200, { result: {} });

			await apiClient.registerMqttClient();

			const request = mockAxios.history.post.find((h) => h.url?.includes('/service/users/client'));
			expect(JSON.parse(request?.data as string)).toEqual({});
		});

		it('should include auth headers in the request', async () => {
			apiClient.setUserNumber('user-123');
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/users/client`).reply(200, { result: {} });

			await apiClient.registerMqttClient();

			const request = mockAxios.history.post.find((h) => h.url?.includes('/service/users/client'));
			expect(request?.headers?.['x-api-key']).toBeDefined();
			expect(request?.headers?.['x-emp-token']).toBe('access-token-123');
		});
	});

	describe('requestMqttCertificate', () => {
		it('should request certificate with CSR body', async () => {
			const csrBody = 'MIICpDCCAYwCAQAwEzERMA8GA1UEAwwIVGVzdCBDU1I=';
			const certificateResponse = {
				certificatePem: 'cert-pem-data',
				subscriptions: ['topic/1', 'topic/2'],
			};
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios
				.onPost(`${gatewayData.thinq2Uri}/service/users/client/certificate`)
				.reply(200, { result: certificateResponse });

			const result = await apiClient.requestMqttCertificate(csrBody);

			expect(result).toEqual(certificateResponse);
		});

		it('should send CSR body in correct format', async () => {
			const csrBody = 'MIICpDCCAYwCAQAwEzERMA8GA1UEAwwIVGVzdCBDU1I=';
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios
				.onPost(`${gatewayData.thinq2Uri}/service/users/client/certificate`)
				.reply(200, { result: { certificatePem: 'cert', subscriptions: [] } });

			await apiClient.requestMqttCertificate(csrBody);

			const request = mockAxios.history.post.find((h) => h.url?.includes('/service/users/client/certificate'));
			expect(JSON.parse(request?.data as string)).toEqual({ csr: csrBody });
		});

		it('should include auth headers in the request', async () => {
			apiClient.setUserNumber('user-123');
			const csrBody = 'test-csr';
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios
				.onPost(`${gatewayData.thinq2Uri}/service/users/client/certificate`)
				.reply(200, { result: { certificatePem: 'cert', subscriptions: [] } });

			await apiClient.requestMqttCertificate(csrBody);

			const request = mockAxios.history.post.find((h) => h.url?.includes('/service/users/client/certificate'));
			expect(request?.headers?.['x-api-key']).toBeDefined();
			expect(request?.headers?.['x-emp-token']).toBe('access-token-123');
		});
	});

	describe('getClientId', () => {
		it('should return fallback API_CLIENT_ID when userNumber not set', () => {
			const clientId = apiClient.getClientId();

			expect(clientId).toBe('c713ea8e50f657534ff8b9d373dfebfc2ed70b88285c26b8ade49868c0b164d9');
		});

		it('should return computed clientId after setUserNumber', () => {
			apiClient.setUserNumber('user-123');

			const clientId = apiClient.getClientId();

			expect(clientId).not.toBe('c713ea8e50f657534ff8b9d373dfebfc2ed70b88285c26b8ade49868c0b164d9');
			expect(clientId).toBeDefined();
		});

		it('should return same value as x-client-id header after setUserNumber', async () => {
			apiClient.setUserNumber('user-123');
			const clientId = apiClient.getClientId();

			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onGet(`${gatewayData.thinq2Uri}/service/homes`).reply(200, { result: { item: [] } });

			// Call an API method to get the headers
			await apiClient.getListHomes();

			const request = mockAxios.history.get.find((h) => h.url?.includes('/service/homes'));
			expect(request?.headers?.['x-client-id']).toBe(clientId);
		});
	});

	describe('getFilterState', () => {
		it('should throw error when deviceId is empty', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			await expect(apiClient.getFilterState('')).rejects.toThrow('Invalid deviceId');
		});

		it('should throw error when deviceId is whitespace only', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });

			await expect(apiClient.getFilterState('   ')).rejects.toThrow('Invalid deviceId');
		});

		it('should return filter state data on successful response', async () => {
			const filterData = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
				'airState.filterMngStates.changeDate': 20260919,
			};
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(200, {
				resultCode: '0000',
				result: { data: filterData },
			});

			const result = await apiClient.getFilterState('device-123');

			expect(result).toEqual(filterData);
		});

		it('should return undefined when response has no result', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(200, {
				resultCode: '0000',
			});

			const result = await apiClient.getFilterState('device-123');

			expect(result).toBeUndefined();
		});

		it('should return undefined when response result has no data', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(200, {
				resultCode: '0000',
				result: {},
			});

			const result = await apiClient.getFilterState('device-123');

			expect(result).toBeUndefined();
		});

		it('should use correct payload with ctrlKey filterMngStateCtrl', async () => {
			const filterData = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(200, {
				resultCode: '0000',
				result: { data: filterData },
			});

			await apiClient.getFilterState('device-123');

			const request = mockAxios.history.post.find((h) =>
				h.url?.includes('/service/devices/device-123/control-sync'),
			) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
			const body = JSON.parse(request?.data as string);
			expect(body.ctrlKey).toBe('filterMngStateCtrl');
			expect(body.command).toBe('Get');
			expect(Array.isArray(body.dataGetList)).toBe(true);
		});

		it('should use correct dataGetList field array', async () => {
			const filterData = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(200, {
				resultCode: '0000',
				result: { data: filterData },
			});

			await apiClient.getFilterState('device-123');

			const request = mockAxios.history.post.find((h) =>
				h.url?.includes('/service/devices/device-123/control-sync'),
			) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
			const body = JSON.parse(request?.data as string);
			expect(body.dataGetList).toEqual([
				'airState.filterMngState.useTime',
				'airState.filterMngState.remainTime',
				'airState.filterMngState.maxTime',
				'airState.filterMngState.changeDate',
				'airState.filterMngState.type',
			]);
		});

		it('should propagate network errors', async () => {
			mockAxios
				.onGet('https://route.lgthinq.com:46030/v1/service/application/gateway-uri')
				.reply(200, { result: gatewayData });
			mockAxios.onPost(`${gatewayData.thinq2Uri}/service/devices/device-123/control-sync`).reply(500);

			await expect(apiClient.getFilterState('device-123')).rejects.toThrow();
		});
	});
});
