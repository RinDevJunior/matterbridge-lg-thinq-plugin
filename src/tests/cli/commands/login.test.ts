import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockCoordinator: any;

vi.mock('../../../services/authentication/AccountAuthStrategy.js', () => ({
	AccountAuthStrategy: vi.fn(),
}));

vi.mock('../../../services/authentication/TokenAuthStrategy.js', () => ({
	TokenAuthStrategy: vi.fn(),
}));

vi.mock('../../../services/authentication/AuthenticationCoordinator.js', () => ({
	AuthenticationCoordinator: vi.fn(function () {
		if (!mockCoordinator) {
			mockCoordinator = { authenticate: vi.fn() };
		}
		return mockCoordinator;
	}),
}));

vi.mock('../../../services/thinq/thinqApiClient.js', () => ({
	ThinqApiClient: vi.fn(),
}));

vi.mock('../../../services/thinq/session.js', () => ({
	ThinqSession: vi.fn(),
}));

vi.mock('../../../cli/session.js', () => ({
	saveSession: vi.fn(),
}));

vi.mock('../../../cli/utils.js', () => ({
	maskSecret: vi.fn((secret: string) => '*'.repeat(secret?.length || 0)),
	parseArgs: vi.fn(),
	prompt: vi.fn(),
}));

import { cmdLogin } from '../../../cli/commands/login.js';
import { saveSession } from '../../../cli/session.js';
import { maskSecret, prompt } from '../../../cli/utils.js';
import { createMockLogger } from '../../helpers/testUtils.js';

describe('cmdLogin', () => {
	let mockLogger: any;
	let consoleLogSpy: any;
	let consoleErrorSpy: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockCoordinator = {
			authenticate: vi.fn(),
		};
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(prompt).mockResolvedValue('mocked_answer');
		vi.mocked(maskSecret).mockImplementation((secret?: string) => '*'.repeat(secret?.length || 0));
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	it('should prompt for refresh token when type is "token"', async () => {
		// Arrange
		vi.mocked(prompt).mockResolvedValueOnce('refresh_token_value');
		mockCoordinator.authenticate.mockResolvedValue(undefined);

		// Act
		await cmdLogin('token', 'US', 'en-US', mockLogger);

		// Assert
		expect(prompt).toHaveBeenCalledWith('Refresh token: ');
	});

	it('should prompt for username and password when type is "account"', async () => {
		// Arrange
		vi.mocked(prompt).mockResolvedValueOnce('user@example.com').mockResolvedValueOnce('password123');
		mockCoordinator.authenticate.mockResolvedValue(undefined);

		// Act
		await cmdLogin('account', 'US', 'en-US', mockLogger);

		// Assert
		expect(prompt).toHaveBeenNthCalledWith(1, 'Username (email): ');
		expect(prompt).toHaveBeenNthCalledWith(2, 'Password: ');
	});

	it('should error when authentication returns undefined', async () => {
		// Arrange
		vi.mocked(prompt).mockResolvedValue('answer');
		mockCoordinator.authenticate.mockResolvedValue(undefined);

		// Act
		await cmdLogin('account', 'US', 'en-US', mockLogger);

		// Assert
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Login did not complete: no session data was returned (a manual process may be required).',
		);
		expect(saveSession).not.toHaveBeenCalled();
	});

	it('should save session when authentication succeeds', async () => {
		// Arrange
		const mockUserData = {
			accessToken: 'access_token_123',
			refreshToken: 'refresh_token_456',
			expiresAtEpochSeconds: 1609459200,
			country: 'US',
			language: 'en-US',
		};
		vi.mocked(prompt).mockResolvedValue('answer');
		mockCoordinator.authenticate.mockResolvedValue(mockUserData);

		// Act
		await cmdLogin('account', 'US', 'en-US', mockLogger);

		// Assert
		expect(saveSession).toHaveBeenCalledWith({
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: mockUserData,
		});
	});

	it('should print success message', async () => {
		// Arrange
		const mockUserData = {
			accessToken: 'token',
			refreshToken: 'refresh',
			expiresAtEpochSeconds: 1609459200,
			country: 'US',
			language: 'en-US',
		};
		vi.mocked(prompt).mockResolvedValue('answer');
		mockCoordinator.authenticate.mockResolvedValue(mockUserData);

		// Act
		await cmdLogin('account', 'US', 'en-US', mockLogger);

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith('Login successful. Session saved to .cli-session.json');
		expect(consoleLogSpy).toHaveBeenCalledWith('Session Summary:');
	});

	it('should call maskSecret for tokens', async () => {
		// Arrange
		const mockUserData = {
			accessToken: 'access_token_value',
			refreshToken: 'refresh_token_value',
			expiresAtEpochSeconds: 1609459200,
			country: 'US',
			language: 'en-US',
		};
		vi.mocked(prompt).mockResolvedValue('answer');
		mockCoordinator.authenticate.mockResolvedValue(mockUserData);

		// Act
		await cmdLogin('token', 'US', 'en-US', mockLogger);

		// Assert
		expect(maskSecret).toHaveBeenCalledWith('access_token_value');
		expect(maskSecret).toHaveBeenCalledWith('refresh_token_value');
	});

	it('should print formatted expiration date', async () => {
		// Arrange
		const mockUserData = {
			accessToken: 'token',
			refreshToken: 'refresh',
			expiresAtEpochSeconds: 1609459200,
			country: 'US',
			language: 'en-US',
		};
		vi.mocked(prompt).mockResolvedValue('answer');
		mockCoordinator.authenticate.mockResolvedValue(mockUserData);

		// Act
		await cmdLogin('account', 'US', 'en-US', mockLogger);

		// Assert
		const expectedDate = new Date(1609459200 * 1000).toISOString();
		expect(consoleLogSpy).toHaveBeenCalledWith(`  Expires At: ${expectedDate}`);
	});

	it('should build auth context for token type', async () => {
		// Arrange
		vi.mocked(prompt).mockResolvedValueOnce('my_refresh_token');
		mockCoordinator.authenticate.mockResolvedValue({
			accessToken: 'token',
			refreshToken: 'refresh',
			expiresAtEpochSeconds: 123,
			country: 'US',
			language: 'en-US',
		});

		// Act
		await cmdLogin('token', 'KR', 'ko-KR', mockLogger);

		// Assert
		const callArgs = mockCoordinator.authenticate.mock.calls[0];
		expect(callArgs[0]).toBe('token');
		expect(callArgs[1]).toEqual({
			refreshToken: 'my_refresh_token',
			country: 'KR',
			language: 'ko-KR',
		});
	});

	it('should build auth context for account type', async () => {
		// Arrange
		vi.mocked(prompt).mockResolvedValueOnce('user@email.com').mockResolvedValueOnce('pass123');
		mockCoordinator.authenticate.mockResolvedValue({
			accessToken: 'token',
			refreshToken: 'refresh',
			expiresAtEpochSeconds: 123,
			country: 'US',
			language: 'en-US',
		});

		// Act
		await cmdLogin('account', 'KR', 'ko-KR', mockLogger);

		// Assert
		const callArgs = mockCoordinator.authenticate.mock.calls[0];
		expect(callArgs[0]).toBe('account');
		expect(callArgs[1]).toEqual({
			username: 'user@email.com',
			password: 'pass123',
			country: 'KR',
			language: 'ko-KR',
		});
	});
});
