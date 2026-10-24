import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface CliArgsResult {
	args?: string[];
	error?: string;
}

interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		properties: Record<string, unknown>;
		required: string[];
	};
}

interface CliRunnerModule {
	buildCliArgs: (input: object) => CliArgsResult;
	ALLOWED_COMMANDS: string[];
	TOOL_DEFINITIONS: ToolDefinition[];
}

// The MCP tool is a CommonJS file outside src/, loaded by path. It only exports pure helpers
// (its stdio server is guarded by require.main === module), so loading it has no side effects.
// Only buildCliArgs / ALLOWED_COMMANDS / TOOL_DEFINITIONS are used; the CLI is never spawned.
const loadCjs = createRequire(import.meta.url);

function asCliRunner(value: unknown): CliRunnerModule {
	return value as CliRunnerModule;
}

const cliRunner = asCliRunner(loadCjs('../../../.claude/tools/cli-runner-server.cjs'));
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const REMOVED_COMMANDS = [
	'status',
	'start',
	'stop',
	'pause',
	'resume',
	'ping',
	'clean-mode',
	'room-info',
	'map-info',
	'legacy-map-info',
	'legacy-map-info-v2',
	'b01-pose-info',
	'scenes',
	'network-info',
	'custom',
];
const DEVICE_ID_COMMANDS = ['connect-probe', 'connect-settings', 'connect-control'];
const INVALID_DEVICE_IDS: unknown[] = [
	'--yes',
	'--out',
	'-x',
	'[object Object]',
	'',
	'a b',
	'a;b',
	'a'.repeat(129),
	42,
];
const VALID_DEVICE_IDS = ['dev-1', 'ABC_123', 'a'.repeat(128)];
const DEVICE_ID_FLAGS: [string, string][] = [
	['dumpDevice', 'dump-device'],
	['dumpSnapshot', 'dump-snapshot'],
	['probeFilter', 'probe-filter'],
];

function connectInput(command: string, deviceId: unknown): object {
	return { command, deviceId, sendValue: 'POWER_ON' };
}

describe('cli-runner-server buildCliArgs', () => {
	describe('ALLOWED_COMMANDS', () => {
		it('should expose exactly the read-only and connect commands', () => {
			// Arrange / Act / Assert
			expect(cliRunner.ALLOWED_COMMANDS).toEqual([
				'devices',
				'energy',
				'connect-probe',
				'connect-control',
				'connect-settings',
				'washer-status',
				'help',
			]);
		});

		it('should not allow washer-control because it can send to a real washer', () => {
			// Arrange
			const input = { command: 'washer-control' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(cliRunner.ALLOWED_COMMANDS).not.toContain('washer-control');
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('unknown or disallowed command');
		});

		it('should build the washer-status args with device and model when both are given', () => {
			// Arrange
			const input = { command: 'washer-status', device: 'dev-1', model: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ args: ['--command', 'washer-status', '--device', 'dev-1', '--model', 'true'] });
		});

		it.each(['--yes', 'a b', ''])('should reject washer-status device %j before spawning', (device) => {
			// Arrange
			const input = { command: 'washer-status', device };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('--device needs a device id');
		});

		it.each(REMOVED_COMMANDS)('should reject removed command "%s" as disallowed', (command) => {
			// Arrange
			const input = { command };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('unknown or disallowed command');
		});

		it('should build --command help when help is requested', () => {
			// Arrange
			const input = { command: 'help' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ args: ['--command', 'help'] });
		});
	});

	describe('login and legacy commands', () => {
		it('should refuse login with the manual-login error', () => {
			// Arrange
			const input = { command: 'login' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('the "login" command is not available through this tool');
		});

		it('should refuse a missing command with the command-required error', () => {
			// Arrange
			const input = {};

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ error: 'Error: "command" is required.' });
		});

		it('should build only --command devices --debug true and ignore removed duid and local when given debug', () => {
			// Arrange
			const input = { command: 'devices', duid: 'duid-1', local: true, debug: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ args: ['--command', 'devices', '--debug', 'true'] });
		});

		it('should ignore the legacy send flag so no --send true is emitted for connect-control', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'START', send: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--send', 'START']));
			expect(result.args).not.toContain('true');
			expect(result.args).not.toEqual(expect.arrayContaining(['--send', 'true']));
		});
	});

	describe('deviceId validation', () => {
		it.each(DEVICE_ID_COMMANDS.flatMap((command) => INVALID_DEVICE_IDS.map((id): [string, unknown] => [command, id])))(
			'should reject %s with invalid deviceId %j before spawning',
			(command, deviceId) => {
				// Arrange
				const input = connectInput(command, deviceId);

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toBeDefined();
			},
		);

		it.each(DEVICE_ID_COMMANDS.flatMap((command) => VALID_DEVICE_IDS.map((id): [string, string] => [command, id])))(
			'should accept %s with valid deviceId %s',
			(command, deviceId) => {
				// Arrange
				const input = connectInput(command, deviceId);

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.error).toBeUndefined();
				expect(result.args).toEqual(expect.arrayContaining(['--device-id', deviceId]));
			},
		);

		it('should keep the required message when connect-control has no deviceId', () => {
			// Arrange
			const input = { command: 'connect-control', sendValue: 'POWER_ON' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toBe('Error: "deviceId" is required for connect-control.');
		});

		it.each([undefined, ''])('should keep the required message when connect-control deviceId is %j', (deviceId) => {
			// Arrange
			const input = connectInput('connect-control', deviceId);

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.error).toBe('Error: "deviceId" is required for connect-control.');
		});
	});

	describe('connect-probe and connect-settings flags', () => {
		it('should add --energy true when connect-probe energy is strictly true', () => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', energy: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--energy', 'true']));
		});

		it.each(['true', 1, false, undefined])('should not add --energy when energy is %j', (energy) => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', energy };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('--energy');
		});

		it('should add --brief true for connect-settings only when brief is strictly true', () => {
			// Arrange
			const input = { command: 'connect-settings', deviceId: 'dev-1', brief: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--brief', 'true']));
		});

		it.each(['true', 1, false, undefined])('should not add --brief when brief is %j', (brief) => {
			// Arrange
			const input = { command: 'connect-settings', deviceId: 'dev-1', brief };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('--brief');
		});

		it('should not forward brief for connect-probe', () => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', brief: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('--brief');
		});

		it('should not forward raw or energy for connect-settings', () => {
			// Arrange
			const input = { command: 'connect-settings', deviceId: 'dev-1', raw: true, energy: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('--raw');
			expect(result.args).not.toContain('--energy');
		});

		it('should not require a deviceId for connect-settings', () => {
			// Arrange
			const input = { command: 'connect-settings' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ args: ['--command', 'connect-settings'] });
		});
	});

	describe('connect-control dry-run guard', () => {
		it('should emit --send but no --yes when yes is absent (dry run)', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_ON' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--send', 'POWER_ON']));
			expect(result.args).not.toContain('--yes');
		});

		it('should add --yes true when yes is strictly true', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_OFF', yes: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--yes', 'true']));
		});

		it.each(['true', 'yes', 1, false, undefined, null])(
			'should not add --yes when yes is %j (only strict true sends)',
			(yes) => {
				// Arrange
				const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_OFF', yes };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeDefined();
				expect(result.args).not.toContain('--yes');
			},
		);

		it.each(['power_on', ' Power_Off ', 'start'])('should accept sendValue "%s" case-insensitively', (sendValue) => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--send', sendValue.trim().toUpperCase()]));
		});

		it.each(['STOP', 'stop ', 'PAUSE', '', undefined])(
			'should refuse sendValue %j with the allowed-values error',
			(sendValue) => {
				// Arrange
				const input = { command: 'connect-control', deviceId: 'dev-1', sendValue };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toBe('Error: sendValue must be one of POWER_ON, POWER_OFF, START (STOP is not supported)');
			},
		);

		it.each([
			[99, '20'],
			[20, '20'],
			[5, '5'],
			[0, '0'],
		])('should pass wait %s as --wait %s clamped to 20', (wait, expected) => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_ON', wait };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--wait', expected]));
		});

		it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, -1, '5', undefined])(
			'should ignore non-finite or negative wait %j',
			(wait) => {
				// Arrange
				const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_ON', wait };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).not.toContain('--wait');
			},
		);
	});

	describe('connect-probe energy window', () => {
		it('should emit explicit DAILY energy flags with YYYYMMDD values', () => {
			// Arrange
			const input = {
				command: 'connect-probe',
				deviceId: 'dev-1',
				energy: true,
				energyPeriod: 'DAILY',
				energyStart: '20260101',
				energyEnd: '20260131',
			};

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(
				expect.arrayContaining(['--energy-period', 'DAILY', '--energy-start', '20260101', '--energy-end', '20260131']),
			);
		});

		it('should emit explicit MONTHLY energy flags with YYYYMM values', () => {
			// Arrange
			const input = {
				command: 'connect-probe',
				deviceId: 'dev-1',
				energy: true,
				energyPeriod: 'MONTHLY',
				energyStart: '202601',
				energyEnd: '202612',
			};

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(
				expect.arrayContaining(['--energy-period', 'MONTHLY', '--energy-start', '202601', '--energy-end', '202612']),
			);
		});

		it('should normalise a lower-case energyPeriod to upper case', () => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', energyPeriod: 'monthly', energyStart: '202601' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--energy-period', 'MONTHLY']));
		});

		it('should validate the start date as DAILY without emitting --energy-period when no period is given', () => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', energyStart: '20260101' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--energy-start', '20260101']));
			expect(result.args).not.toContain('--energy-period');
		});

		it.each(['WEEKLY', 'daily-ish', ''])('should reject energyPeriod %j before spawning', (energyPeriod) => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', energyPeriod, energyStart: '20260101' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toBe('Error: energyPeriod must be one of DAILY, MONTHLY');
		});

		it.each(['2026-01-01', '202601', '20261301', '20260132', '20260100', '2026010', 20260101])(
			'should reject DAILY energyStart %j that is not YYYYMMDD',
			(energyStart) => {
				// Arrange
				const input = { command: 'connect-probe', deviceId: 'dev-1', energyPeriod: 'DAILY', energyStart };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toContain('--energy-start must be YYYYMMDD for DAILY');
			},
		);

		it.each(['20260101', '2026-01', '202613', '202600'])(
			'should reject MONTHLY energyStart %j that is not YYYYMM',
			(energyStart) => {
				// Arrange
				const input = { command: 'connect-probe', deviceId: 'dev-1', energyPeriod: 'MONTHLY', energyStart };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toContain('--energy-start must be YYYYMM for MONTHLY');
			},
		);

		it('should reject a DAILY energyEnd that is not YYYYMMDD', () => {
			// Arrange
			const input = {
				command: 'connect-probe',
				deviceId: 'dev-1',
				energyPeriod: 'DAILY',
				energyStart: '20260101',
				energyEnd: '2026',
			};

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('--energy-end must be YYYYMMDD for DAILY');
		});

		it('should ignore the energy window for connect-settings', () => {
			// Arrange
			const input = { command: 'connect-settings', deviceId: 'dev-1', energyPeriod: 'WEEKLY' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.error).toBeUndefined();
			expect(result.args).not.toContain('--energy-period');
		});
	});

	describe('devices options', () => {
		it.each(DEVICE_ID_FLAGS)('should pass a valid %s id as --%s', (key, flag) => {
			// Arrange
			const input = { command: 'devices', [key]: 'dev-1' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ args: ['--command', 'devices', `--${flag}`, 'dev-1'] });
		});

		it.each(DEVICE_ID_FLAGS.flatMap(([key]) => INVALID_DEVICE_IDS.map((id): [string, unknown] => [key, id])))(
			'should reject invalid %s id %j',
			(key, id) => {
				// Arrange
				const input = { command: 'devices', [key]: id };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toContain('needs a device id');
			},
		);
	});

	describe('energy options', () => {
		it('should emit --device and --keep-alive true for a valid energy request', () => {
			// Arrange
			const input = { command: 'energy', device: 'dev-1', keepAlive: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({ args: ['--command', 'energy', '--device', 'dev-1', '--keep-alive', 'true'] });
		});

		it.each(['true', 1, false])('should not add --keep-alive when keepAlive is %j', (keepAlive) => {
			// Arrange
			const input = { command: 'energy', keepAlive };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('--keep-alive');
		});

		it.each(['--yes', 'a b', ''])('should reject energy device %j', (device) => {
			// Arrange
			const input = { command: 'energy', device };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('--device needs a device id');
		});

		it.each([1, 20])('should accept samples %d at the boundary', (samples) => {
			// Arrange
			const input = { command: 'energy', samples };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(['--command', 'energy', '--samples', String(samples)]);
		});

		it.each([0, 21, 1.5, -1, Number.NaN, '3'])('should reject samples %j outside integer 1..20', (samples) => {
			// Arrange
			const input = { command: 'energy', samples };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toBe('Error: samples must be an integer from 1 to 20.');
		});

		it.each([1, 60, 2.5])('should accept interval %d at or within 1..60 seconds', (interval) => {
			// Arrange
			const input = { command: 'energy', interval };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(['--command', 'energy', '--interval', String(interval)]);
		});

		it.each([0, 61, Number.NaN, Number.POSITIVE_INFINITY, '5'])(
			'should reject interval %j outside 1..60 seconds',
			(interval) => {
				// Arrange
				const input = { command: 'energy', interval };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toBe('Error: interval must be a number of seconds from 1 to 60.');
			},
		);
	});

	describe('showSecrets', () => {
		it('should add --show-secrets true for devices with dumpDevice when showSecrets is true', () => {
			// Arrange
			const input = { command: 'devices', dumpDevice: 'dev-1', showSecrets: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--show-secrets', 'true']));
		});

		it('should add --show-secrets true for connect-probe with raw when showSecrets is true', () => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', raw: true, showSecrets: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--show-secrets', 'true']));
		});

		it.each([
			{ command: 'devices', showSecrets: true },
			{ command: 'devices', dumpSnapshot: 'dev-1', showSecrets: true },
			{ command: 'connect-probe', deviceId: 'dev-1', showSecrets: true },
			{ command: 'connect-settings', deviceId: 'dev-1', raw: true, showSecrets: true },
			{ command: 'energy', showSecrets: true },
			{ command: 'devices', dumpDevice: 'dev-1', showSecrets: 'true' },
		])('should drop showSecrets for input %j', (input) => {
			// Arrange / Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('--show-secrets');
		});
	});

	describe('out path containment', () => {
		it.each(['workspace/x.txt', 'workspace/new-dir/sub/x.txt'])('should accept out %s inside workspace', (out) => {
			// Arrange
			const input = { command: 'devices', out };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.error).toBeUndefined();
			expect(result.args?.[result.args.indexOf('--out') + 1]).toMatch(/[\\/]workspace[\\/].+/);
			expect(result.args?.[result.args.indexOf('--out') + 1]).toMatch(/x\.txt$/);
		});

		it.each(['../x', '/etc/passwd', 'workspace', '~/x', '--out', '', '   '])(
			'should reject out %j outside workspace',
			(out) => {
				// Arrange
				const input = { command: 'devices', out };

				// Act
				const result = cliRunner.buildCliArgs(input);

				// Assert
				expect(result.args).toBeUndefined();
				expect(result.error).toBeDefined();
			},
		);

		it('should resolve a relative out path from the project root, not the cwd', () => {
			// Arrange
			const input = { command: 'help', out: 'workspace/x.txt' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--out', resolve(PROJECT_ROOT, 'workspace', 'x.txt')]));
		});

		// Symlink-escape case skipped: WORKSPACE_DIR is fixed to <project>/workspace inside the .cjs and
		// cannot be redirected to os.tmpdir, and creating a symlink inside workspace would touch the repo.
	});

	describe('TOOL_DEFINITIONS', () => {
		const runCli = cliRunner.TOOL_DEFINITIONS.find((tool) => tool.name === 'RunCli');
		const properties = runCli?.inputSchema.properties ?? {};

		it.each([
			'command',
			'debug',
			'out',
			'showSecrets',
			'deviceId',
			'dumpDevice',
			'dumpSnapshot',
			'probeFilter',
			'device',
			'samples',
			'interval',
			'keepAlive',
			'sendValue',
			'yes',
			'raw',
			'energy',
			'energyPeriod',
			'energyStart',
			'energyEnd',
			'brief',
			'wait',
		])('should list the %s param in the RunCli schema', (param) => {
			// Arrange / Act / Assert
			expect(Object.keys(properties)).toContain(param);
		});

		it.each(['duid', 'local', 'detail', 'method', 'params', 'send'])(
			'should not list the removed %s param in the RunCli schema',
			(param) => {
				// Arrange / Act / Assert
				expect(Object.keys(properties)).not.toContain(param);
			},
		);

		it('should describe connect-control as a dry run unless yes is true', () => {
			// Arrange / Act
			const description = runCli?.description ?? '';

			// Assert
			expect(description).toContain("'connect-control'");
			expect(description).toContain('DRY RUN by default');
			expect(description).toContain("'yes' is true");
		});
	});
});
