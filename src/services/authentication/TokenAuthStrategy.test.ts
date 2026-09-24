import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from '../../errors/index.js';
import { asPartial, buildGatewayResponse, createMockLogger } from '../../tests/helpers/testUtils.js';
import { ThinqSession } from '../thinq/session.js';
import type { ThinqApiClient } from '../thinq/thinqApiClient.js';
import type { ThinqAuthContext } from './AuthContext.js';
import { TokenAuthStrategy } from './TokenAuthStrategy.js';

describe('TokenAuthStrategy', () => {
	let mockApiClient: ThinqApiClient;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let strategy: TokenAuthStrategy;

	const testContext: ThinqAuthContext = {
		refreshToken: 'refresh-token-123',
		country: 'US',
		language: 'en',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockApiClient = asPartial<ThinqApiClient>({
			getGateway: vi.fn(),
			refreshToken: vi.fn(),
		});
		strategy = new TokenAuthStrategy(mockApiClient, mockLogger);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('authenticate', () => {
		it('should throw AuthenticationError when refreshToken is missing', async () => {
			const contextWithoutToken = asPartial<ThinqAuthContext>({
				country: 'US',
				language: 'en',
			});

			await expect(strategy.authenticate(contextWithoutToken)).rejects.toThrow(AuthenticationError);
		});

		it('should throw AuthenticationError when refreshToken is empty string', async () => {
			const contextWithEmptyToken = asPartial<ThinqAuthContext>({
				refreshToken: '',
				country: 'US',
				language: 'en',
			});

			await expect(strategy.authenticate(contextWithEmptyToken)).rejects.toThrow(AuthenticationError);
		});

		it('should call getGateway before refreshing token', async () => {
			const gatewayData = buildGatewayResponse();
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockResolvedValue(
				new ThinqSession('new-access-token', 'refresh-token-123', Math.floor(Date.now() / 1000) + 3600),
			);

			await strategy.authenticate(testContext);

			expect(mockApiClient.getGateway).toHaveBeenCalled();
		});

		it('should call refreshToken with a ThinqSession containing the refresh token', async () => {
			const gatewayData = buildGatewayResponse();
			const newSession = new ThinqSession(
				'new-access-token',
				'refresh-token-123',
				Math.floor(Date.now() / 1000) + 3600,
			);
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockResolvedValue(newSession);

			await strategy.authenticate(testContext);

			expect(mockApiClient.refreshToken).toHaveBeenCalled();
			const callArg = vi.mocked(mockApiClient.refreshToken).mock.calls[0][0];
			expect(callArg.refreshToken).toBe('refresh-token-123');
		});

		it('should return ThinqUserData with tokens from refreshToken response', async () => {
			const gatewayData = buildGatewayResponse();
			const newSession = new ThinqSession(
				'new-access-token',
				'refresh-token-updated',
				Math.floor(Date.now() / 1000) + 3600,
			);
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockResolvedValue(newSession);

			const result = await strategy.authenticate(testContext);

			expect(result).toBeDefined();
			expect(result?.accessToken).toBe('new-access-token');
			expect(result?.refreshToken).toBe('refresh-token-updated');
			expect(result?.country).toBe('US');
			expect(result?.language).toBe('en');
			expect(result?.expiresAtEpochSeconds).toBeGreaterThan(0);
		});

		it('should preserve country and language from context', async () => {
			const contextWithDifferentLocale = asPartial<ThinqAuthContext>({
				refreshToken: 'refresh-token-123',
				country: 'KR',
				language: 'ko',
			});

			const gatewayData = buildGatewayResponse();
			const newSession = new ThinqSession(
				'new-access-token',
				'refresh-token-123',
				Math.floor(Date.now() / 1000) + 3600,
			);
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockResolvedValue(newSession);

			const result = await strategy.authenticate(contextWithDifferentLocale);

			expect(result?.country).toBe('KR');
			expect(result?.language).toBe('ko');
		});

		it('should log authentication start message', async () => {
			const gatewayData = buildGatewayResponse();
			const newSession = new ThinqSession(
				'new-access-token',
				'refresh-token-123',
				Math.floor(Date.now() / 1000) + 3600,
			);
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockResolvedValue(newSession);

			await strategy.authenticate(testContext);

			expect(mockLogger.notice).toHaveBeenCalledWith('Authenticating with LG ThinQ refresh token...');
		});

		it('should log debug message before getting gateway', async () => {
			const gatewayData = buildGatewayResponse();
			const newSession = new ThinqSession(
				'new-access-token',
				'refresh-token-123',
				Math.floor(Date.now() / 1000) + 3600,
			);
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockResolvedValue(newSession);

			await strategy.authenticate(testContext);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				'TokenAuthStrategy: resolving gateway before refresh-token exchange',
			);
		});

		it('should propagate errors from refreshToken', async () => {
			const gatewayData = buildGatewayResponse();
			const error = new Error('Token refresh failed');
			vi.mocked(mockApiClient.getGateway).mockResolvedValue(gatewayData);
			vi.mocked(mockApiClient.refreshToken).mockRejectedValue(error);

			await expect(strategy.authenticate(testContext)).rejects.toThrow('Token refresh failed');
		});
	});
});
