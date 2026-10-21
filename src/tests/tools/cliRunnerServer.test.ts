import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

interface CliArgsResult {
	args?: string[];
	error?: string;
}

interface CliRunnerModule {
	buildCliArgs: (input: object) => CliArgsResult;
	ALLOWED_COMMANDS: string[];
}

// The MCP tool is a CommonJS file outside src/, loaded by path. It only exports pure helpers
// (its stdio server is guarded by require.main === module), so loading it has no side effects.
const loadCjs = createRequire(import.meta.url);

function asCliRunner(value: unknown): CliRunnerModule {
	return value as CliRunnerModule;
}

const cliRunner = asCliRunner(loadCjs('../../../.claude/tools/cli-runner-server.cjs'));

describe('cli-runner-server buildCliArgs', () => {
	describe('connect-control --yes gate', () => {
		it('should add --yes true when command is connect-control and yes is strictly true', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_OFF', yes: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--yes', 'true']));
		});

		it.each(['true', 'yes', 1, false, undefined])(
			'should not add --yes when yes is %j because only a strict boolean true is accepted',
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

		it('should never add --yes for connect-probe even when yes is strictly true', () => {
			// Arrange
			const input = { command: 'connect-probe', deviceId: 'dev-1', raw: true, yes: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeDefined();
			expect(result.args).not.toContain('--yes');
		});
	});

	describe('connect-control legacy send flag', () => {
		it('should drop the legacy boolean send so no --send true is emitted for connect-control', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'START', send: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).not.toContain('true');
			expect(result.args).toEqual(expect.arrayContaining(['--send', 'START']));
			expect(result.args).not.toEqual(expect.arrayContaining(['--send', 'true']));
		});
	});

	describe('connect-control sendValue validation', () => {
		it('should trim and upper-case sendValue into --send when it is padded lower-case power_off', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: ' power_off ' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--send', 'POWER_OFF']));
		});

		it('should refuse STOP with an error naming the supported values when sendValue is STOP', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'STOP' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toBe('Error: sendValue must be one of POWER_ON, POWER_OFF, START (STOP is not supported)');
		});

		it('should refuse an absent sendValue with the same allowed-values error', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toContain('sendValue must be one of');
		});

		it('should refuse connect-control with no deviceId', () => {
			// Arrange
			const input = { command: 'connect-control', sendValue: 'POWER_ON' };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toBeUndefined();
			expect(result.error).toBe('Error: "deviceId" is required for connect-control.');
		});
	});

	describe('connect-control wait clamp', () => {
		it('should clamp wait to 20 when wait is 99', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_ON', wait: 99 };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--wait', '20']));
		});

		it('should pass wait through unchanged when it is below the cap', () => {
			// Arrange
			const input = { command: 'connect-control', deviceId: 'dev-1', sendValue: 'POWER_ON', wait: 5 };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result.args).toEqual(expect.arrayContaining(['--wait', '5']));
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

		it('should build the unchanged legacy devices args when given duid, local and debug', () => {
			// Arrange
			const input = { command: 'devices', duid: 'duid-1', local: true, debug: true };

			// Act
			const result = cliRunner.buildCliArgs(input);

			// Assert
			expect(result).toEqual({
				args: ['--command', 'devices', '--duid', 'duid-1', '--local', 'true', '--debug', 'true'],
			});
		});
	});
});
