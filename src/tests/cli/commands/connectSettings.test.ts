import type { Mock, MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/thinqConnect/thinqConnectApiClient.js', () => ({
	ThinqConnectApiClient: vi.fn(),
}));

import { cmdConnectSettings, formatConnectSettings } from '../../../cli/commands/connectSettings.js';
import type { CliPatSession } from '../../../cli/types.js';
import { ThinqConnectApiError } from '../../../errors/index.js';
import {
	ThinqConnectApiClient,
	type ThinqConnectPayload,
} from '../../../services/thinqConnect/thinqConnectApiClient.js';
import { buildConnectSettingsReport } from '../../../services/thinqConnect/thinqConnectSettings.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

const FAKE_PAT = 'pat-secret-1234567890';
const SESSION: CliPatSession = { country: 'US', personalAccessToken: FAKE_PAT };

const WASHER_RANGE = { max: 30, min: 0, step: 1, except: [] };
const WASHER_STOP_RANGE = { max: 19, min: 3, step: 1, except: [] };

/** Washer profile shaped like the real VCDWL_QEUK dump: property is an ARRAY with one object. */
const WASHER_PROFILE: ThinqConnectPayload = {
	property: [
		{
			runState: {
				currentState: { type: 'enum', mode: ['r'], value: { r: ['REFRESHING', 'RUNNING', 'POWER_OFF', 'END'] } },
			},
			operation: {
				washerOperationMode: { type: 'enum', mode: ['w'], value: { w: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] } },
			},
			detergent: { detergentSetting: 'AUTO' },
			remoteControlEnable: {
				remoteControlEnabled: { type: 'boolean', mode: ['r'], value: { r: [false, true] } },
			},
			timer: {
				remainHour: { type: 'range', mode: ['r'], value: { r: WASHER_RANGE } },
				remainMinute: { type: 'range', mode: ['r'], value: { r: { ...WASHER_RANGE, max: 59 } } },
				totalHour: { type: 'range', mode: ['r'], value: { r: WASHER_RANGE } },
				totalMinute: { type: 'range', mode: ['r'], value: { r: { ...WASHER_RANGE, max: 59 } } },
				relativeHourToStop: {
					type: 'range',
					mode: ['r', 'w'],
					value: { r: WASHER_STOP_RANGE, w: WASHER_STOP_RANGE },
				},
				relativeMinuteToStop: { type: 'range', mode: ['r'], value: { r: WASHER_RANGE } },
			},
			location: { locationName: 'MAIN' },
			cycle: { cycleCount: { type: 'number', mode: ['r'] } },
		},
	],
};

/** Washer state shaped like the real dump: state is an ARRAY per location. */
const WASHER_STATE: ThinqConnectPayload = [
	{
		runState: { currentState: 'POWER_OFF' },
		remoteControlEnable: { remoteControlEnabled: false },
		timer: {
			remainHour: 0,
			remainMinute: 0,
			relativeHourToStop: 0,
			relativeMinuteToStop: 0,
			totalHour: 1,
			totalMinute: 58,
		},
		cycle: { cycleCount: 15 },
		location: { locationName: 'MAIN' },
	},
];

const AC_RANGE_C = { min: 16, max: 30, step: 0.5, except: [] };
const AC_RANGE_F = { min: 60, max: 86, step: 1, except: [] };

/** AC profile shaped like RAC_056905_WW: property is an OBJECT. */
const AC_PROFILE: ThinqConnectPayload = {
	property: {
		runState: { currentState: { type: 'enum', mode: ['r'], value: { r: ['NORMAL', 'ERROR'] } } },
		temperature: {
			currentTemperature: { type: 'number', mode: ['r'] },
			unit: { type: 'enum', mode: ['r'], value: { r: ['C'] } },
			targetTemperature: { type: 'range', mode: ['r', 'w'], value: { r: AC_RANGE_C, w: AC_RANGE_C } },
		},
		temperatureInUnits: [
			{
				unit: 'C',
				targetTemperature: { type: 'range', mode: ['r'], value: { r: AC_RANGE_C } },
			},
			{
				unit: 'F',
				targetTemperature: { type: 'range', mode: ['r'], value: { r: AC_RANGE_F } },
			},
		],
	},
};

const AC_STATE: ThinqConnectPayload = {
	runState: { currentState: 'NORMAL' },
	temperature: { currentTemperature: 30, unit: 'C', targetTemperature: 27 },
	temperatureInUnits: [
		{ unit: 'C', targetTemperature: 27 },
		{ unit: 'F', targetTemperature: 80 },
	],
};

const WASHER_DEVICE = {
	deviceId: 'dev-1',
	deviceInfo: { alias: 'Washer', deviceType: 'DEVICE_WASHER', modelName: 'VCDWL_QEUK' },
};
const AC_DEVICE = {
	deviceId: 'dev-2',
	deviceInfo: { alias: 'Study', deviceType: 'DEVICE_AIR_CONDITIONER', modelName: 'RAC_056905_WW' },
};
const DEVICES = [WASHER_DEVICE, AC_DEVICE];

const WASHER_COURSE_LINE =
	'  courses: no course settings in the ThinQ Connect profile for this model (V1 legacy API has them)';

function createMockConnectClient(): Record<
	'getDevices' | 'getDeviceProfile' | 'getDeviceState' | 'controlDevice' | 'getEnergyProfile' | 'getEnergyUsage',
	Mock
> {
	return {
		getDevices: vi.fn(),
		getDeviceProfile: vi.fn(),
		getDeviceState: vi.fn(),
		controlDevice: vi.fn(),
		getEnergyProfile: vi.fn(),
		getEnergyUsage: vi.fn(),
	};
}

describe('formatConnectSettings', () => {
	it('should print the MAIN location, runState group, current state, fixed detergent and cycle count for a washer', () => {
		// Arrange
		const report = buildConnectSettingsReport(WASHER_PROFILE, WASHER_STATE);

		// Act
		const lines = formatConnectSettings(report);

		// Assert
		expect(lines).toContain('  location MAIN');
		expect(lines).toContain('    [runState]');
		expect(lines.some((line) => line.includes('currentState') && line.includes('= POWER_OFF'))).toBe(true);
		expect(lines).toContain('      detergentSetting  fixed  = AUTO');
		expect(lines.some((line) => line.includes('cycleCount') && line.includes('= 15'))).toBe(true);
	});

	it('should print the temperatureInUnits C and F groups and the target temperature with its unit for the AC', () => {
		// Arrange
		const report = buildConnectSettingsReport(AC_PROFILE, AC_STATE);

		// Act
		const lines = formatConnectSettings(report);

		// Assert
		expect(lines).toContain('    [temperatureInUnits C]');
		expect(lines).toContain('    [temperatureInUnits F]');
		expect(lines.some((line) => line.includes('targetTemperature') && line.includes('= 27 C'))).toBe(true);
		expect(lines.some((line) => line.includes('targetTemperature') && line.includes('= 80 F'))).toBe(true);
	});

	it('should align the value column of every row in a group', () => {
		// Arrange
		const report = buildConnectSettingsReport(WASHER_PROFILE, WASHER_STATE);

		// Act
		const lines = formatConnectSettings(report);
		const timerStart = lines.indexOf('    [timer]') + 1;
		const timerRows = lines.slice(timerStart, timerStart + 6);
		const valueColumns = timerRows.map((line) => line.indexOf('= '));

		// Assert
		expect(new Set(valueColumns).size).toBe(1);
		expect(lines).toContain('      relativeMinuteToStop  r   = 0  (0..30 step 1)');
	});

	it('should print a dash for a row whose current value is undefined', () => {
		// Arrange
		const report = buildConnectSettingsReport(WASHER_PROFILE, WASHER_STATE);

		// Act
		const lines = formatConnectSettings(report);

		// Assert
		expect(lines.some((line) => line.includes('washerOperationMode') && line.includes('= -'))).toBe(true);
	});

	it.each([
		{ label: 'array', value: ['a', 'b'], expected: '= ["a","b"]' },
		{ label: 'object', value: { k: 1 }, expected: '= {"k":1}' },
	])('should JSON-stringify a $label current value', ({ value, expected }) => {
		// Arrange
		const profile: ThinqConnectPayload = {
			property: { misc: { thing: { type: 'enum', mode: ['r'], value: { r: ['A'] } } } },
		};
		const report = buildConnectSettingsReport(profile, { misc: { thing: value } });

		// Act
		const lines = formatConnectSettings(report);

		// Assert
		expect(lines.some((line) => line.includes(expected))).toBe(true);
	});
});

describe('cmdConnectSettings', () => {
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

	function allOutput(): string {
		return JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
	}

	describe('device targeting', () => {
		it('should list devices once then read profile and state per device in sequence when no device id is given', async () => {
			// Arrange
			const calls: string[] = [];
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockImplementation((id: string) => {
				calls.push(`profile:${id}`);
				return Promise.resolve(id === 'dev-1' ? WASHER_PROFILE : AC_PROFILE);
			});
			mockClient.getDeviceState.mockImplementation((id: string) => {
				calls.push(`state:${id}`);
				return Promise.resolve(id === 'dev-1' ? WASHER_STATE : AC_STATE);
			});

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(mockClient.getDevices).toHaveBeenCalledTimes(1);
			expect(calls).toEqual(['profile:dev-1', 'state:dev-1', 'profile:dev-2', 'state:dev-2']);
		});

		it('should print the device header and the courses line for the washer only', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockImplementation((id: string) =>
				Promise.resolve(id === 'dev-1' ? WASHER_PROFILE : AC_PROFILE),
			);
			mockClient.getDeviceState.mockImplementation((id: string) =>
				Promise.resolve(id === 'dev-1' ? WASHER_STATE : AC_STATE),
			);

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('Device: Washer [DEVICE_WASHER] VCDWL_QEUK (dev-1)');
			expect(printedOutput()).toContain('Device: Study [DEVICE_AIR_CONDITIONER] RAC_056905_WW (dev-2)');
			expect(printedOutput()).toContain(WASHER_COURSE_LINE);
			expect(printedOutput().split('courses:').length - 1).toBe(1);
		});

		it('should process only the listed device when a device id is given and listed', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-1', brief: true }, mockLogger);

			// Assert
			expect(mockClient.getDeviceProfile.mock.calls).toEqual([['dev-1']]);
			expect(mockClient.getDeviceState.mock.calls).toEqual([['dev-1']]);
			expect(printedOutput()).not.toContain('(device not present in GET /devices)');
		});

		it('should print the not-present line and still read profile and state when the device id is not listed', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([AC_DEVICE]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-9', brief: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  (device not present in GET /devices)');
			expect(mockClient.getDeviceProfile).toHaveBeenCalledWith('dev-9');
			expect(mockClient.getDeviceState).toHaveBeenCalledWith('dev-9');
		});

		it('should warn on stdout, read the given device by id and keep the exit code unset when the device list fails with a device id', async () => {
			// Arrange
			mockClient.getDevices.mockRejectedValue(new ThinqConnectApiError('ThinQ Connect request failed: timeout'));
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-1', brief: true }, mockLogger);

			// Assert
			expect(printedOutput()).toContain(
				'Warning: device list failed, reading by id only: ThinQ Connect request failed: timeout',
			);
			expect(mockClient.getDeviceProfile).toHaveBeenCalledWith('dev-1');
			expect(process.exitCode).toBeUndefined();
		});

		it('should print Settings failed, set exitCode 1 and skip profile when the device list fails without a device id', async () => {
			// Arrange
			mockClient.getDevices.mockRejectedValue(new ThinqConnectApiError('ThinQ Connect request failed: timeout'));

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Settings failed:', 'ThinQ Connect request failed: timeout');
			expect(process.exitCode).toBe(1);
			expect(mockClient.getDeviceProfile).not.toHaveBeenCalled();
		});

		it('should print the no-devices message and leave the exit code unset when the list is empty', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([]);

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(consoleLogSpy).toHaveBeenCalledWith('No devices visible for this token.');
			expect(mockClient.getDeviceProfile).not.toHaveBeenCalled();
			expect(process.exitCode).toBeUndefined();
		});
	});

	describe('raw output', () => {
		it('should print raw profile and raw state JSON when brief is false', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-1', brief: false }, mockLogger);

			// Assert
			expect(printedOutput()).toContain(`  raw profile: ${JSON.stringify(WASHER_PROFILE, null, 2)}`);
			expect(printedOutput()).toContain(`  raw state: ${JSON.stringify(WASHER_STATE, null, 2)}`);
		});

		it('should print neither raw JSON block when brief is true', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-1', brief: true }, mockLogger);

			// Assert
			expect(printedOutput()).not.toContain('raw profile');
			expect(printedOutput()).not.toContain('raw state');
			expect(printedOutput()).toContain('  settings:');
		});
	});

	describe('partial and full failures', () => {
		it('should print the profile error, the raw state and set exitCode 1 when only the profile fails', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(new ThinqConnectApiError('boom', undefined, 500));
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-1', brief: false }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  profile: ERROR boom');
			expect(printedOutput()).toContain(`  raw state: ${JSON.stringify(WASHER_STATE, null, 2)}`);
			expect(process.exitCode).toBe(1);
		});

		it('should print both error lines, skip the device settings block and set exitCode 1 when profile and state both fail', async () => {
			// Arrange
			mockClient.getDeviceProfile.mockRejectedValue(new ThinqConnectApiError('profile down', undefined, 500));
			mockClient.getDeviceState.mockRejectedValue(new ThinqConnectApiError('state down', undefined, 500));

			// Act
			await cmdConnectSettings(SESSION, { deviceId: 'dev-1', brief: false }, mockLogger);

			// Assert
			expect(printedOutput()).toContain('  profile: ERROR profile down');
			expect(printedOutput()).toContain('  state: ERROR state down');
			expect(printedOutput()).not.toContain('  settings:');
			expect(process.exitCode).toBe(1);
		});

		it('should continue to the next device when the first device fails completely', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile
				.mockRejectedValueOnce(new ThinqConnectApiError('profile down', undefined, 500))
				.mockResolvedValue(AC_PROFILE);
			mockClient.getDeviceState
				.mockRejectedValueOnce(new ThinqConnectApiError('state down', undefined, 500))
				.mockResolvedValue(AC_STATE);

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(mockClient.getDeviceProfile.mock.calls).toEqual([['dev-1'], ['dev-2']]);
			expect(printedOutput()).toContain('Device: Study [DEVICE_AIR_CONDITIONER] RAC_056905_WW (dev-2)');
			expect(process.exitCode).toBe(1);
		});
	});

	describe('fatal errors', () => {
		it('should print Settings failed and set exitCode 1 without any network call when the client constructor throws', async () => {
			// Arrange
			vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
				throw new Error('Personal Access Token format is invalid.');
			});

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Settings failed:', 'Personal Access Token format is invalid.');
			expect(process.exitCode).toBe(1);
			expect(mockClient.getDevices).not.toHaveBeenCalled();
		});
	});

	describe('secret safety and read-only behavior', () => {
		it('should never print the PAT in any console call', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue(DEVICES);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { brief: false }, mockLogger);

			// Assert
			expect(allOutput()).not.toContain(FAKE_PAT);
		});

		it('should never print the PAT when the device list fails', async () => {
			// Arrange
			mockClient.getDevices.mockRejectedValue(
				new ThinqConnectApiError('Personal Access Token is invalid or expired. (code 1103)', '1103', 401),
			);

			// Act
			await cmdConnectSettings(SESSION, { brief: true }, mockLogger);

			// Assert
			expect(allOutput()).not.toContain(FAKE_PAT);
		});

		it('should only call the GET methods of the client and never the control or energy methods', async () => {
			// Arrange
			mockClient.getDevices.mockResolvedValue([WASHER_DEVICE]);
			mockClient.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);
			mockClient.getDeviceState.mockResolvedValue(WASHER_STATE);

			// Act
			await cmdConnectSettings(SESSION, { brief: false }, mockLogger);

			// Assert
			expect(mockClient.getDevices).toHaveBeenCalledTimes(1);
			expect(mockClient.getDeviceProfile).toHaveBeenCalledTimes(1);
			expect(mockClient.getDeviceState).toHaveBeenCalledTimes(1);
			expect(mockClient.controlDevice).not.toHaveBeenCalled();
			expect(mockClient.getEnergyProfile).not.toHaveBeenCalled();
			expect(mockClient.getEnergyUsage).not.toHaveBeenCalled();
		});
	});
});
