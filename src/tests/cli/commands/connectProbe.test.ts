import type { Mock, MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/thinqConnect/thinqConnectApiClient.js', () => ({
	ThinqConnectApiClient: vi.fn(),
}));

vi.mock('../../../cli/commands/connectEnergy.js', () => ({
	printConnectEnergy: vi.fn(),
}));

import { printConnectEnergy } from '../../../cli/commands/connectEnergy.js';
import type { ConnectProbeSummary } from '../../../cli/commands/connectProbe.js';
import {
	cmdConnectProbe,
	formatConnectProbeSummary,
	summarizeConnectProbe,
} from '../../../cli/commands/connectProbe.js';
import type { CliPatSession } from '../../../cli/types.js';
import { ThinqConnectApiError } from '../../../errors/index.js';
import {
	ThinqConnectApiClient,
	type ThinqConnectPayload,
	type ThinqConnectResource,
} from '../../../services/thinqConnect/thinqConnectApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

const FAKE_PAT = 'pat-secret-1234567890';
const SESSION: CliPatSession = { country: 'US', personalAccessToken: FAKE_PAT };

const WASHER_PROFILE: ThinqConnectResource = {
	property: {
		operation: {
			washerOperationMode: { type: 'enum', mode: ['w'], value: { w: ['START', 'STOP', 'WAKE_UP'] } },
		},
		remoteControlEnable: {
			remoteControlEnabled: { type: 'boolean', mode: ['r', 'w'] },
		},
		runState: {
			currentState: { mode: ['r'], value: { r: ['POWER_OFF'] } },
		},
	},
};

const WASHER_STATE: ThinqConnectResource = {
	runState: { currentState: 'POWER_OFF' },
	operation: { washerOperationMode: 'STOP' },
	remoteControlEnable: { remoteControlEnabled: false },
};

/** Washer state as returned by GET /devices/{id}/state: a per-location array. */
const WASHER_ARRAY_STATE: ThinqConnectPayload = [
	{ location: { locationName: 'MAIN' }, runState: { currentState: 'INITIAL' } },
];

const WASHER_TWO_LOCATION_STATE: ThinqConnectPayload = [
	{ location: { locationName: 'MAIN' }, runState: { currentState: 'INITIAL' } },
	{ location: { locationName: 'SUB' }, runState: { currentState: 'RUNNING' } },
];

/** Profile with a location array, so the state entry can be matched by locationName. */
const TWO_LOCATION_PROFILE: ThinqConnectPayload = [{ location: { locationName: 'SUB' }, runState: {} }];

const DEVICES = [
	{ deviceId: 'dev-1', deviceInfo: { alias: 'Washer', deviceType: 'DEVICE_WASHER', modelName: 'WM-1' } },
	{ deviceId: 'dev-2', deviceInfo: { alias: 'AC', deviceType: 'DEVICE_AC', modelName: 'AC-1' } },
];

/** Wraps a washer node in `levels` plain objects; the object holding the key sits at depth `levels`. */
function nestedProfile(levels: number): ThinqConnectResource {
	let node: ThinqConnectResource = { washerOperationMode: { mode: ['w'] } };
	for (let i = 0; i < levels; i++) {
		node = { wrap: node };
	}
	return node;
}

function createMockConnectClient(): { getDevices: Mock; getDeviceProfile: Mock; getDeviceState: Mock } {
	return {
		getDevices: vi.fn(),
		getDeviceProfile: vi.fn(),
		getDeviceState: vi.fn(),
	};
}

describe('summarizeConnectProbe', () => {
	it('should report a writable washer mode with allowed values when the profile exposes write mode', () => {
		// Arrange
		const profile = WASHER_PROFILE;

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toEqual({
			modes: ['w'],
			writable: true,
			allowedValues: ['START', 'STOP', 'WAKE_UP'],
		});
		expect(summary.remoteControlEnabled).toEqual({ modes: ['r', 'w'] });
		expect(summary.profileGroups).toEqual(['operation', 'remoteControlEnable', 'runState']);
	});

	it('should report not writable with no allowed values when the washer mode has no write mode', () => {
		// Arrange
		const profile: ThinqConnectResource = {
			property: {
				operation: {
					washerOperationMode: { type: 'enum', mode: ['r'] },
				},
			},
		};

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toEqual({ modes: ['r'], writable: false, allowedValues: [] });
	});

	it('should find the washer node when the profile has no property wrapper', () => {
		// Arrange
		const profile: ThinqConnectResource = {
			washerOperationMode: { mode: ['w'], value: { w: ['START'] } },
		};

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toEqual({ modes: ['w'], writable: true, allowedValues: ['START'] });
		expect(summary.profileGroups).toEqual(['washerOperationMode']);
	});

	it('should find the washer node and list sorted groups when property is a location array', () => {
		// Arrange
		const profile: ThinqConnectResource = {
			property: [{ runState: {} }, { operation: { washerOperationMode: { mode: ['w'], value: { w: ['STOP'] } } } }],
		};

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toEqual({ modes: ['w'], writable: true, allowedValues: ['STOP'] });
		expect(summary.profileGroups).toEqual(['operation', 'runState']);
	});

	it('should leave washerOperationMode undefined when the profile is an AC without a washer node', () => {
		// Arrange
		const profile: ThinqConnectResource = {
			property: { airConEnabled: { type: 'boolean', mode: ['r', 'w'] } },
		};

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toBeUndefined();
		expect(summary.profileGroups).toEqual(['airConEnabled']);
	});

	it('should keep a false remote control state when reading the state', () => {
		// Arrange
		const state = WASHER_STATE;

		// Act
		const summary = summarizeConnectProbe(undefined, state);

		// Assert
		expect(summary.currentState).toBe('POWER_OFF');
		expect(summary.currentOperationMode).toBe('STOP');
		expect(summary.currentRemoteControlEnabled).toBe(false);
	});

	it('should return an empty summary without throwing when profile and state are undefined', () => {
		// Arrange / Act
		const summary = summarizeConnectProbe(undefined, undefined);

		// Assert
		expect(summary).toEqual({ profileGroups: [] });
	});

	it('should find the washer node when it sits exactly at the depth limit', () => {
		// Arrange
		const profile = nestedProfile(6);

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toBeDefined();
	});

	it('should not find the washer node when it sits deeper than the depth limit', () => {
		// Arrange
		const profile = nestedProfile(7);

		// Act
		const summary = summarizeConnectProbe(profile, undefined);

		// Assert
		expect(summary.washerOperationMode).toBeUndefined();
	});
});

describe('summarizeConnectProbe with array state', () => {
	it('should read currentState INITIAL from a MAIN washer array state when no profile is given', () => {
		// Arrange
		const state = WASHER_ARRAY_STATE;

		// Act
		const summary = summarizeConnectProbe(undefined, state);

		// Assert
		expect(summary.currentState).toBe('INITIAL');
	});

	it('should show the currentState line in formatted output when the state is a washer array', () => {
		// Arrange
		const summary = summarizeConnectProbe(undefined, WASHER_ARRAY_STATE);

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines).toContain('  currentState: INITIAL');
	});

	it('should pick the array entry whose locationName matches the profile when two locations exist', () => {
		// Arrange
		const profile = TWO_LOCATION_PROFILE;

		// Act
		const summary = summarizeConnectProbe(profile, WASHER_TWO_LOCATION_STATE);

		// Assert
		expect(summary.currentState).toBe('RUNNING');
	});

	it('should fall back to the first array entry when no location matches the profile', () => {
		// Arrange
		const profile: ThinqConnectPayload = [{ location: { locationName: 'OTHER' }, runState: {} }];

		// Act
		const summary = summarizeConnectProbe(profile, WASHER_TWO_LOCATION_STATE);

		// Assert
		expect(summary.currentState).toBe('INITIAL');
	});

	it('should omit the currentState line without throwing when the state array is empty', () => {
		// Arrange
		const state: ThinqConnectPayload = [];

		// Act
		const summary = summarizeConnectProbe(undefined, state);
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(summary.currentState).toBeUndefined();
		expect(lines.some((line) => line.includes('currentState'))).toBe(false);
	});

	it('should omit the currentState line without throwing when the state is an empty object', () => {
		// Arrange
		const state: ThinqConnectResource = {};

		// Act
		const summary = summarizeConnectProbe(undefined, state);
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(summary.currentState).toBeUndefined();
		expect(lines.some((line) => line.includes('currentState'))).toBe(false);
	});
});

describe('formatConnectProbeSummary', () => {
	it('should format a writable washer with resource groups, remote state and current values', () => {
		// Arrange
		const summary: ConnectProbeSummary = {
			profileGroups: ['operation', 'remoteControlEnable', 'runState'],
			washerOperationMode: { modes: ['w'], writable: true, allowedValues: ['START', 'STOP', 'WAKE_UP'] },
			remoteControlEnabled: { modes: ['r', 'w'] },
			currentRemoteControlEnabled: false,
			currentState: 'POWER_OFF',
			currentOperationMode: 'STOP',
		};

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines).toEqual([
			'  resource groups: operation, remoteControlEnable, runState',
			'  washerOperationMode: writable=yes (mode: w) allowed=START, STOP, WAKE_UP',
			'  remoteControlEnabled: profile mode=r,w current=false',
			'  currentState: POWER_OFF',
			'  current washerOperationMode: STOP',
		]);
	});

	it('should format a non-writable washer with none placeholders when mode and values are empty', () => {
		// Arrange
		const summary: ConnectProbeSummary = {
			profileGroups: ['operation'],
			washerOperationMode: { modes: [], writable: false, allowedValues: [] },
		};

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines).toContain('  washerOperationMode: writable=no (mode: none) allowed=none');
	});

	it('should format the absent washer node as not in profile when washerOperationMode is undefined', () => {
		// Arrange
		const summary: ConnectProbeSummary = { profileGroups: ['airConEnabled'] };

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines).toContain('  washerOperationMode: not in profile (not a washer, or not exposed)');
	});

	it('should format remote control profile modes without a current value when state is unknown', () => {
		// Arrange
		const summary: ConnectProbeSummary = { profileGroups: [], remoteControlEnabled: { modes: ['r', 'w'] } };

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines).toContain('  remoteControlEnabled: profile mode=r,w');
	});

	it('should format remote control current value alone when the profile has no remote control node', () => {
		// Arrange
		const summary: ConnectProbeSummary = { profileGroups: [], currentRemoteControlEnabled: true };

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines).toContain('  remoteControlEnabled: current=true');
	});

	it('should omit remote control and current state lines when absent everywhere', () => {
		// Arrange
		const summary: ConnectProbeSummary = { profileGroups: ['x'] };

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines.some((line) => line.includes('remoteControlEnabled'))).toBe(false);
		expect(lines.some((line) => line.includes('currentState'))).toBe(false);
		expect(lines.some((line) => line.includes('current washerOperationMode'))).toBe(false);
	});

	it('should print resource groups as none when the profile has no groups', () => {
		// Arrange
		const summary: ConnectProbeSummary = { profileGroups: [] };

		// Act
		const lines = formatConnectProbeSummary(summary);

		// Assert
		expect(lines[0]).toBe('  resource groups: (none)');
	});
});

describe('cmdConnectProbe', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockClient: ReturnType<typeof createMockConnectClient>;
	let consoleLogSpy: MockInstance<typeof console.log>;
	let consoleErrorSpy: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockClient = createMockConnectClient();
		vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
			return asPartial<ThinqConnectApiClient>(mockClient);
		});
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		process.exitCode = undefined;
	});

	function printedOutput(): string {
		return consoleLogSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
	}

	describe('device targeting', () => {
		it('should list devices then probe profile and state for each device in order when no device id is given', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(mockClient.getDevices).toHaveBeenCalledTimes(1);
			expect(mockClient.getDeviceProfile.mock.calls).toEqual([['dev-1'], ['dev-2']]);
			expect(mockClient.getDeviceState.mock.calls).toEqual([['dev-1'], ['dev-2']]);
			expect(printedOutput()).toContain('Device: Washer [DEVICE_WASHER] WM-1 (dev-1)');
			expect(printedOutput()).toContain('Device: AC [DEVICE_AC] AC-1 (dev-2)');
		});

		it('should skip the device list and probe only the given device when a device id is set', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false }, mockLogger);

			// Assert
			expect(mockClient.getDevices).not.toHaveBeenCalled();
			expect(mockClient.getDeviceProfile).toHaveBeenCalledWith('washer-1');
			expect(mockClient.getDeviceState).toHaveBeenCalledWith('washer-1');
			expect(printedOutput()).toContain('(no alias) [unknown]');
			expect(printedOutput()).toContain('(washer-1)');
		});

		it('should print the device-list line when devices are visible and the probe succeeds', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([DEVICES[0]]);
			mockClient.getDeviceProfile.mockResolvedValue({});
			mockClient.getDeviceState.mockResolvedValue({});

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('Country: US');
			expect(printedOutput()).toContain('(dev-1)');
		});

		it('should probe the remaining devices when the first device fails and the second succeeds', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile
				.mockRejectedValueOnce(
					new ThinqConnectApiError('Command is not supported in the current state. (code 2302)', '2302', 400),
				)
				.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(mockClient.getDeviceProfile.mock.calls).toEqual([['dev-1'], ['dev-2']]);
			expect(printedOutput()).toContain('Device: AC [DEVICE_AC] AC-1 (dev-2)');
		});

		it('should print a message and skip probing when no devices are visible', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([]);

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(consoleLogSpy).toHaveBeenCalledWith('No devices visible for this token.');
			expect(mockClient.getDeviceProfile).not.toHaveBeenCalled();
			expect(process.exitCode).toBeUndefined();
		});
	});

	describe('raw output', () => {
		it('should print raw profile and state JSON when raw is true', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  raw profile: ');
			expect(printedOutput()).toContain('  raw state: ');
		});

		it('should print the raw washer array state and the currentState line when raw is true', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_ARRAY_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain(`  raw state: ${JSON.stringify(WASHER_ARRAY_STATE, null, 2)}`);
			expect(printedOutput()).toContain('  currentState: INITIAL');
		});

		it('should not print raw profile or state JSON when raw is false', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false }, mockLogger);

			// Assert
			expect(printedOutput()).not.toContain('raw profile');
			expect(printedOutput()).not.toContain('raw state');
		});
	});

	describe('raw device entry', () => {
		const RAW_WASHER_ENTRY = {
			deviceId: 'dev-1',
			groupId: 'grp-1',
			reportable: true,
			deviceInfo: { alias: 'Washer', deviceType: 'DEVICE_WASHER', modelName: 'WM-1' },
		};

		const SECRET_WASHER_ENTRY = {
			deviceId: 'dev-1',
			deviceInfo: { alias: 'Washer', deviceType: 'DEVICE_WASHER', modelName: 'WM-1' },
			serialNo: 'SN1234567890AB12',
			macAddress: 'AABBCCDDEEFF',
			accessToken: 'fake-entry-token-value',
		};

		it('should print the full raw entry and the device header when raw is true and the id is listed', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([RAW_WASHER_ENTRY, DEVICES[1]]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'dev-1', raw: true }, mockLogger);

			// Assert
			expect(mockClient.getDevices).toHaveBeenCalledTimes(1);
			expect(printedOutput()).toContain('Device: Washer [DEVICE_WASHER] WM-1 (dev-1)');
			expect(printedOutput()).toContain(`  raw device: ${JSON.stringify(RAW_WASHER_ENTRY, null, 2)}`);
			expect(printedOutput()).toContain('"groupId": "grp-1"');
			expect(printedOutput()).not.toContain('(device not present in GET /devices)');
		});

		it('should print a fallback entry and the not-present line when the id is not in the list', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([DEVICES[1]]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain(`  raw device: ${JSON.stringify({ deviceId: 'washer-1' }, null, 2)}`);
			expect(printedOutput()).toContain('  (device not present in GET /devices)');
			expect(mockClient.getDeviceProfile).toHaveBeenCalledWith('washer-1');
			expect(mockClient.getDeviceState).toHaveBeenCalledWith('washer-1');
			expect(process.exitCode).toBeUndefined();
		});

		it('should print Device list failed, probe profile and state and set exitCode 1 when getDevices rejects', async () => {
			// Arrange
			mockClient.getDevices.mockRejectedValue(new ThinqConnectApiError('ThinQ Connect request failed: timeout'));
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: true }, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Device list failed:', 'ThinQ Connect request failed: timeout');
			expect(process.exitCode).toBe(1);
			expect(mockClient.getDeviceProfile).toHaveBeenCalledWith('washer-1');
			expect(mockClient.getDeviceState).toHaveBeenCalledWith('washer-1');
			expect(printedOutput()).toContain('  raw device: ');
		});

		it('should print one raw device block per listed device and call getDevices once when no id is given', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: true }, mockLogger);

			// Assert
			expect(mockClient.getDevices).toHaveBeenCalledTimes(1);
			expect(printedOutput().split('  raw device: ').length - 1).toBe(2);
		});

		it('should not call getDevices or print a raw device block when raw is false and the id is set', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false }, mockLogger);

			// Assert
			expect(mockClient.getDevices).not.toHaveBeenCalled();
			expect(printedOutput()).not.toContain('raw device');
		});

		it('should mask serialNo and macAddress and redact the token when showSecrets is unset', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([SECRET_WASHER_ENTRY]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'dev-1', raw: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('************AB12');
			expect(printedOutput()).toContain('********EEFF');
			expect(printedOutput()).not.toContain('SN1234567890AB12');
			expect(printedOutput()).not.toContain('AABBCCDDEEFF');
			expect(printedOutput()).toContain('"accessToken": "[REDACTED]"');
			expect(printedOutput()).not.toContain('fake-entry-token-value');
		});

		it('should show serialNo and macAddress in full and keep the token redacted when showSecrets is true', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([SECRET_WASHER_ENTRY]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'dev-1', raw: true, showSecrets: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('SN1234567890AB12');
			expect(printedOutput()).toContain('AABBCCDDEEFF');
			expect(printedOutput()).toContain('"accessToken": "[REDACTED]"');
			expect(printedOutput()).not.toContain('fake-entry-token-value');
		});

		it('should print the raw device block even when the profile and state requests both fail', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([RAW_WASHER_ENTRY]);
			mockClient.getDeviceProfile.mockRejectedValue(
				new ThinqConnectApiError('ThinQ Connect request failed: socket hang up'),
			);
			mockClient.getDeviceState.mockRejectedValue(
				new ThinqConnectApiError('ThinQ Connect request failed (HTTP 500)', undefined, 500),
			);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'dev-1', raw: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  raw device: ');
			expect(process.exitCode).toBe(1);
		});

		it.each([{ showSecrets: false }, { showSecrets: true }])(
			'should never print the PAT when showSecrets is $showSecrets',
			async ({ showSecrets }) => {
				// Arrange
				mockClient.getDevices.mockResolvedValue([SECRET_WASHER_ENTRY]);
				mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
				mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

				// Act
				await cmdConnectProbe(SESSION, { deviceId: 'dev-1', raw: true, showSecrets }, mockLogger);

				// Assert
				const output = JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
				expect(output).not.toContain(FAKE_PAT);
			},
		);

		it('should only call the GET methods of the client when raw is true and the id is set', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([RAW_WASHER_ENTRY]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'dev-1', raw: true }, mockLogger);

			// Assert
			expect(Object.keys(mockClient).sort()).toEqual(['getDeviceProfile', 'getDeviceState', 'getDevices']);
		});
	});

	describe('partial failures', () => {
		it('should print the profile error, still print the state summary and set exitCode 1 when only profile fails', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(
				new ThinqConnectApiError('Remote control is OFF on the device. (code 2301)', '2301', 400),
			);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  profile: ERROR Remote control is OFF on the device. (code 2301)');
			expect(printedOutput()).toContain('  currentState: POWER_OFF');
			expect(process.exitCode).toBe(1);
		});

		it('should print both error lines and no summary lines and set exitCode 1 when profile and state both fail', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(
				new ThinqConnectApiError('Remote control is OFF on the device. (code 2301)', '2301', 400),
			);
			mockClient.getDeviceState.mockRejectedValue(
				new ThinqConnectApiError('ThinQ Connect request failed (HTTP 500)', undefined, 500),
			);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  profile: ERROR Remote control is OFF on the device. (code 2301)');
			expect(printedOutput()).toContain('  state: ERROR ThinQ Connect request failed (HTTP 500)');
			expect(printedOutput()).not.toContain('resource groups');
			expect(process.exitCode).toBe(1);
		});
	});

	describe('fatal errors', () => {
		it('should print Probe failed and set exitCode 1 without probing when the device list request rejects', async () => {
			// Arrange
			mockClient.getDevices.mockRejectedValue(new ThinqConnectApiError('ThinQ Connect request failed: timeout'));

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Probe failed:', 'ThinQ Connect request failed: timeout');
			expect(process.exitCode).toBe(1);
			expect(mockClient.getDeviceProfile).not.toHaveBeenCalled();
			expect(mockClient.getDeviceState).not.toHaveBeenCalled();
		});

		it('should print Probe failed and set exitCode 1 when the client constructor throws', async () => {
			// Arrange
			vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
				throw new Error('Country is not supported by the LG ThinQ Connect API.');
			});

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'Probe failed:',
				'Country is not supported by the LG ThinQ Connect API.',
			);
			expect(process.exitCode).toBe(1);
			expect(mockClient.getDevices).not.toHaveBeenCalled();
		});
	});

	describe('secret safety', () => {
		it('should never print the PAT when the probe succeeds', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: true }, mockLogger);

			// Assert
			const output = JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
			expect(output).not.toContain(FAKE_PAT);
			expect(process.exitCode).toBeUndefined();
		});

		it('should never print the PAT when the device list request fails with an auth error', async () => {
			// Arrange
			mockClient.getDevices.mockRejectedValue(
				new ThinqConnectApiError(
					'Personal Access Token is invalid or expired. Create a new token. (code 1103)',
					'1103',
					401,
				),
			);

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			const output = JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
			expect(output).not.toContain(FAKE_PAT);
		});

		it('should never print the PAT when the profile and state requests both fail', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(
				new ThinqConnectApiError('ThinQ Connect request failed: socket hang up'),
			);
			mockClient.getDeviceState.mockRejectedValue(
				new ThinqConnectApiError('ThinQ Connect request failed (HTTP 500)', undefined, 500),
			);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false }, mockLogger);

			// Assert
			const output = JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
			expect(output).not.toContain(FAKE_PAT);
		});
	});

	describe('energy option', () => {
		it('should never call the energy printer when the energy option is undefined', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(printConnectEnergy).not.toHaveBeenCalled();
			expect(printedOutput()).not.toContain('energy');
		});

		it('should run the energy printer for the given device when energy is set', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false, energy: { period: 'DAILY' } }, mockLogger);

			// Assert
			expect(printConnectEnergy).toHaveBeenCalledTimes(1);
			expect(printConnectEnergy).toHaveBeenCalledWith(expect.anything(), 'washer-1', { period: 'DAILY' });
		});

		it('should run the energy printer once per listed device, in order, when energy is set', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: false, energy: { period: 'MONTHLY' } }, mockLogger);

			// Assert
			expect(vi.mocked(printConnectEnergy).mock.calls.map((call) => call[1])).toEqual(['dev-1', 'dev-2']);
			expect(printConnectEnergy).toHaveBeenCalledWith(expect.anything(), 'dev-1', { period: 'MONTHLY' });
		});

		it('should skip the energy printer for a device whose profile and state both failed', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(new ThinqConnectApiError('profile down', undefined, 500));
			mockClient.getDeviceState.mockRejectedValue(new ThinqConnectApiError('state down', undefined, 500));

			// Act
			await cmdConnectProbe(SESSION, { deviceId: 'washer-1', raw: false, energy: { period: 'DAILY' } }, mockLogger);

			// Assert
			expect(printConnectEnergy).not.toHaveBeenCalled();
		});
	});

	describe('read-only behavior', () => {
		it('should only call the read methods of the client when probing', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([DEVICES[0]]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectProbe(SESSION, { raw: false }, mockLogger);

			// Assert
			expect(Object.keys(mockClient).sort()).toEqual(['getDeviceProfile', 'getDeviceState', 'getDevices']);
			expect(mockClient.getDevices).toHaveBeenCalledTimes(1);
			expect(mockClient.getDeviceProfile).toHaveBeenCalledTimes(1);
			expect(mockClient.getDeviceState).toHaveBeenCalledTimes(1);
		});
	});
});
