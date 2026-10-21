import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../../cli/commands/connectProbe.js');
vi.mock('../../cli/commands/connectControl.js');
vi.mock('../../cli/commands/devices.js');
vi.mock('../../cli/commands/login.js');
vi.mock('../../cli/help.js');
vi.mock('../../cli/session.js');
vi.mock('../../cli/utils.js');
vi.mock('../../cli/outputCapture.js');

import { cmdConnectControl } from '../../cli/commands/connectControl.js';
import { cmdConnectProbe } from '../../cli/commands/connectProbe.js';
import { cmdDevices } from '../../cli/commands/devices.js';
import { cmdLogin } from '../../cli/commands/login.js';
import { HELP_TEXT } from '../../cli/help.js';
import { main } from '../../cli/main.js';
import { startOutputCapture } from '../../cli/outputCapture.js';
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
		expect(cmdDevices).toHaveBeenCalledWith(mockSession, expect.any(Object), undefined, undefined, {
			dumpDeviceId: undefined,
			showSecrets: false,
		});
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
		expect(cmdDevices).toHaveBeenCalledWith(mockSession, expect.any(Object), 'washer-123', undefined, {
			dumpDeviceId: undefined,
			showSecrets: false,
		});
	});

	it('should call cmdDevices with dump-device id and showSecrets true when --dump-device and --show-secrets true are given', async () => {
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
		vi.mocked(parseArgs).mockReturnValue({ command: 'devices', 'dump-device': 'dev-9', 'show-secrets': 'true' });
		vi.mocked(loadSession).mockReturnValue(mockSession);
		vi.mocked(cmdDevices).mockResolvedValue(undefined);

		// Act
		await main();

		// Assert
		expect(cmdDevices).toHaveBeenCalledWith(mockSession, expect.any(Object), undefined, undefined, {
			dumpDeviceId: 'dev-9',
			showSecrets: true,
		});
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
				{ deviceId: undefined, raw: false, showSecrets: false },
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
				{ deviceId: 'washer-1', raw: true, showSecrets: false },
				expect.any(Object),
			);
		});

		it('should call cmdConnectProbe with showSecrets true when --show-secrets true is given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({
				command: 'connect-probe',
				'device-id': 'washer-1',
				raw: 'true',
				'show-secrets': 'true',
			});
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectProbe).toHaveBeenCalledWith(
				PAT_SESSION,
				{ deviceId: 'washer-1', raw: true, showSecrets: true },
				expect.any(Object),
			);
		});

		it('should not add an energy key to the probe options when --energy is absent', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', 'device-id': 'washer-1' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			const options = vi.mocked(cmdConnectProbe).mock.calls[0]?.[1];
			expect(options).toStrictEqual({ deviceId: 'washer-1', raw: false, showSecrets: false });
		});

		it('should pass energy DAILY to cmdConnectProbe when only --energy is given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', energy: 'true' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectProbe).toHaveBeenCalledWith(
				PAT_SESSION,
				expect.objectContaining({ energy: { period: 'DAILY' } }),
				expect.any(Object),
			);
		});

		it('should pass the period and explicit dates to cmdConnectProbe when energy options are given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({
				command: 'connect-probe',
				energy: 'true',
				'energy-period': 'MONTHLY',
				'energy-start': '202501',
				'energy-end': '202503',
			});
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectProbe).toHaveBeenCalledWith(
				PAT_SESSION,
				expect.objectContaining({
					energy: { period: 'MONTHLY', startDate: '202501', endDate: '202503' },
				}),
				expect.any(Object),
			);
		});

		it('should print the allowed periods, set exitCode 1 and skip the probe when --energy-period is invalid', async () => {
			// Arrange
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', energy: 'true', 'energy-period': 'weekly' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);

			// Act
			await main();

			// Assert
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Allowed: DAILY, MONTHLY'));
			expect(process.exitCode).toBe(1);
			expect(cmdConnectProbe).not.toHaveBeenCalled();
			errorSpy.mockRestore();
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

	describe('connect-control command', () => {
		const PAT_SESSION = { country: 'US', personalAccessToken: 'pat-secret-1234567890' };

		it('should print a PAT login hint, set exitCode 1 and skip the control when no PAT session exists', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-control' });
			vi.mocked(loadPatSession).mockReturnValue(null);

			// Act
			await main();

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('No PAT session found. Run `--command login --type pat` first.');
			expect(process.exitCode).toBe(1);
			expect(cmdConnectControl).not.toHaveBeenCalled();
		});

		it('should call cmdConnectControl with dry-run defaults and wait 3 when only device id and send are given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-control', 'device-id': 'w1', send: 'POWER_ON' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectControl).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectControl).toHaveBeenCalledWith(
				PAT_SESSION,
				expect.objectContaining({ deviceId: 'w1', send: 'POWER_ON', yes: false, waitSeconds: 3 }),
				expect.anything(),
			);
		});

		it('should call cmdConnectControl with yes true and waitSeconds 0 when yes and wait are given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({
				command: 'connect-control',
				'device-id': 'w1',
				send: 'START',
				yes: 'true',
				wait: '0',
			});
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectControl).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectControl).toHaveBeenCalledWith(
				PAT_SESSION,
				expect.objectContaining({ yes: true, waitSeconds: 0 }),
				expect.anything(),
			);
		});

		it.each(['abc', '-1'])('should fall back to waitSeconds 3 when wait is %s', async (wait) => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-control', 'device-id': 'w1', send: 'START', wait });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectControl).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectControl).toHaveBeenCalledWith(
				PAT_SESSION,
				expect.objectContaining({ waitSeconds: 3 }),
				expect.anything(),
			);
		});

		it('should report the error and exit 1 when cmdConnectControl rejects', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-control', 'device-id': 'w1', send: 'START' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectControl).mockRejectedValue(new Error('control exploded'));

			// Act
			await main();

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', 'control exploded');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});
	});

	describe('--out option', () => {
		const PAT_SESSION = { country: 'US', personalAccessToken: 'pat-secret-1234567890' };
		let finish: Mock<() => void>;

		beforeEach(() => {
			// Arrange
			finish = vi.fn<() => void>();
			vi.mocked(startOutputCapture).mockReturnValue({ filePath: '/abs/p.txt', finish });
		});

		afterEach(() => {
			process.exitCode = undefined;
		});

		it('should not start output capture when --out is absent', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(startOutputCapture).not.toHaveBeenCalled();
			expect(finish).not.toHaveBeenCalled();
		});

		it('should start capture with the path and meta, then finish once when the probe completes', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({
				command: 'connect-probe',
				out: 'workspace/out/p.txt',
				country: 'KR',
				'show-secrets': 'true',
			});
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(startOutputCapture).toHaveBeenCalledWith('workspace/out/p.txt', {
				command: 'connect-probe',
				country: 'KR',
				showSecrets: true,
			});
			expect(finish).toHaveBeenCalledTimes(1);
		});

		it('should pass unchanged probe options when --out is given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', out: 'x.txt' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockResolvedValue(undefined);

			// Act
			await main();

			// Assert
			expect(cmdConnectProbe).toHaveBeenCalledWith(
				PAT_SESSION,
				{ deviceId: undefined, raw: false, showSecrets: false },
				expect.any(Object),
			);
		});

		it('should print the error, set exitCode 1 and skip the command when startOutputCapture throws', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', out: '' });
			vi.mocked(startOutputCapture).mockImplementation(() => {
				throw new Error('requires a file path');
			});

			// Act
			await main();

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('--out: requires a file path');
			expect(process.exitCode).toBe(1);
			expect(cmdConnectProbe).not.toHaveBeenCalled();
		});

		it('should refuse login with exitCode 1 before any prompt when --out is given', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'login', out: 'x.txt' });

			// Act
			await main();

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not supported for login'));
			expect(process.exitCode).toBe(1);
			expect(cmdLogin).not.toHaveBeenCalled();
			expect(startOutputCapture).not.toHaveBeenCalled();
		});

		it('should finish capture before process.exit(1) when the command rejects', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', out: 'x.txt' });
			vi.mocked(loadPatSession).mockReturnValue(PAT_SESSION);
			vi.mocked(cmdConnectProbe).mockRejectedValue(new Error('boom'));

			// Act
			await main();

			// Assert
			expect(finish.mock.invocationCallOrder[0]).toBeLessThan(processExitSpy.mock.invocationCallOrder[0]);
		});

		it('should finish capture before process.exit(1) when the command is unknown', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'unknown', out: 'x.txt' });

			// Act
			await main();

			// Assert
			expect(finish.mock.invocationCallOrder[0]).toBeLessThan(processExitSpy.mock.invocationCallOrder[0]);
		});

		it('should finish capture on an early return when the PAT session is missing', async () => {
			// Arrange
			vi.mocked(parseArgs).mockReturnValue({ command: 'connect-probe', out: 'x.txt' });
			vi.mocked(loadPatSession).mockReturnValue(null);

			// Act
			await main();

			// Assert
			expect(finish).toHaveBeenCalledTimes(1);
		});
	});
});
