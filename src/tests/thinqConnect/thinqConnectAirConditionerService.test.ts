import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import { readAirConditionerProfile } from '../../services/thinqConnect/thinqConnectAirConditioner.js';
import type { ThinqConnectPayload } from '../../services/thinqConnect/thinqConnectApiClient.js';
import {
	THINQ_CONNECT_AC_POST_COMMAND_REFRESH_DELAY_MS,
	type ThinqConnectAirConditioner,
	ThinqConnectAirConditionerService,
} from '../../thinqConnect/thinqConnectAirConditionerService.js';
import { createMockLogger } from '../helpers/testUtils.js';
import {
	BEDROOM_PROFILE,
	BEDROOM_STATE,
	ERROR_STATE,
	FAHRENHEIT_PROFILE,
	FAHRENHEIT_STATE,
	STUDY_PROFILE,
	STUDY_PROFILE_FULL,
	STUDY_STATE,
	STUDY_STATE_FAHRENHEIT,
} from '../helpers/thinqConnectAirConditionerFixtures.js';

const PAT_SENTINEL = 'pat-sentinel-do-not-log-1234567890';

function createMockClient() {
	return {
		getDevices: vi.fn(),
		getDeviceProfile: vi.fn(),
		getDeviceState: vi.fn(),
		controlDevice: vi.fn(),
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function buildStudyAc(overrides: Partial<ThinqConnectAirConditioner> = {}): ThinqConnectAirConditioner {
	return {
		deviceId: 'study-ac',
		name: 'Study Room AC',
		profile: readAirConditionerProfile(STUDY_PROFILE),
		...overrides,
	};
}

function buildBedroomAc(overrides: Partial<ThinqConnectAirConditioner> = {}): ThinqConnectAirConditioner {
	return {
		deviceId: 'bedroom-ac',
		name: 'Bedroom AC',
		profile: readAirConditionerProfile(BEDROOM_PROFILE),
		...overrides,
	};
}

describe('ThinqConnectAirConditionerService push refresh and poll interval', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let client: ReturnType<typeof createMockClient>;
	let service: ThinqConnectAirConditionerService;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		logger = createMockLogger();
		client = createMockClient();
		client.getDeviceState.mockResolvedValue(STUDY_STATE);
		client.controlDevice.mockResolvedValue({});
		service = new ThinqConnectAirConditionerService(client, logger);
	});

	afterEach(() => {
		service.stopPolling();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe('refreshState', () => {
		it('should read the state once and call the registered listener with it', async () => {
			// Arrange
			const listener = vi.fn();
			service.startPolling(60_000, [], listener);

			// Act
			await service.refreshState(buildStudyAc());

			// Assert
			expect(client.getDeviceState).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith('study-ac', expect.objectContaining({ powerOn: true }));
		});

		it('should still read the state and resolve without throwing when no listener is registered', async () => {
			// Arrange & Act
			const result = service.refreshState(buildStudyAc());

			// Assert
			await expect(result).resolves.toBeUndefined();
			expect(client.getDeviceState).toHaveBeenCalledWith('study-ac');
		});

		it('should log a warn with the device id and not call the listener when the read fails', async () => {
			// Arrange
			client.getDeviceState.mockRejectedValue(new Error('offline'));
			const listener = vi.fn();
			service.startPolling(60_000, [], listener);

			// Act
			await service.refreshState(buildStudyAc());

			// Assert
			expect(logger.warn).toHaveBeenCalledWith('ThinQ Connect: push refresh failed for study-ac: offline');
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe('setPollInterval', () => {
		it('should do nothing when polling has not started', async () => {
			// Arrange & Act
			service.setPollInterval(10_000, true);
			await vi.advanceTimersByTimeAsync(20_000);

			// Assert
			expect(vi.getTimerCount()).toBe(0);
			expect(client.getDeviceState).not.toHaveBeenCalled();
		});

		it('should do nothing after polling was stopped', async () => {
			// Arrange
			service.startPolling(60_000, [buildStudyAc()], vi.fn());
			service.stopPolling();

			// Act
			service.setPollInterval(1_000, true);
			await vi.advanceTimersByTimeAsync(5_000);

			// Assert
			expect(client.getDeviceState).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		});

		it('should replace only the interval so the next tick follows the new interval', async () => {
			// Arrange
			service.startPolling(60_000, [buildStudyAc()], vi.fn());
			await vi.advanceTimersByTimeAsync(0);

			// Act
			service.setPollInterval(10_000);
			const timersAfterChange = vi.getTimerCount();
			await vi.advanceTimersByTimeAsync(40_000);

			// Assert
			expect(timersAfterChange).toBe(1);
			expect(client.getDeviceState).toHaveBeenCalledTimes(5);
		});

		it('should read immediately when pollNow is true', async () => {
			// Arrange
			service.startPolling(60_000, [buildStudyAc()], vi.fn());
			await vi.advanceTimersByTimeAsync(0);

			// Act
			service.setPollInterval(60_000, true);
			await vi.advanceTimersByTimeAsync(0);

			// Assert
			expect(client.getDeviceState).toHaveBeenCalledTimes(2);
		});

		it('should keep the pending post-command refresh when the interval changes', async () => {
			// Arrange
			const listener = vi.fn();
			const ac = buildBedroomAc();
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);
			service.startPolling(60_000, [], listener);
			await service.setPower(ac, true);

			// Act
			service.setPollInterval(60_000);
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_AC_POST_COMMAND_REFRESH_DELAY_MS);

			// Assert
			expect(listener).toHaveBeenCalledWith('bedroom-ac', expect.anything());
		});
	});
});

describe('ThinqConnectAirConditionerService', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let client: ReturnType<typeof createMockClient>;
	let service: ThinqConnectAirConditionerService;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		client = createMockClient();
		client.getDeviceState.mockResolvedValue(STUDY_STATE);
		client.controlDevice.mockResolvedValue({});
		service = new ThinqConnectAirConditionerService(client, logger);
	});

	describe('discoverAirConditioners', () => {
		it('should return only DEVICE_AIR_CONDITIONER devices and ignore washers and refrigerators', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'study-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Study Room AC' } },
				{ deviceId: 'washer', deviceInfo: { deviceType: 'DEVICE_WASHER' } },
				{ deviceId: 'fridge', deviceInfo: { deviceType: 'DEVICE_REFRIGERATOR' } },
			]);
			client.getDeviceProfile.mockResolvedValue(STUDY_PROFILE);

			// Act
			const result = await service.discoverAirConditioners();

			// Assert
			expect(result.map((ac) => ac.deviceId)).toEqual(['study-ac']);
			expect(client.getDeviceProfile).toHaveBeenCalledTimes(1);
			expect(client.getDeviceProfile).toHaveBeenCalledWith('study-ac');
		});

		it('should use the trimmed alias as the name when the alias is set', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{
					deviceId: 'study-ac',
					deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: '  Study Room AC  ', modelName: 'M1' },
				},
			]);
			client.getDeviceProfile.mockResolvedValue(STUDY_PROFILE);

			// Act
			const [ac] = await service.discoverAirConditioners();

			// Assert
			expect(ac?.name).toBe('Study Room AC');
		});

		it('should fall back to the model name when the alias is blank', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{
					deviceId: 'study-ac',
					deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: '   ', modelName: 'RAC_056905_WW' },
				},
			]);
			client.getDeviceProfile.mockResolvedValue(STUDY_PROFILE);

			// Act
			const [ac] = await service.discoverAirConditioners();

			// Assert
			expect(ac?.name).toBe('RAC_056905_WW');
		});

		it('should fall back to LG Air Conditioner when neither alias nor model name is set', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'study-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER' } },
			]);
			client.getDeviceProfile.mockResolvedValue(STUDY_PROFILE);

			// Act
			const [ac] = await service.discoverAirConditioners();

			// Assert
			expect(ac?.name).toBe('LG Air Conditioner');
		});

		it('should parse the profile and fill initialState from the device state', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'study-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Study Room AC' } },
			]);
			client.getDeviceProfile.mockResolvedValue(STUDY_PROFILE);
			client.getDeviceState.mockResolvedValue(STUDY_STATE);

			// Act
			const [ac] = await service.discoverAirConditioners();

			// Assert
			expect(ac?.profile.hasFilterInfo).toBe(true);
			expect(ac?.initialState).toMatchObject({ powerOn: true, currentTemperatureC: 30, targetTemperatureC: 27 });
		});

		it('should skip a device whose profile rejects and still return the other device', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'broken-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Broken' } },
				{ deviceId: 'study-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Study Room AC' } },
			]);
			client.getDeviceProfile.mockImplementation(async (deviceId: string) => {
				if (deviceId === 'broken-ac') {
					throw new Error('profile unavailable');
				}
				return STUDY_PROFILE;
			});

			// Act
			const result = await service.discoverAirConditioners();

			// Assert
			expect(result.map((ac) => ac.deviceId)).toEqual(['study-ac']);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('broken-ac'));
		});

		it('should keep the device with undefined initialState when the state read rejects', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'study-ac', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Study Room AC' } },
			]);
			client.getDeviceProfile.mockResolvedValue(STUDY_PROFILE);
			client.getDeviceState.mockRejectedValue(new Error('state unavailable'));

			// Act
			const result = await service.discoverAirConditioners();

			// Assert
			expect(result).toHaveLength(1);
			expect(result[0]?.initialState).toBeUndefined();
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('state unavailable'));
		});
	});

	describe('readState', () => {
		it('should return Celsius values, the remaining filter percent and the power state for the Study Room state', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(STUDY_STATE);

			// Act
			const state = await service.readState(buildStudyAc());

			// Assert
			expect(state).toMatchObject({
				powerOn: true,
				currentTemperatureC: 30,
				targetTemperatureC: 27,
				filterRemainingPercent: 94,
			});
		});

		it('should convert an F-unit state to Celsius for the current and target temperatures', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(STUDY_STATE_FAHRENHEIT);

			// Act
			const state = await service.readState(buildStudyAc());

			// Assert
			expect(state.currentTemperatureC).toBeCloseTo(30, 2);
			expect(state.targetTemperatureC).toBeCloseTo(26.67, 2);
			expect(state.temperatureUnit).toBe('F');
		});
	});

	describe('setPower', () => {
		it('should send POWER_ON once and report sent with powerOn true when the AC is off', async () => {
			// Arrange
			const ac = buildBedroomAc();
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);

			// Act
			const outcome = await service.setPower(ac, true);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
			expect(client.controlDevice).toHaveBeenCalledWith('bedroom-ac', {
				operation: { airConOperationMode: 'POWER_ON' },
			});
			expect(outcome).toMatchObject({ status: 'sent', state: { powerOn: true } });
		});

		it('should report noop and send nothing when the AC is already on', async () => {
			// Arrange
			const ac = buildStudyAc();

			// Act
			const outcome = await service.setPower(ac, true);

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse and list the allowed values when the profile lacks POWER_ON', async () => {
			// Arrange
			const ac = buildBedroomAc({
				profile: {
					...readAirConditionerProfile(BEDROOM_PROFILE),
					power: { writable: true, readValues: [], writeValues: ['POWER_OFF'] },
				},
			});
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);

			// Act
			const outcome = await service.setPower(ac, true);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining('allowed: POWER_OFF') });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should report failed without sending or throwing when the state read rejects', async () => {
			// Arrange
			client.getDeviceState.mockRejectedValue(new Error('network down'));

			// Act
			const outcome = await service.setPower(buildStudyAc(), false);

			// Assert
			expect(outcome).toMatchObject({ status: 'failed', error: 'network down', state: {} });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should report failed with the API error text and the fresh state when controlDevice rejects', async () => {
			// Arrange
			const ac = buildBedroomAc();
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);
			client.controlDevice.mockRejectedValue(new ThinqConnectApiError('Device is offline', '1404', 404));

			// Act
			const outcome = await service.setPower(ac, true);

			// Assert
			expect(outcome).toMatchObject({ status: 'failed', error: 'Device is offline', state: { powerOn: false } });
		});

		it('should refuse with an unknown-state reason when powerOn is missing from the state', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({});

			// Act
			const outcome = await service.setPower(buildStudyAc(), false);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining('unknown') });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('in-flight guard', () => {
		it('should refuse a second command while the first is pending and run a new command after it resolves', async () => {
			// Arrange
			const ac = buildBedroomAc();
			const pendingRead = deferred<ThinqConnectPayload>();
			client.getDeviceState.mockReturnValueOnce(pendingRead.promise);
			const first = service.setPower(ac, true);

			// Act
			const second = await service.setPower(ac, false);
			pendingRead.resolve(BEDROOM_STATE);
			await first;
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);
			const third = await service.setPower(ac, true);

			// Assert
			expect(second).toMatchObject({ status: 'refused', reason: expect.stringContaining('already in progress') });
			expect(third.status).toBe('sent');
			expect(client.controlDevice).toHaveBeenCalledTimes(2);
		});
	});

	describe('setCoolMode', () => {
		it('should send only POWER_ON when the AC is off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);

			// Act
			const outcome = await service.setCoolMode(buildBedroomAc());

			// Assert
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
			expect(client.controlDevice).toHaveBeenCalledWith('bedroom-ac', {
				operation: { airConOperationMode: 'POWER_ON' },
			});
			expect(outcome.status).toBe('sent');
		});

		it('should send the COOL job mode payload when on in FAN mode', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({ ...STUDY_STATE, airConJobMode: { currentJobMode: 'FAN' } });

			// Act
			const outcome = await service.setCoolMode(buildStudyAc());

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', { airConJobMode: { currentJobMode: 'COOL' } });
			expect(outcome).toMatchObject({ status: 'sent', state: { jobMode: 'COOL' } });
		});

		it('should report noop when on and already in COOL', async () => {
			// Arrange & Act
			const outcome = await service.setCoolMode(buildStudyAc());

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when on but the job mode is unknown', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({ operation: { airConOperationMode: 'POWER_ON' } });

			// Act
			const outcome = await service.setCoolMode(buildStudyAc());

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the profile does not list COOL as writable', async () => {
			// Arrange
			const ac = buildStudyAc({
				profile: {
					...readAirConditionerProfile(STUDY_PROFILE),
					jobMode: { writable: true, readValues: ['AUTO', 'COOL'], writeValues: ['AUTO', 'FAN'] },
				},
			});
			client.getDeviceState.mockResolvedValue({ ...STUDY_STATE, airConJobMode: { currentJobMode: 'FAN' } });

			// Act
			const outcome = await service.setCoolMode(ac);

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('setTargetTemperature', () => {
		it('should send 24.5 C snapped from 24.3 with unit C', async () => {
			// Arrange & Act
			const outcome = await service.setTargetTemperature(buildStudyAc(), 24.3);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', {
				temperature: { targetTemperature: 24.5, unit: 'C' },
			});
			expect(outcome).toMatchObject({ status: 'sent', state: { targetTemperatureC: 24.5 } });
		});

		it('should clamp a 40 C request to 30 C', async () => {
			// Arrange & Act
			await service.setTargetTemperature(buildStudyAc(), 40);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', {
				temperature: { targetTemperature: 30, unit: 'C' },
			});
		});

		it('should keep a 72 request inside 16-30 on a 0.5 step when the state unit is F', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(STUDY_STATE_FAHRENHEIT);

			// Act
			await service.setTargetTemperature(buildStudyAc(), 72);

			// Assert
			const [, payload] = client.controlDevice.mock.calls[0] as [
				string,
				{ temperature: { targetTemperature: number; unit: string } },
			];
			expect(payload.temperature.unit).toBe('C');
			expect(payload.temperature.targetTemperature).toBeGreaterThanOrEqual(16);
			expect(payload.temperature.targetTemperature).toBeLessThanOrEqual(30);
			expect((payload.temperature.targetTemperature * 2) % 1).toBe(0);
		});

		it('should send Celsius with unit C and report 25 C when the state unit is F', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(STUDY_STATE_FAHRENHEIT);

			// Act
			const outcome = await service.setTargetTemperature(buildStudyAc(), 25);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', {
				temperature: { targetTemperature: 25, unit: 'C' },
			});
			expect(outcome).toMatchObject({ status: 'sent', state: { targetTemperatureC: expect.closeTo(25, 2) } });
		});

		it('should report noop when the request equals the current target', async () => {
			// Arrange & Act
			const outcome = await service.setTargetTemperature(buildStudyAc(), 27);

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the AC is off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);

			// Act
			const outcome = await service.setTargetTemperature(buildBedroomAc(), 24);

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the profile target range is not writable', async () => {
			// Arrange
			const ac = buildStudyAc({
				profile: {
					...readAirConditionerProfile(STUDY_PROFILE),
					targetTemperature: { writable: false, min: 16, max: 30, step: 0.5 },
				},
			});

			// Act
			const outcome = await service.setTargetTemperature(ac, 24);

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('setWindStrength', () => {
		it('should send MID when the current wind strength is HIGH', async () => {
			// Arrange & Act
			const outcome = await service.setWindStrength(buildStudyAc(), 'MID');

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', { airFlow: { windStrength: 'MID' } });
			expect(outcome.status).toBe('sent');
		});

		it('should report noop when the requested strength equals the current strength', async () => {
			// Arrange & Act
			const outcome = await service.setWindStrength(buildStudyAc(), 'HIGH');

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the AC is off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);

			// Act
			const outcome = await service.setWindStrength(buildBedroomAc(), 'LOW');

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse a value that is not in the profile write list', async () => {
			// Arrange
			const ac = buildStudyAc({
				profile: {
					...readAirConditionerProfile(STUDY_PROFILE),
					windStrength: { writable: true, readValues: [], writeValues: ['LOW', 'MID', 'HIGH'] },
				},
			});

			// Act
			const outcome = await service.setWindStrength(ac, 'AUTO');

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('setSwing', () => {
		it('should send only rotateUpDown true on the Study Room AC', async () => {
			// Arrange & Act
			const outcome = await service.setSwing(buildStudyAc(), { rotateUpDown: true });

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', { windDirection: { rotateUpDown: true } });
			expect(outcome.status).toBe('sent');
		});

		it('should refuse left/right on the Study Room AC because the profile does not support it', async () => {
			// Arrange & Act
			const outcome = await service.setSwing(buildStudyAc(), { rotateLeftRight: true });

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should send only the changed axis on the Bedroom AC when the other axis already matches', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({ ...BEDROOM_STATE, operation: { airConOperationMode: 'POWER_ON' } });

			// Act
			await service.setSwing(buildBedroomAc(), { rotateUpDown: false, rotateLeftRight: true });

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('bedroom-ac', { windDirection: { rotateLeftRight: true } });
		});

		it('should report noop when every requested axis already matches', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({ ...BEDROOM_STATE, operation: { airConOperationMode: 'POWER_ON' } });

			// Act
			const outcome = await service.setSwing(buildBedroomAc(), { rotateUpDown: false, rotateLeftRight: false });

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the AC is off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);

			// Act
			const outcome = await service.setSwing(buildBedroomAc(), { rotateUpDown: true });

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('post-command refresh', () => {
		afterEach(() => {
			service.stopPolling();
			vi.useRealTimers();
		});

		it('should re-read state after the refresh delay and notify the listener when polling has started', async () => {
			// Arrange
			vi.useFakeTimers();
			const listener = vi.fn();
			const ac = buildBedroomAc();
			client.getDeviceState.mockResolvedValueOnce(BEDROOM_STATE).mockResolvedValueOnce({
				...BEDROOM_STATE,
				operation: { airConOperationMode: 'POWER_ON' },
			});
			service.startPolling(60_000, [], listener);
			await service.setPower(ac, true);

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_AC_POST_COMMAND_REFRESH_DELAY_MS - 1);
			const beforeDelay = listener.mock.calls.length;
			await vi.advanceTimersByTimeAsync(1);

			// Assert
			expect(beforeDelay).toBe(0);
			expect(listener).toHaveBeenCalledWith('bedroom-ac', expect.objectContaining({ powerOn: true }));
		});

		it('should clear the pending refresh timer on stopPolling', async () => {
			// Arrange
			vi.useFakeTimers();
			client.getDeviceState.mockResolvedValue(BEDROOM_STATE);
			service.startPolling(60_000, [], vi.fn());
			await service.setPower(buildBedroomAc(), true);
			const timersBeforeStop = vi.getTimerCount();

			// Act
			service.stopPolling();

			// Assert
			expect(timersBeforeStop).toBe(2);
			expect(vi.getTimerCount()).toBe(0);
		});
	});

	describe('startPolling and stopPolling', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			service.stopPolling();
			vi.useRealTimers();
		});

		it('should call the listener immediately and again on every interval for each air conditioner', async () => {
			// Arrange
			const listener = vi.fn();
			client.getDeviceState.mockResolvedValueOnce(STUDY_STATE).mockResolvedValueOnce(BEDROOM_STATE);

			// Act
			service.startPolling(60_000, [buildStudyAc(), buildBedroomAc()], listener);
			await vi.advanceTimersByTimeAsync(0);
			const immediate = listener.mock.calls.length;
			await vi.advanceTimersByTimeAsync(60_000);

			// Assert
			expect(immediate).toBe(2);
			expect(listener).toHaveBeenCalledWith('study-ac', expect.objectContaining({ powerOn: true }));
			expect(listener).toHaveBeenCalledWith('bedroom-ac', expect.objectContaining({ powerOn: false }));
			expect(listener).toHaveBeenCalledTimes(4);
		});

		it('should log a warning for a failing air conditioner and keep polling the others', async () => {
			// Arrange
			const listener = vi.fn();
			client.getDeviceState.mockImplementation(async (deviceId: string) => {
				if (deviceId === 'bedroom-ac') {
					throw new Error('device offline');
				}
				return STUDY_STATE;
			});

			// Act
			service.startPolling(60_000, [buildBedroomAc(), buildStudyAc()], listener);
			await vi.advanceTimersByTimeAsync(0);

			// Assert
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('bedroom-ac'));
			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith('study-ac', expect.any(Object));
		});

		it('should skip a tick that overlaps a still-running tick', async () => {
			// Arrange
			const listener = vi.fn();
			const pendingRead = deferred<ThinqConnectPayload>();
			client.getDeviceState.mockReturnValueOnce(pendingRead.promise);
			service.startPolling(60_000, [buildStudyAc()], listener);

			// Act
			await vi.advanceTimersByTimeAsync(60_000);
			const callsWhileRunning = client.getDeviceState.mock.calls.length;
			pendingRead.resolve(STUDY_STATE);
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(60_000);

			// Assert
			expect(callsWhileRunning).toBe(1);
			expect(client.getDeviceState).toHaveBeenCalledTimes(2);
		});

		it('should clear every timer when stopPolling is called', () => {
			// Arrange
			service.startPolling(60_000, [buildStudyAc()], vi.fn());

			// Act
			service.stopPolling();

			// Assert
			expect(vi.getTimerCount()).toBe(0);
		});
	});

	describe('logging', () => {
		it('should never include the PAT in any logger call', async () => {
			// Arrange
			const token = PAT_SENTINEL;
			client.getDeviceState.mockResolvedValueOnce(STUDY_STATE).mockRejectedValueOnce(new Error('timeout'));
			client.controlDevice.mockRejectedValueOnce(new ThinqConnectApiError('rejected', '1103'));

			// Act
			await service.setPower(buildStudyAc(), true);
			await service.setPower(buildStudyAc(), false);
			await service.setTargetTemperature(buildStudyAc(), 24);

			// Assert
			const logged = [
				...vi.mocked(logger.debug).mock.calls,
				...vi.mocked(logger.info).mock.calls,
				...vi.mocked(logger.warn).mock.calls,
				...vi.mocked(logger.error).mock.calls,
			];
			expect(logged.flat().join(' ')).not.toContain(token);
		});
	});
});

function fahrenheitStateWithTarget(targetTemperature: number): ThinqConnectPayload {
	return {
		...FAHRENHEIT_STATE,
		temperature: {
			currentTemperature: 77,
			targetTemperature,
			unit: 'F',
			minTargetTemperature: 60,
			maxTargetTemperature: 86,
		},
	};
}

describe('ThinqConnectAirConditionerService Fahrenheit, ERROR and windStep', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let client: ReturnType<typeof createMockClient>;
	let service: ThinqConnectAirConditionerService;

	function buildFahrenheitAc(): ThinqConnectAirConditioner {
		return { deviceId: 'study-ac', name: 'Study Room AC', profile: readAirConditionerProfile(FAHRENHEIT_PROFILE) };
	}

	function buildStudyFullAc(): ThinqConnectAirConditioner {
		return { deviceId: 'study-ac', name: 'Study Room AC', profile: readAirConditionerProfile(STUDY_PROFILE_FULL) };
	}

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		client = createMockClient();
		client.getDeviceState.mockResolvedValue(STUDY_STATE);
		client.controlDevice.mockResolvedValue({});
		service = new ThinqConnectAirConditionerService(client, logger);
	});

	afterEach(() => {
		service.stopPolling();
		vi.useRealTimers();
	});

	describe('setTargetTemperature with a Fahrenheit unit', () => {
		it('should send the snapped Fahrenheit target with unit F when a 22 C request is made', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(fahrenheitStateWithTarget(80));

			// Act
			const outcome = await service.setTargetTemperature(buildFahrenheitAc(), 22);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', {
				temperature: { targetTemperature: 72, unit: 'F' },
			});
			expect(outcome).toMatchObject({ status: 'sent' });
			expect(outcome.state.targetTemperatureC).toBeCloseTo(22.22, 2);
		});

		it('should return noop when the Celsius request snaps to the current Fahrenheit target', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(fahrenheitStateWithTarget(72));

			// Act
			const outcome = await service.setTargetTemperature(buildFahrenheitAc(), 22.2);

			// Assert
			expect(outcome).toMatchObject({ status: 'noop' });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should clamp a Celsius request below the Fahrenheit range to the 60 F minimum', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(fahrenheitStateWithTarget(72));

			// Act
			const outcome = await service.setTargetTemperature(buildFahrenheitAc(), 10);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', {
				temperature: { targetTemperature: 60, unit: 'F' },
			});
			expect(outcome.state.targetTemperatureC).toBeCloseTo(15.56, 2);
		});

		it('should refuse a Fahrenheit target change while the AC is off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({
				...FAHRENHEIT_STATE,
				operation: { airConOperationMode: 'POWER_OFF' },
			});

			// Act
			const outcome = await service.setTargetTemperature(buildFahrenheitAc(), 22);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused' });
			expect(outcome.status === 'refused' ? outcome.reason : '').toContain('off');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should keep unit C and the 24.5 C snap on the Celsius profile (regression)', async () => {
			// Arrange & Act
			await service.setTargetTemperature(buildStudyAc(), 24.3);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', {
				temperature: { targetTemperature: 24.5, unit: 'C' },
			});
		});
	});

	describe('readState with a Fahrenheit profile', () => {
		it('should convert a state without a unit field using the Fahrenheit profile unit', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({
				temperature: { currentTemperature: 77, targetTemperature: 72 },
				operation: { airConOperationMode: 'POWER_ON' },
			});

			// Act
			const state = await service.readState(buildFahrenheitAc());

			// Assert
			expect(state.currentTemperatureC).toBeCloseTo(25, 5);
			expect(state.targetTemperatureC).toBeCloseTo(22.22, 2);
		});

		it('should use the state unit C without converting again on a Fahrenheit profile', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({
				temperature: { currentTemperature: 25, targetTemperature: 22.5, unit: 'C' },
				operation: { airConOperationMode: 'POWER_ON' },
			});

			// Act
			const state = await service.readState(buildFahrenheitAc());

			// Assert
			expect(state.currentTemperatureC).toBe(25);
			expect(state.targetTemperatureC).toBe(22.5);
		});
	});

	describe('ERROR warning per transition', () => {
		it('should not warn when runState is NORMAL', async () => {
			// Arrange & Act
			await service.readState(buildStudyAc());

			// Assert
			expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
		});

		it('should warn once with the device id when the first ERROR is read', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(ERROR_STATE);

			// Act
			await service.readState(buildStudyAc());

			// Assert
			expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toContain('study-ac');
		});

		it('should keep a single warning across repeated ERROR reads', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(ERROR_STATE);
			const ac = buildStudyAc();

			// Act
			await service.readState(ac);
			await service.readState(ac);
			await service.readState(ac);

			// Assert
			expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
		});

		it('should log one info and re-arm the warning when the state returns to NORMAL', async () => {
			// Arrange
			client.getDeviceState
				.mockResolvedValueOnce(ERROR_STATE)
				.mockResolvedValueOnce(STUDY_STATE)
				.mockResolvedValueOnce(ERROR_STATE);
			const ac = buildStudyAc();

			// Act
			await service.readState(ac);
			await service.readState(ac);
			await service.readState(ac);

			// Assert
			expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toContain('back to NORMAL');
			expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
		});

		it('should warn again when the fault value changes from ERROR to FAULT', async () => {
			// Arrange
			client.getDeviceState
				.mockResolvedValueOnce(ERROR_STATE)
				.mockResolvedValueOnce({ ...STUDY_STATE, runState: { currentState: 'FAULT' } });
			const ac = buildStudyAc();

			// Act
			await service.readState(ac);
			await service.readState(ac);

			// Assert
			expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
		});

		it('should neither warn nor clear the flag when runState is absent between two ERROR reads', async () => {
			// Arrange
			client.getDeviceState
				.mockResolvedValueOnce(ERROR_STATE)
				.mockResolvedValueOnce({ ...STUDY_STATE, runState: undefined })
				.mockResolvedValueOnce(ERROR_STATE);
			const ac = buildStudyAc();

			// Act
			await service.readState(ac);
			await service.readState(ac);
			await service.readState(ac);

			// Assert
			expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
		});

		it('should share one warning across readState, a command read and the polling tick', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(ERROR_STATE);
			const ac = buildStudyAc();
			const listener = vi.fn();

			// Act
			await service.readState(ac);
			await service.setPower(ac, true);
			service.startPolling(60_000, [ac], listener);
			await vi.waitFor(() => {
				expect(listener).toHaveBeenCalledTimes(1);
			});

			// Assert
			expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
		});

		it('should not expose runState on the state object returned to the caller', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(ERROR_STATE);

			// Act
			const state = await service.readState(buildStudyAc());

			// Assert
			expect(state).not.toHaveProperty('runState');
		});
	});

	describe('setWindStep', () => {
		it('should refuse and send nothing when the AC is off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({ ...STUDY_STATE, operation: { airConOperationMode: 'POWER_OFF' } });

			// Act
			const outcome = await service.setWindStep(buildStudyFullAc(), 3);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: 'Air conditioner is off; refusing to change settings.',
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the windStep state is unknown', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue({ ...STUDY_STATE, airFlow: { windStrength: 'HIGH' } });

			// Act
			const outcome = await service.setWindStep(buildStudyFullAc(), 3);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: 'Wind step is unknown; refusing to send.' });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it.each([0, 6, 9])('should refuse wind step %i outside the profile range without sending', async (step) => {
			// Arrange & Act
			const outcome = await service.setWindStep(buildStudyFullAc(), step);

			// Assert
			expect(outcome.status === 'refused' ? outcome.reason : '').toContain('outside the profile range 1-5');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should return noop when the requested step equals the current step', async () => {
			// Arrange & Act
			const outcome = await service.setWindStep(buildStudyFullAc(), 5);

			// Assert
			expect(outcome).toMatchObject({ status: 'noop' });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should send the windStep payload and clear windStrength in the patched state when the step changes', async () => {
			// Arrange & Act
			const outcome = await service.setWindStep(buildStudyFullAc(), 3);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('study-ac', { airFlow: { windStep: 3 } });
			expect(outcome).toMatchObject({ status: 'sent', state: { windStep: 3 } });
			expect(outcome.state.windStrength).toBeUndefined();
		});

		it('should return failed with the freshly read state when the control call rejects', async () => {
			// Arrange
			client.controlDevice.mockRejectedValueOnce(new Error('rejected'));

			// Act
			const outcome = await service.setWindStep(buildStudyFullAc(), 3);

			// Assert
			expect(outcome).toMatchObject({ status: 'failed', error: 'rejected', state: { windStep: 5 } });
		});

		it('should refuse a second command while the first is in flight', async () => {
			// Arrange
			const ac = buildStudyFullAc();

			// Act
			const first = service.setWindStep(ac, 3);
			const second = await service.setWindStep(ac, 2);
			await first;

			// Assert
			expect(second).toMatchObject({
				status: 'refused',
				reason: 'Another command is already in progress for this air conditioner.',
			});
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
		});

		it('should re-read the state 3 s after a sent step', async () => {
			// Arrange
			vi.useFakeTimers();
			const ac = buildStudyFullAc();
			const listener = vi.fn();
			service.startPolling(60_000, [ac], listener);
			await vi.advanceTimersByTimeAsync(0);
			const readsBefore = client.getDeviceState.mock.calls.length;
			listener.mockClear();

			// Act
			await service.setWindStep(ac, 3);
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_AC_POST_COMMAND_REFRESH_DELAY_MS);

			// Assert
			expect(client.getDeviceState).toHaveBeenCalledTimes(readsBefore + 2);
			expect(listener).toHaveBeenCalledTimes(1);
		});
	});
});
