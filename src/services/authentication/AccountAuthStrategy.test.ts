import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError, InvalidCredentialsError } from '../../errors/index.js';
import { asPartial, buildGatewayResponse, createMockLogger } from '../../tests/helpers/testUtils.js';
import type { ThinqApiClient } from '../thinq/thinqApiClient.js';
import { AccountAuthStrategy } from './AccountAuthStrategy.js';
import type { ThinqAuthContext } from './AuthContext.js';

describe('AccountAuthStrategy', () => {
	let mockAxios: MockAdapter;
	let mockApiClient: ThinqApiClient;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let strategy: AccountAuthStrategy;

	const testContext: ThinqAuthContext = {
		username: 'test@example.com',
		password: 'testpassword123',
		country: 'US',
		language: 'en',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockAxios = new MockAdapter(axios as any);
		mockLogger = createMockLogger();
		mockApiClient = asPartial<ThinqApiClient>({
			getGateway: vi.fn(),
		});
		strategy = new AccountAuthStrategy(mockApiClient, mockLogger);
	});

	afterEach(() => {
		mockAxios.reset();
		vi.clearAllMocks();
	});

	describe('authenticate', () => {
		it('should throw InvalidCredentialsError when username is missing', async () => {
			const contextWithoutUsername = asPartial<ThinqAuthContext>({
				password: 'password',
				country: 'US',
				language: 'en',
			});

			await expect(strategy.authenticate(contextWithoutUsername)).rejects.toThrow(InvalidCredentialsError);
		});

		it('should throw InvalidCredentialsError when password is missing', async () => {
			const contextWithoutPassword = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				country: 'US',
				language: 'en',
			});

			await expect(strategy.authenticate(contextWithoutPassword)).rejects.toThrow(InvalidCredentialsError);
		});

		it('should throw InvalidCredentialsError when both username and password are missing', async () => {
			const emptyContext = asPartial<ThinqAuthContext>({
				country: 'US',
				language: 'en',
			});

			await expect(strategy.authenticate(emptyContext)).rejects.toThrow(InvalidCredentialsError);
		});

		it('should throw InvalidCredentialsError on preLogin 4xx response', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(401);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(InvalidCredentialsError);
		});

		it('should throw AuthenticationError on preLogin non-4xx failure', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(500);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(AuthenticationError);
		});

		it('should throw InvalidCredentialsError on account/session 4xx response', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(403);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(InvalidCredentialsError);
		});

		it('should throw AuthenticationError on account/session non-4xx failure', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(500);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(AuthenticationError);
		});

		it('should throw AuthenticationError on OAuth key lookup failure', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			const accountResponse = {
				account: {
					userIDType: 'LGE',
					country: 'US',
					userID: 'test@example.com',
					loginSessionID: 'session-id',
				},
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(200, accountResponse);
			mockAxios.onGet(`${gatewayData.empSpxUri}/searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP`).reply(500);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(AuthenticationError);
		});

		it('should throw AuthenticationError on EMP authorization failure when status is not 1', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			const accountResponse = {
				account: {
					userIDType: 'LGE',
					country: 'US',
					userID: 'test@example.com',
					loginSessionID: 'session-id',
				},
			};

			const secretKeyResponse = {
				returnData: 'secret-key-data',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(200, accountResponse);
			mockAxios
				.onGet(`${gatewayData.empSpxUri}/searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP`)
				.reply(200, secretKeyResponse);
			mockAxios
				.onGet(new RegExp('https://emp-oauth.lgecloud.com/emp/oauth2/authorize/empsession.*'))
				.reply(200, { status: 0, message: 'Auth failed', redirect_uri: '' });

			await expect(strategy.authenticate(testContext)).rejects.toThrow(AuthenticationError);
		});

		it('should throw AuthenticationError on EMP authorization network failure', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			const accountResponse = {
				account: {
					userIDType: 'LGE',
					country: 'US',
					userID: 'test@example.com',
					loginSessionID: 'session-id',
				},
			};

			const secretKeyResponse = {
				returnData: 'secret-key-data',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(200, accountResponse);
			mockAxios
				.onGet(`${gatewayData.empSpxUri}/searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP`)
				.reply(200, secretKeyResponse);
			mockAxios.onGet(new RegExp('https://emp-oauth.lgecloud.com/emp/oauth2/authorize/empsession.*')).reply(500);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(AuthenticationError);
		});

		it('should throw AuthenticationError on token exchange failure', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			const accountResponse = {
				account: {
					userIDType: 'LGE',
					country: 'US',
					userID: 'test@example.com',
					loginSessionID: 'session-id',
				},
			};

			const secretKeyResponse = {
				returnData: 'secret-key-data',
			};

			const empResponse = {
				status: 1,
				redirect_uri: 'lgaccount.lgsmartthinq:/?code=test-code&oauth2_backend_url=https://test.com/',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(200, accountResponse);
			mockAxios
				.onGet(`${gatewayData.empSpxUri}/searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP`)
				.reply(200, secretKeyResponse);
			mockAxios
				.onGet(new RegExp('https://emp-oauth.lgecloud.com/emp/oauth2/authorize/empsession.*'))
				.reply(200, empResponse);
			mockAxios.onPost(new RegExp('https://test.com/oauth/1.0/oauth2/token')).reply(500);

			await expect(strategy.authenticate(testContext)).rejects.toThrow(AuthenticationError);
		});

		it('should return ThinqUserData on successful authentication', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			const accountResponse = {
				account: {
					userIDType: 'LGE',
					country: 'US',
					userID: 'test@example.com',
					loginSessionID: 'session-id',
				},
			};

			const secretKeyResponse = {
				returnData: 'secret-key-data',
			};

			const empResponse = {
				status: 1,
				redirect_uri: 'lgaccount.lgsmartthinq:/?code=test-code&oauth2_backend_url=https://test.com/',
			};

			const tokenResponse = {
				access_token: 'access-token-123',
				refresh_token: 'refresh-token-123',
				expires_in: '3600',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(200, accountResponse);
			mockAxios
				.onGet(`${gatewayData.empSpxUri}/searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP`)
				.reply(200, secretKeyResponse);
			mockAxios
				.onGet(new RegExp('https://emp-oauth.lgecloud.com/emp/oauth2/authorize/empsession.*'))
				.reply(200, empResponse);
			mockAxios.onPost(new RegExp('https://test.com/oauth/1.0/oauth2/token')).reply(200, tokenResponse);

			const result = await strategy.authenticate(testContext);

			expect(result).toBeDefined();
			expect(result?.accessToken).toBe('access-token-123');
			expect(result?.refreshToken).toBe('refresh-token-123');
			expect(result?.country).toBe('US');
			expect(result?.language).toBe('en');
			expect(result?.expiresAtEpochSeconds).toBeGreaterThan(0);
		});

		it('should log authentication start message', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);

			const preLoginResponse = {
				signature: 'test-signature',
				tStamp: '1234567890',
				encrypted_pw: 'encrypted-password',
			};

			mockAxios.onPost(`${gatewayData.empSpxUri}/preLogin`).reply(200, preLoginResponse);
			mockAxios
				.onPost(
					new RegExp(`${gatewayData.empTermsUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/emp/v2.0/account/session/.*`),
				)
				.reply(401);

			await expect(strategy.authenticate(testContext)).rejects.toThrow();
			expect(mockLogger.notice).toHaveBeenCalledWith('Authenticating with LG ThinQ account credentials...');
		});
	});
});
