import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asPartial, createMockLogger } from '../../tests/helpers/testUtils.js';
import type { ThinqApiClient } from '../thinq/thinqApiClient.js';
import { AccountAuthStrategy } from './AccountAuthStrategy.js';
import type { ThinqAuthContext, ThinqUserData } from './AuthContext.js';
import { AuthenticationCoordinator } from './AuthenticationCoordinator.js';
import { TokenAuthStrategy } from './TokenAuthStrategy.js';

describe('AuthenticationCoordinator', () => {
	let mockAccountStrategy: AccountAuthStrategy;
	let mockTokenStrategy: TokenAuthStrategy;
	let mockApiClient: ThinqApiClient;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let coordinator: AuthenticationCoordinator;

	const testUserData: ThinqUserData = {
		accessToken: 'access-token-123',
		refreshToken: 'refresh-token-123',
		expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
		country: 'US',
		language: 'en',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockAccountStrategy = asPartial<AccountAuthStrategy>({
			authenticate: vi.fn(),
		});
		mockTokenStrategy = asPartial<TokenAuthStrategy>({
			authenticate: vi.fn(),
		});
		mockApiClient = asPartial<ThinqApiClient>({
			getUserNumber: vi.fn(),
			setUserNumber: vi.fn(),
		});
		coordinator = new AuthenticationCoordinator(mockAccountStrategy, mockTokenStrategy, mockApiClient, mockLogger);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('authenticate', () => {
		it('should dispatch to AccountAuthStrategy when method is "account"', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-123');

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			await coordinator.authenticate('account', context);

			expect(mockAccountStrategy.authenticate).toHaveBeenCalledWith(context);
		});

		it('should dispatch to TokenAuthStrategy when method is "token"', async () => {
			vi.mocked(mockTokenStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-123');

			const context = asPartial<ThinqAuthContext>({
				refreshToken: 'refresh-token-123',
				country: 'US',
				language: 'en',
			});

			await coordinator.authenticate('token', context);

			expect(mockTokenStrategy.authenticate).toHaveBeenCalledWith(context);
		});

		it('should throw Error with available methods when method is unknown', async () => {
			const context = asPartial<ThinqAuthContext>({
				country: 'US',
				language: 'en',
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await expect(coordinator.authenticate('invalid-method' as any, context)).rejects.toThrow(
				/Unknown ThinQ authentication method/,
			);
		});

		it('should include available methods in error message', async () => {
			const context = asPartial<ThinqAuthContext>({
				country: 'US',
				language: 'en',
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const error = await coordinator.authenticate('unknown' as any, context).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain('Unknown ThinQ authentication method');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('account'));
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('token'));
		});

		it('should fetch user number after successful authentication', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-456');

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			await coordinator.authenticate('account', context);

			expect(mockApiClient.getUserNumber).toHaveBeenCalledWith('access-token-123');
		});

		it('should set user number on API client', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-789');

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			await coordinator.authenticate('account', context);

			expect(mockApiClient.setUserNumber).toHaveBeenCalledWith('user-number-789');
		});

		it('should return user data with user number added', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-999');

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			const result = await coordinator.authenticate('account', context);

			expect(result?.userNumber).toBe('user-number-999');
			expect(result?.accessToken).toBe(testUserData.accessToken);
			expect(result?.refreshToken).toBe(testUserData.refreshToken);
		});

		it('should return undefined when strategy returns undefined', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(undefined);

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			const result = await coordinator.authenticate('account', context);

			expect(result).toBeUndefined();
			expect(mockApiClient.getUserNumber).not.toHaveBeenCalled();
		});

		it('should log debug message before resolving user number', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-123');

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			await coordinator.authenticate('account', context);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				'AuthenticationCoordinator: resolving ThinQ user number post-login',
			);
		});

		it('should propagate getUserNumber errors', async () => {
			vi.mocked(mockAccountStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockRejectedValue(new Error('User number fetch failed'));

			const context = asPartial<ThinqAuthContext>({
				username: 'test@example.com',
				password: 'password',
				country: 'US',
				language: 'en',
			});

			await expect(coordinator.authenticate('account', context)).rejects.toThrow('User number fetch failed');
		});

		it('should work with TokenAuthStrategy', async () => {
			vi.mocked(mockTokenStrategy.authenticate).mockResolvedValue(testUserData);
			vi.mocked(mockApiClient.getUserNumber).mockResolvedValue('user-number-token');

			const context = asPartial<ThinqAuthContext>({
				refreshToken: 'refresh-token-123',
				country: 'US',
				language: 'en',
			});

			const result = await coordinator.authenticate('token', context);

			expect(result?.userNumber).toBe('user-number-token');
			expect(mockTokenStrategy.authenticate).toHaveBeenCalledWith(context);
		});
	});
});
