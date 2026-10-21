import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cli/commands/connectProbe.js');
vi.mock('../../cli/commands/devices.js');
vi.mock('../../cli/commands/login.js');
vi.mock('../../cli/help.js');
vi.mock('../../cli/session.js');
vi.mock('../../cli/utils.js');

import { cmdConnectProbe } from '../../cli/commands/connectProbe.js';
import { cmdDevices } from '../../cli/commands/devices.js';
import { cmdLogin } from '../../cli/commands/login.js';
import { HELP_TEXT } from '../../cli/help.js';
import { main } from '../../cli/main.js';
import { loadPatSession, loadSession } from '../../cli/session.js';
import { parseArgs } from '../../cli/utils.js';

describe('main', () => {
	let consoleLogSpy: any;
	let consoleErrorSpy: any;
	let processExitSpy: any;

	beforeEach(() => {
		vi.clearAllMocks();
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it('should print help and exit with 1 when no command is provided', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: '' });

		// Act
		await main();

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith(HELP_TEXT);
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	it('should print help and exit with 0 when command is "help"', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'help' });

		// Act
		await main();

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith(HELP_TEXT);
		expect(processExitSpy).toHaveBeenCalledWith(0);
	});

	it('should print help and exit with 0 when --help flag is set', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ help: 'true' });

		// Act
		await main();

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith(HELP_TEXT);
		expect(processExitSpy).toHaveBeenCalledWith(0);
	});

	it('should call cmdLogin when command is "login"', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({
			command: 'login',
			type: 'account',
			country: 'US',
			language: 'en-US',
		});
		vi.mocked(cmdLogin).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdLogin).toHaveBeenCalled();
	});

	it('should call cmdLogin with default values when flags are omitted', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'login' });
		vi.mocked(cmdLogin).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdLogin).toHaveBeenCalled();
	});

	it('should call cmdDevices when command is "devices" and session exists', async () => {
		// Arrange
		const mockSession = {
			loginType: 'account' as const,
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		vi.mocked(parseArgs).mockReturnValue({ command: 'devices' });
		vi.mocked(loadSession).mockReturnValue(mockSession);
		vi.mocked(cmdDevices).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdDevices).toHaveBeenCalledWith(mockSession, expect.any(Object), undefined, undefined);
	});

	it('should call cmdDevices with dump-snapshot flag when --dump-snapshot is provided', async () => {
		// Arrange
		const mockSession = {
			loginType: 'account' as const,
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		vi.mocked(parseArgs).mockReturnValue({ command: 'devices', 'dump-snapshot': 'washer-123' });
		vi.mocked(loadSession).mockReturnValue(mockSession);
		vi.mocked(cmdDevices).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdDevices).toHaveBeenCalledWith(mockSession, expect.any(Object), 'washer-123', undefined);
	});

	it('should error when command is "devices" but session does not exist', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'devices' });
		vi.mocked(loadSession).mockReturnValue(null);

		// Act
		await main();

		// Assert
		expect(consoleErrorSpy).toHaveBeenCalledWith('No session found. Run `--command login` first.');
		expect(cmdDevices).not.toHaveBeenCalled();
	});

	it('should error and exit when command is unknown', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'unknown' });

		// Act
		await main();

		// Assert
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command: unknown'));
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	it('should catch and handle Error thrown from cmdLogin', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'login' });
		vi.mocked(cmdLogin).mockRejectedValue(new Error('Login failed'));

		// Act
		await main();

		// Assert
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'Login failed');
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	it('should handle non-Error thrown value', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'login' });
		vi.mocked(cmdLogin).mockRejectedValue('String error');

		// Act
		await main();

		// Assert
		expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'String error');
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	it('should return without further processing after cmdLogin succeeds', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'login' });
		vi.mocked(cmdLogin).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdLogin).toHaveBeenCalled();
		expect(processExitSpy).not.toHaveBeenCalled();
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it('should call cmdLogin with type "pat" and country KR when --type pat --country KR are given', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'login', type: 'pat', country: 'KR' });
		vi.mocked(cmdLogin).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdLogin).toHaveBeenCalledWith('pat', 'KR', 'en-US', expect.any(Object));
	});

	it('should default login type to "account" when --type is omitted', async () => {
		// Arrange
		vi.mocked(parseArgs).mockReturnValue({ command: 'login' });
		vi.mocked(cmdLogin).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdLogin).toHaveBeenCalledWith('account', 'US', 'en-US', expect.any(Object));
	});

	describe('connect-probe command', () => {
		const PAT_SESSION = { country: 'US', personalAccessToken: 'pat-secret-1234567890' };

		afterEach(() => {
			process.exitCode = undefined;
		});

		it('should call cmdConnectProbe with no device id and raw false when no flags are given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectProbe).toHaveBeenCalledWith(
				PAT_SESSION,
				{ deviceId: undefined, raw: false },
				expect.any(Object),
			);
		});

		it('should call cmdConnectProbe with the device id and raw true when --device-id and --raw are given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', 'device-id': 'washer-1', raw: 'true' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectProbe).toHaveBeenCalledWith(
				PAT_SESSION,
				{ deviceId: 'washer-1', raw: true },
				expect.any(Object),
			);
		});

		it('should print a PAT login hint, set exitCode 1 and skip the probe when no PAT session exists', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe' });
			vi.mocked(loadPatSession).mockReturnValue(null);

			// Act
			await main();

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('No PAT session found. Run `--command login --type pat` first.');
			expect(process.exitCode).toBe(1);
			expect(cmdConnectProbe).not.toHaveBeenCalled();
			expect(loadSession).not.toHaveBeenCalled();
		});

		it('should report the error and exit 1 when cmdConnectProbe rejects', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockRejectedValue(new Error('probe exploded'));

			// Act
			await main();

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'probe exploded');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});
	});
});
