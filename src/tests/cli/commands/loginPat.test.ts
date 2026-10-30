import type { Mock, MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cli/utils.js', () => ({
	maskSecret: vi.fn((secret: string) => '*'.repeat(secret.length)),
	prompt: vi.fn(),
}));

vi.mock('../../../cli/session.js', () => ({
	savePatSession: vi.fn(),
}));

vi.mock('../../../services/thinqConnect/thinqConnectApiClient.js', () => ({
	ThinqConnectApiClient: vi.fn(),
}));

import { cmdLoginPat } from '../../../cli/commands/loginPat.js';
import { savePatSession } from '../../../cli/session.js';
import { maskSecret, prompt } from '../../../cli/utils.js';
import { ThinqConnectApiClient } from '../../../services/thinqConnect/thinqConnectApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

const FAKE_PAT = 'pat-secret-1234567890';

describe('cmdLoginPat', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockValidateToken: Mock;
	let consoleLogSpy: MockInstance<typeof console.log>;
	let consoleErrorSpy: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockValidateToken = vi.fn();
		vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
			return asPartial<ThinqConnectApiClient>({ validateToken: mockValidateToken });
		});
		vi.mocked(maskSecret).mockImplementation((secret: string | undefined) => '*'.repeat(secret?.length ?? 0));
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		process.exitCode = undefined;
	});

	describe('happy path', () => {
		it('should save the PAT session when validation succeeds', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockResolvedValue({
				deviceCount: 2,
				devices: [
					{ deviceId: 'dev-1', deviceInfo: { alias: 'Washer', deviceType: 'DEVICE_WASHER' } },
					{ deviceId: 'dev-2', deviceInfo: { alias: 'AC', deviceType: 'DEVICE_AC' } },
				],
			});

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(savePatSession).toHaveBeenCalledWith({ country: 'US', personalAccessToken: FAKE_PAT });
		});

		it('should print login success, device count and each device id when validation succeeds', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockResolvedValue({
				deviceCount: 2,
				devices: [
					{ deviceId: 'dev-1', deviceInfo: { alias: 'Washer', deviceType: 'DEVICE_WASHER' } },
					{ deviceId: 'dev-2', deviceInfo: { alias: 'AC', deviceType: 'DEVICE_AC' } },
				],
			});

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			const output = consoleLogSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
			expect(output).toContain('Login successful');
			expect(output).toContain('Devices visible: 2');
			expect(output).toContain('(dev-1)');
			expect(output).toContain('(dev-2)');
		});

		it('should print the masked PAT and never the raw PAT when validation succeeds', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockResolvedValue({ deviceCount: 0, devices: [] });

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(maskSecret).toHaveBeenCalledWith(FAKE_PAT);
			const output = JSON.stringify(consoleLogSpy.mock.calls);
			expect(output).toContain('*'.repeat(FAKE_PAT.length));
			expect(output).not.toContain(FAKE_PAT);
		});

		it('should not set process.exitCode when validation succeeds', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockResolvedValue({ deviceCount: 0, devices: [] });

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(process.exitCode).toBeUndefined();
		});
	});

	describe('empty PAT input', () => {
		it('should print an error and set exitCode 1 when PAT answer is empty', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue('');

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('A Personal Access Token is required.');
			expect(process.exitCode).toBe(1);
		});

		it('should not construct the client or save the session when PAT answer is empty', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue('');

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(ThinqConnectApiClient).not.toHaveBeenCalled();
			expect(savePatSession).not.toHaveBeenCalled();
		});
	});

	describe('validation failure', () => {
		it('should print the error message and set exitCode 1 when validateToken rejects', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockRejectedValue(new Error('Personal Access Token is invalid or expired.'));

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Login failed:', 'Personal Access Token is invalid or expired.');
			expect(process.exitCode).toBe(1);
		});

		it('should not save the session when validateToken rejects', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockRejectedValue(new Error('network down'));

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			expect(savePatSession).not.toHaveBeenCalled();
		});

		it('should never print the raw PAT when validateToken rejects', async () => {
			// Arrange
			vi.mocked(prompt).mockResolvedValue(FAKE_PAT);
			mockValidateToken.mockRejectedValue(new Error('network down'));

			// Act
			await cmdLoginPat('US', mockLogger);

			// Assert
			const output = JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
			expect(output).not.toContain(FAKE_PAT);
		});
	});
});
