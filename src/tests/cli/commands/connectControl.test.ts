import type { Mock, MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/thinqConnect/thinqConnectApiClient.js', () => ({
	ThinqConnectApiClient: vi.fn(),
}));

import {
	buildConnectControlPayload,
	cmdConnectControl,
	evaluateConnectControlGuards,
	parseConnectControlValue,
} from '../../../cli/commands/connectControl.js';
import type { ConnectProbeSummary } from '../../../cli/commands/connectProbe.js';
import type { CliPatSession } from '../../../cli/types.js';
import { ThinqConnectApiError } from '../../../errors/index.js';
import {
	ThinqConnectApiClient,
	type ThinqConnectResource,
} from '../../../services/thinqConnect/thinqConnectApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

const FAKE_PAT = 'pat-secret-1234567890';
const SESSION: CliPatSession = { country: 'US', personalAccessToken: FAKE_PAT };
const BASE_OPTIONS = { deviceId: 'dev-1', send: 'POWER_ON', yes: false, waitSeconds: 0 };
const ALL_VALUES = ['START', 'STOP', 'POWER_OFF', 'POWER_ON'];

/** `locationName: null` builds a profile with no location block at all. */
function washerProfile(
	allowed: string[] = ALL_VALUES,
	mode: string[] = ['w'],
	locationName: string | null = 'MAIN',
): ThinqConnectResource {
	const location = locationName === null ? {} : { location: { locationName } };
	return {
		...location,
		property: {
			operation: {
				washerOperationMode: { type: 'enum', mode, value: { w: allowed } },
			},
			runState: {
				currentState: { mode: ['r'], value: { r: ['POWER_OFF'] } },
			},
		},
	};
}

function washerState(currentState: string): ThinqConnectResource {
	return { runState: { currentState }, operation: { washerOperationMode: 'POWER_OFF' } };
}

const WRITABLE_SUMMARY: ConnectProbeSummary = {
	profileGroups: ['operation', 'runState'],
	washerOperationMode: { modes: ['w'], writable: true, allowedValues: ALL_VALUES },
	currentState: 'POWER_OFF',
};

function createMockConnectClient(): { getDeviceProfile: Mock; getDeviceState: Mock; controlDevice: Mock } {
	return {
		getDeviceProfile: vi.fn(),
		getDeviceState: vi.fn(),
		controlDevice: vi.fn(),
	};
}

describe('parseConnectControlValue', () => {
	it('should return POWER_ON when the value is POWER_ON', () => {
		// Arrange
		const raw = 'POWER_ON';

		// Act
		const result = parseConnectControlValue(raw);

		// Assert
		expect(result).toEqual({ value: 'POWER_ON' });
	});

	it('should return START when the value is START', () => {
		// Arrange
		const raw = 'START';

		// Act
		const result = parseConnectControlValue(raw);

		// Assert
		expect(result).toEqual({ value: 'START' });
	});

	it('should normalize lower-case start to START when parsing the value', () => {
		// Arrange
		const raw = 'start';

		// Act
		const result = parseConnectControlValue(raw);

		// Assert
		expect(result).toEqual({ value: 'START' });
	});

	it('should normalize padded and lower-case power_on to POWER_ON when parsing the value', () => {
		// Arrange
		const raw = '  power_on  ';

		// Act
		const result = parseConnectControlValue(raw);

		// Assert
		expect(result).toEqual({ value: 'POWER_ON' });
	});

	it.each(['STOP', 'stop', 'POWER_OFF', ' power_off '])(
		'should refuse %j with a not-enabled error when the value is a forbidden command',
		(raw) => {
			// Arrange / Act
			const result = parseConnectControlValue(raw);

			// Assert
			expect(result).not.toHaveProperty('value');
			expect(result).toHaveProperty('error', expect.stringMatching(/not enabled in this step/));
		},
	);

	it('should refuse WAKE_UP with an unknown-value error when the value is not in the allowlist', () => {
		// Arrange
		const raw = 'WAKE_UP';

		// Act
		const result = parseConnectControlValue(raw);

		// Assert
		expect(result).not.toHaveProperty('value');
		expect(result).toHaveProperty('error', expect.stringMatching(/^Unknown value "WAKE_UP"/));
	});

	it.each([
		['empty string', ''],
		['whitespace only', '   '],
		['undefined', undefined],
	])('should refuse %s with a missing-send error when the value is absent', (_label, raw) => {
		// Arrange / Act
		const result = parseConnectControlValue(raw);

		// Assert
		expect(result).not.toHaveProperty('value');
		expect(result).toHaveProperty('error', expect.stringMatching(/^Missing --send/));
	});
});

describe('buildConnectControlPayload', () => {
	it('should return exactly the washerOperationMode operation body when the value is START', () => {
		// Arrange
		const value = 'START';

		// Act
		const payload = buildConnectControlPayload(value);

		// Assert
		expect(payload).toEqual({ operation: { washerOperationMode: 'START' } });
	});

	it('should put location before operation in the serialized body when a locationName is given', () => {
		// Arrange
		const value = 'POWER_ON';

		// Act
		const payload = buildConnectControlPayload(value, 'MAIN');

		// Assert
		expect(JSON.stringify(payload)).toBe(
			'{"location":{"locationName":"MAIN"},"operation":{"washerOperationMode":"POWER_ON"}}',
		);
	});

	it('should pass a different locationName through unchanged when it is MINI', () => {
		// Arrange
		const value = 'START';

		// Act
		const payload = buildConnectControlPayload(value, 'MINI');

		// Assert
		expect(payload).toEqual({ location: { locationName: 'MINI' }, operation: { washerOperationMode: 'START' } });
	});
});

describe('evaluateConnectControlGuards', () => {
	it.each(['POWER_OFF', 'INITIAL', 'END'])(
		'should pass when the profile allows the value and the state is %s',
		(currentState) => {
			// Arrange
			const summary: ConnectProbeSummary = { ...WRITABLE_SUMMARY, currentState };

			// Act
			const reason = evaluateConnectControlGuards('POWER_ON', summary);

			// Assert
			expect(reason).toBeUndefined();
		},
	);

	it('should pass when the state is unknown (state {}) because the washer is likely off', () => {
		// Arrange
		const summary: ConnectProbeSummary = { ...WRITABLE_SUMMARY, currentState: undefined };

		// Act
		const reason = evaluateConnectControlGuards('START', summary);

		// Assert
		expect(reason).toBeUndefined();
	});

	it('should refuse when the profile has no washerOperationMode', () => {
		// Arrange
		const summary: ConnectProbeSummary = { profileGroups: ['airConEnabled'] };

		// Act
		const reason = evaluateConnectControlGuards('START', summary);

		// Assert
		expect(reason).toMatch(/no washerOperationMode/);
	});

	it('should refuse when washerOperationMode is not writable', () => {
		// Arrange
		const summary: ConnectProbeSummary = {
			...WRITABLE_SUMMARY,
			washerOperationMode: { modes: ['r'], writable: false, allowedValues: ALL_VALUES },
		};

		// Act
		const reason = evaluateConnectControlGuards('START', summary);

		// Assert
		expect(reason).toMatch(/not writable/);
	});

	it('should refuse and name the value when the profile does not list it as writable', () => {
		// Arrange
		const summary: ConnectProbeSummary = {
			...WRITABLE_SUMMARY,
			washerOperationMode: { modes: ['w'], writable: true, allowedValues: ['START', 'STOP'] },
		};

		// Act
		const reason = evaluateConnectControlGuards('POWER_ON', summary);

		// Assert
		expect(reason).toMatch(/Profile does not list "POWER_ON" as writable/);
	});

	it.each(['RUNNING', 'PAUSE'])('should refuse to interrupt the cycle when the state is %s', (currentState) => {
		// Arrange
		const summary: ConnectProbeSummary = { ...WRITABLE_SUMMARY, currentState };

		// Act
		const reason = evaluateConnectControlGuards('START', summary);

		// Assert
		expect(reason).toMatch(/refusing to interrupt a cycle/);
	});
});

describe('cmdConnectControl', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockClient: ReturnType<typeof createMockConnectClient>;
	let consoleLogSpy: MockInstance<typeof console.log>;
	let consoleErrorSpy: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockClient = createMockConnectClient();
		mockClient.getDeviceProfile.mockResolvedValue(washerProfile());
		mockClient.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
		mockClient.controlDevice.mockResolvedValue({});
		vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
			return asPartial<ThinqConnectApiClient>(mockClient);
		});
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		process.exitCode = undefined;
	});

	function printedOutput(): string {
		return [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
			.map((call: unknown[]) => call.join(' '))
			.join('\n');
	}

	describe('dry run (no --yes)', () => {
		it('should read profile and state once each and never call controlDevice when yes is false', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: false, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.getDeviceProfile).toHaveBeenCalledTimes(1);
			expect(mockClient.getDeviceState).toHaveBeenCalledTimes(1);
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
		});

		it('should print the exact body and Dry run notice and leave exitCode unset when guards pass', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: false, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).toContain(
				'{"location":{"locationName":"MAIN"},"operation":{"washerOperationMode":"POWER_ON"}}',
			);
			expect(printedOutput()).toContain('Dry run');
			expect(process.exitCode).toBeUndefined();
		});

		it('should refuse without any POST and set exitCode 1 when guards refuse in dry run', async () => {
			// Arrange
			mockClient.getDeviceState.mockResolvedValue(washerState('RUNNING'));
			const options = { ...BASE_OPTIONS, yes: false, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(printedOutput()).toContain('Refused');
			expect(process.exitCode).toBe(1);
		});
	});

	describe('real send (--yes)', () => {
		it('should call controlDevice exactly once with the START payload when guards pass', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice.mock.calls).toEqual([
				['dev-1', { location: { locationName: 'MAIN' }, operation: { washerOperationMode: 'START' } }],
			]);
			expect(mockClient.getDeviceState).toHaveBeenCalledTimes(2);
			expect(printedOutput()).toContain('Before:');
			expect(printedOutput()).toContain('After:');
			expect(printedOutput()).toContain('Accepted by LG');
			expect(process.exitCode).toBeUndefined();
		});

		it('should send when the state is {} (no currentState) because the washer is likely off', async () => {
			// Arrange
			mockClient.getDeviceState.mockResolvedValue({});
			const options = { ...BASE_OPTIONS, yes: true, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice).toHaveBeenCalledTimes(1);
			expect(process.exitCode).toBeUndefined();
		});

		it.each(['RUNNING', 'PAUSE'])(
			'should not call controlDevice and set exitCode 1 when the state is %s',
			async (currentState) => {
				// Arrange
				mockClient.getDeviceState.mockResolvedValue(washerState(currentState));
				const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

				// Act
				await cmdConnectControl(SESSION, options, mockLogger);

				// Assert
				expect(mockClient.controlDevice).not.toHaveBeenCalled();
				expect(printedOutput()).toContain('Refused');
				expect(process.exitCode).toBe(1);
			},
		);

		it('should not call controlDevice and set exitCode 1 when the profile does not list the value as writable', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(washerProfile(['START', 'STOP']));
			const options = { ...BASE_OPTIONS, yes: true, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(printedOutput()).toContain('Refused');
			expect(process.exitCode).toBe(1);
		});

		it('should not call controlDevice and set exitCode 1 when washerOperationMode is not writable', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(washerProfile(ALL_VALUES, ['r']));
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});
	});

	describe('location field in the body', () => {
		it('should send location MAIN with the operation when the profile locationName is MAIN', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: true, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice.mock.calls).toEqual([
				['dev-1', { location: { locationName: 'MAIN' }, operation: { washerOperationMode: 'POWER_ON' } }],
			]);
			expect(process.exitCode).toBeUndefined();
		});

		it('should pass a different profile locationName through when it is MINI', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(washerProfile(ALL_VALUES, ['w'], 'MINI'));
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice.mock.calls).toEqual([
				['dev-1', { location: { locationName: 'MINI' }, operation: { washerOperationMode: 'START' } }],
			]);
		});

		it('should print the final body with the profile location and send nothing when the run is a dry run', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(washerProfile(ALL_VALUES, ['w'], 'MINI'));
			const options = { ...BASE_OPTIONS, yes: false, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(consoleLogSpy).toHaveBeenCalledWith(
				'Body: {"location":{"locationName":"MINI"},"operation":{"washerOperationMode":"POWER_ON"}}',
			);
			expect(consoleLogSpy).toHaveBeenCalledWith('Dry run: nothing sent. Re-run with --yes to send.');
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
		});

		it.each([
			['missing', null],
			['empty string', ''],
		])(
			'should send the old body and print the Location notice when the profile locationName is %s',
			async (_label, locationName) => {
				// Arrange
				mockClient.getDeviceProfile.mockResolvedValue(washerProfile(ALL_VALUES, ['w'], locationName));
				const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

				// Act
				await cmdConnectControl(SESSION, options, mockLogger);

				// Assert
				expect(mockClient.controlDevice.mock.calls).toEqual([
					['dev-1', { operation: { washerOperationMode: 'START' } }],
				]);
				expect(consoleLogSpy).toHaveBeenCalledWith('Location: no locationName in profile; sending without location.');
				expect(process.exitCode).toBeUndefined();
			},
		);
	});

	describe('allowlist refusals before any client is created', () => {
		it.each(['STOP', 'POWER_OFF'])('should not construct a client and set exitCode 1 when send is %s', async (send) => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: true, send };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(ThinqConnectApiClient).not.toHaveBeenCalled();
			expect(mockClient.getDeviceProfile).not.toHaveBeenCalled();
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/not enabled in this step/));
			expect(process.exitCode).toBe(1);
		});

		it.each([
			['empty', ''],
			['whitespace only', '   '],
			['unknown', 'WAKE_UP'],
			['missing', undefined],
		])('should not construct a client and set exitCode 1 when send is %s', async (_label, send) => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: true, send };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(ThinqConnectApiClient).not.toHaveBeenCalled();
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should not construct a client and set exitCode 1 when device id is missing', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, deviceId: undefined, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(ThinqConnectApiClient).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith('Missing --device-id');
			expect(process.exitCode).toBe(1);
		});
	});

	describe('LG failures', () => {
		it('should print Control FAILED, the LG message and the result code and set exitCode 1 when LG rejects with 2302', async () => {
			// Arrange
			mockClient.controlDevice.mockRejectedValue(
				new ThinqConnectApiError('Command is not supported in the current state. (code 2302)', '2302', 400),
			);
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).toContain('Control FAILED');
			expect(printedOutput()).toContain('Command is not supported in the current state. (code 2302)');
			expect(printedOutput()).toContain('LG result code: 2302');
			expect(process.exitCode).toBe(1);
			expect(mockClient.getDeviceState).toHaveBeenCalledTimes(2);
		});

		it('should print the LG result code 2209 and set exitCode 1 when LG rejects with 2209', async () => {
			// Arrange
			mockClient.controlDevice.mockRejectedValue(
				new ThinqConnectApiError('Command timed out on the device. (code 2209)', '2209', 400),
			);
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).toContain('LG result code: 2209');
			expect(process.exitCode).toBe(1);
		});

		it('should print Control FAILED without an LG result code line when the error is a plain Error', async () => {
			// Arrange
			mockClient.controlDevice.mockRejectedValue(new Error('socket hang up'));
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).toContain('Control FAILED: socket hang up');
			expect(printedOutput()).not.toContain('LG result code');
			expect(process.exitCode).toBe(1);
		});

		it('should print After state ERROR and set exitCode 1 when the after-state read fails after a successful send', async () => {
			// Arrange
			mockClient.getDeviceState
				.mockResolvedValueOnce(washerState('POWER_OFF'))
				.mockRejectedValueOnce(new Error('timeout reading state'));
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(mockClient.controlDevice).toHaveBeenCalledTimes(1);
			expect(printedOutput()).toContain('After: state ERROR timeout reading state');
			expect(process.exitCode).toBe(1);
		});

		it('should print Cannot read and not call controlDevice when the profile read rejects', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(new Error('profile unavailable'));
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Cannot read profile/state: profile unavailable');
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should print Control failed and set exitCode 1 when the client constructor throws', async () => {
			// Arrange
			vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
				throw new ThinqConnectApiError('A ThinQ Personal Access Token is required', '1103');
			});
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Control failed:', 'A ThinQ Personal Access Token is required');
			expect(process.exitCode).toBe(1);
		});
	});

	describe('post-send wait', () => {
		it('should read the after-state only after the wait elapses when waitSeconds is greater than zero', async () => {
			// Arrange
			vi.useFakeTimers();
			const options = { ...BASE_OPTIONS, yes: true, send: 'START', waitSeconds: 3 };

			// Act
			const run = cmdConnectControl(SESSION, options, mockLogger);
			await vi.advanceTimersByTimeAsync(2999);
			const stateReadsBeforeWait = mockClient.getDeviceState.mock.calls.length;
			await vi.advanceTimersByTimeAsync(1);
			await run;

			// Assert
			expect(stateReadsBeforeWait).toBe(1);
			expect(mockClient.getDeviceState).toHaveBeenCalledTimes(2);
		});
	});

	describe('secret safety', () => {
		it('should never print the PAT in a dry run', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: false, send: 'POWER_ON' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).not.toContain(FAKE_PAT);
		});

		it('should never print the PAT when the send succeeds', async () => {
			// Arrange
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).not.toContain(FAKE_PAT);
		});

		it('should never print the PAT when the send fails', async () => {
			// Arrange
			mockClient.controlDevice.mockRejectedValue(
				new ThinqConnectApiError('Personal Access Token is invalid or expired. (code 1103)', '1103', 401),
			);
			const options = { ...BASE_OPTIONS, yes: true, send: 'START' };

			// Act
			await cmdConnectControl(SESSION, options, mockLogger);

			// Assert
			expect(printedOutput()).not.toContain(FAKE_PAT);
		});
	});
});
