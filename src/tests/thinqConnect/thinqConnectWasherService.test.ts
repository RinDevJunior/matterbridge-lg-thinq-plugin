import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import type { ThinqConnectPayload } from '../../services/thinqConnect/thinqConnectApiClient.js';
import {
	THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS,
	type ThinqConnectWasher,
	type ThinqConnectWasherClient,
	ThinqConnectWasherService,
} from '../../thinqConnect/thinqConnectWasherService.js';
import { createMockLogger } from '../helpers/testUtils.js';

interface MockClient {
	getDevices: Mock;
	getDeviceProfile: Mock;
	getDeviceState: Mock;
	controlDevice: Mock;
}

function createMockClient(): MockClient {
	return {
		getDevices: vi.fn(),
		getDeviceProfile: vi.fn(),
		getDeviceState: vi.fn(),
		controlDevice: vi.fn(),
	};
}

const WASHER_PROFILE: ThinqConnectPayload = [
	{
		location: { locationName: 'MAIN' },
		washerOperationMode: { mode: ['w'], value: { w: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] } },
	},
];

function washerState(
	currentState: string,
	locationName = 'MAIN',
	timer?: { remainHour?: number; remainMinute?: number },
	remoteControlEnabled?: boolean,
): ThinqConnectPayload {
	return [
		{
			location: { locationName },
			runState: { currentState },
			...(timer === undefined ? {} : { timer }),
			...(remoteControlEnabled === undefined ? {} : { remoteControlEnable: { remoteControlEnabled } }),
			operation: { washerOperationMode: 'POWER_ON' },
		},
	];
}

const START_PAYLOAD = { location: { locationName: 'MAIN' }, operation: { washerOperationMode: 'START' } };
const STOP_PAYLOAD = { location: { locationName: 'MAIN' }, operation: { washerOperationMode: 'STOP' } };

const WASHER: ThinqConnectWasher = {
	deviceId: 'w1',
	name: 'Laundry',
	locationName: 'MAIN',
	operationMode: { writable: true, allowedValues: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] },
};

describe('ThinqConnectWasherService', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let client: MockClient;
	let service: ThinqConnectWasherService;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		logger = createMockLogger();
		client = createMockClient();
		service = new ThinqConnectWasherService(client satisfies ThinqConnectWasherClient, logger);
	});

	afterEach(() => {
		service.stopPolling();
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('discoverWashers', () => {
		it('should keep only DEVICE_WASHER devices and skip air conditioners', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'w1', deviceInfo: { deviceType: 'DEVICE_WASHER', alias: 'Laundry' } },
				{ deviceId: 'a1', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'AC' } },
			]);
			client.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);

			// Act
			const washers = await service.discoverWashers();

			// Assert
			expect(washers.map((washer) => washer.deviceId)).toEqual(['w1']);
			expect(client.getDeviceProfile).toHaveBeenCalledTimes(1);
			expect(client.getDeviceProfile).toHaveBeenCalledWith('w1');
		});

		it('should name washers from alias, then modelName, then the default label', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'w1', deviceInfo: { deviceType: 'DEVICE_WASHER', modelName: 'WM-1' } },
				{ deviceId: 'w2', deviceInfo: { deviceType: 'DEVICE_WASHER', alias: '   ' } },
			]);
			client.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);

			// Act
			const washers = await service.discoverWashers();

			// Assert
			expect(washers.map((washer) => washer.name)).toEqual(['WM-1', 'LG Washer']);
		});

		it('should populate locationName and operationMode from the profile', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'w1', deviceInfo: { deviceType: 'DEVICE_WASHER', alias: 'Laundry', modelName: 'WM-1' } },
			]);
			client.getDeviceProfile.mockResolvedValue(WASHER_PROFILE);

			// Act
			const [washer] = await service.discoverWashers();

			// Assert
			expect(washer?.locationName).toBe('MAIN');
			expect(washer?.modelName).toBe('WM-1');
			expect(washer?.operationMode).toEqual({
				writable: true,
				allowedValues: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'],
			});
		});

		it('should warn and skip a washer whose profile fails while keeping the others', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'w1', deviceInfo: { deviceType: 'DEVICE_WASHER', alias: 'Broken' } },
				{ deviceId: 'w2', deviceInfo: { deviceType: 'DEVICE_WASHER', alias: 'Good' } },
			]);
			client.getDeviceProfile
				.mockRejectedValueOnce(new Error('profile unavailable'))
				.mockResolvedValueOnce(WASHER_PROFILE);

			// Act
			const washers = await service.discoverWashers();

			// Assert
			expect(washers.map((washer) => washer.deviceId)).toEqual(['w2']);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('w1'));
		});

		it('should propagate the error when getDevices fails', async () => {
			// Arrange
			client.getDevices.mockRejectedValue(new ThinqConnectApiError('devices unavailable', '1000'));

			// Act & Assert
			await expect(service.discoverWashers()).rejects.toThrow('devices unavailable');
		});

		it('should fetch profiles sequentially, never concurrently', async () => {
			// Arrange
			client.getDevices.mockResolvedValue([
				{ deviceId: 'w1', deviceInfo: { deviceType: 'DEVICE_WASHER' } },
				{ deviceId: 'w2', deviceInfo: { deviceType: 'DEVICE_WASHER' } },
			]);
			let active = 0;
			let maxActive = 0;
			client.getDeviceProfile.mockImplementation(async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await Promise.resolve();
				active--;
				return WASHER_PROFILE;
			});

			// Act
			await service.discoverWashers();

			// Assert
			expect(maxActive).toBe(1);
			expect(client.getDeviceProfile).toHaveBeenCalledTimes(2);
		});
	});

	describe('readState', () => {
		it('should return currentState and powerOn for an array state', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state).toEqual({ currentState: 'RUNNING', powerOn: true });
		});

		it('should include remainingSeconds computed from the timer', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING', 'MAIN', { remainHour: 0, remainMinute: 45 }));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state).toEqual({ currentState: 'RUNNING', powerOn: true, remainingSeconds: 2700 });
		});

		it('should leave remainingSeconds undefined when the state has no timer', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state.remainingSeconds).toBeUndefined();
		});

		it('should return powerOn false when the washer is POWER_OFF', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state.powerOn).toBe(false);
		});

		it('should return powerOn undefined when currentState is missing', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue([{ location: { locationName: 'MAIN' } }]);

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state).toEqual({ currentState: undefined, powerOn: undefined });
		});

		it('should propagate the error when getDeviceState fails', async () => {
			// Arrange
			client.getDeviceState.mockRejectedValue(new Error('state unavailable'));

			// Act & Assert
			await expect(service.readState(WASHER)).rejects.toThrow('state unavailable');
		});
	});

	describe('setPower noop', () => {
		it('should return noop without a POST when turning on while INITIAL', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL'));

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should return noop without a POST when turning off while POWER_OFF', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));

			// Act
			const outcome = await service.setPower(WASHER, false);

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should return noop when turning on while RUNNING, since idempotency wins over the guard', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('setPower sent', () => {
		it('should send POWER_ON with the profile location when turning on from POWER_OFF', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockResolvedValue({});

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
			expect(client.controlDevice).toHaveBeenCalledWith('w1', {
				location: { locationName: 'MAIN' },
				operation: { washerOperationMode: 'POWER_ON' },
			});
			expect(outcome).toEqual({ status: 'sent', state: { currentState: undefined, powerOn: true } });
		});

		it('should send POWER_OFF when turning off from INITIAL', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL'));
			client.controlDevice.mockResolvedValue({});

			// Act
			const outcome = await service.setPower(WASHER, false);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledWith('w1', {
				location: { locationName: 'MAIN' },
				operation: { washerOperationMode: 'POWER_OFF' },
			});
			expect(outcome.status).toBe('sent');
			expect(outcome.state.powerOn).toBe(false);
		});
	});

	describe('setPower refused', () => {
		it('should refuse to turn off while RUNNING and not POST, keeping powerOn true', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));

			// Act
			const outcome = await service.setPower(WASHER, false);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('refusing to interrupt') as string,
				state: { powerOn: true },
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse to turn off while PAUSE and not POST', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('PAUSE'));

			// Act
			const outcome = await service.setPower(WASHER, false);

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the profile is not writable', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL'));
			const readOnlyWasher: ThinqConnectWasher = {
				...WASHER,
				operationMode: { writable: false, allowedValues: ['POWER_OFF'] },
			};

			// Act
			const outcome = await service.setPower(readOnlyWasher, false);

			// Assert
			expect(outcome.status).toBe('refused');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the value is not listed in the profile', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			const limitedWasher: ThinqConnectWasher = {
				...WASHER,
				operationMode: { writable: true, allowedValues: ['START'] },
			};

			// Act
			const outcome = await service.setPower(limitedWasher, true);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('does not list "POWER_ON"') as string,
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse when the state has no currentState (fail closed)', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue([{ location: { locationName: 'MAIN' } }]);

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('unknown') as string,
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});
	});

	describe('setPower failed', () => {
		it('should return failed with the API error message when controlDevice rejects', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockRejectedValue(new ThinqConnectApiError('Washer busy (code 2302)', '2302'));

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(outcome).toMatchObject({
				status: 'failed',
				error: expect.stringContaining('code 2302') as string,
			});
		});

		it('should return failed without a POST and fall back to empty state when getDeviceState rejects', async () => {
			// Arrange
			client.getDeviceState.mockRejectedValue(new Error('state unavailable'));

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(outcome.status).toBe('failed');
			expect(outcome.state).toEqual({});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should fall back to the last known state when getDeviceState rejects after a successful read', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValueOnce(washerState('POWER_OFF'));
			await service.readState(WASHER);
			client.getDeviceState.mockRejectedValueOnce(new Error('state unavailable'));

			// Act
			const outcome = await service.setPower(WASHER, true);

			// Assert
			expect(outcome.status).toBe('failed');
			expect(outcome.state).toEqual({ currentState: 'POWER_OFF', powerOn: false });
		});

		it('should never log the PAT sentinel when client errors carry only generic text', async () => {
			// Arrange: the service never receives the PAT, so the sentinel is only checked against log output.
			const patSentinel = 'pat-sentinel-do-not-log';
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockRejectedValue(new Error('request rejected'));

			// Act
			await service.setPower(WASHER, true);

			// Assert
			const logged = [
				...vi.mocked(logger.info).mock.calls,
				...vi.mocked(logger.warn).mock.calls,
				...vi.mocked(logger.error).mock.calls,
			];
			expect(logged.flat().join(' ')).not.toContain(patSentinel);
		});
	});

	describe('setPower in-flight guard', () => {
		it('should refuse a second command while the first is pending, then allow a new call after it resolves', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValueOnce(washerState('INITIAL')).mockResolvedValue(washerState('POWER_OFF'));
			let releaseControl: () => void = () => undefined;
			const pendingControl = new Promise<ThinqConnectPayload>((resolve) => {
				releaseControl = () => resolve({});
			});
			client.controlDevice.mockReturnValueOnce(pendingControl).mockResolvedValue({});

			// Act
			const first = service.setPower(WASHER, false);
			const second = await service.setPower(WASHER, true);
			releaseControl();
			const firstOutcome = await first;
			const third = await service.setPower(WASHER, true);

			// Assert
			expect(second).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('already in progress') as string,
			});
			expect(firstOutcome.status).toBe('sent');
			expect(third.status).toBe('sent');
		});

		it('should clear the in-flight marker after a failure so the next call is allowed', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});

			// Act
			const failed = await service.setPower(WASHER, true);
			const retried = await service.setPower(WASHER, true);

			// Assert
			expect(failed.status).toBe('failed');
			expect(retried.status).toBe('sent');
		});
	});

	describe('post-command refresh', () => {
		it('should refresh once after the delay when polling is started', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockResolvedValue({});
			const listener = vi.fn();
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);
			const callsBefore = listener.mock.calls.length;
			const readsBefore = client.getDeviceState.mock.calls.length;

			// Act
			await service.setPower(WASHER, true);
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS);

			// Assert
			expect(client.getDeviceState.mock.calls.length - readsBefore).toBe(2);
			expect(listener.mock.calls.length - callsBefore).toBe(1);
		});

		it('should not create a refresh timer when polling is not started', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockResolvedValue({});

			// Act
			await service.setPower(WASHER, true);

			// Assert
			expect(vi.getTimerCount()).toBe(0);
		});

		it('should cancel a pending refresh when stopPolling is called', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('POWER_OFF'));
			client.controlDevice.mockResolvedValue({});
			service.startPolling(60000, [WASHER], vi.fn());
			await vi.advanceTimersByTimeAsync(0);
			await service.setPower(WASHER, true);
			const readsBefore = client.getDeviceState.mock.calls.length;

			// Act
			service.stopPolling();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS);

			// Assert
			expect(client.getDeviceState.mock.calls.length).toBe(readsBefore);
		});
	});

	describe('readState remoteControlEnabled', () => {
		it('should return remoteControlEnabled true when the washer reports remote control on', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state.remoteControlEnabled).toBe(true);
		});

		it('should return remoteControlEnabled false (not undefined) when the washer reports remote control off', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, false));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state.remoteControlEnabled).toBe(false);
		});

		it('should leave remoteControlEnabled undefined when the key is absent', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL'));

			// Act
			const state = await service.readState(WASHER);

			// Assert
			expect(state.remoteControlEnabled).toBeUndefined();
		});
	});

	describe('startCycle', () => {
		it('should send START once with the profile location and return sent when INITIAL and remote control is on', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			client.controlDevice.mockResolvedValue({});

			// Act
			const outcome = await service.startCycle(WASHER);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
			expect(client.controlDevice).toHaveBeenCalledWith('w1', START_PAYLOAD);
			expect(outcome).toEqual({ status: 'sent', state: {} });
		});

		it('should schedule one state re-read after the delay when START is sent', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			client.controlDevice.mockResolvedValue({});
			const listener = vi.fn();
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);
			const listenerCallsBefore = listener.mock.calls.length;
			await service.startCycle(WASHER);
			client.getDeviceState.mockResolvedValue(washerState('RUNNING', 'MAIN', undefined, true));

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS);

			// Assert
			expect(listener.mock.calls.length - listenerCallsBefore).toBe(1);
			expect(listener).toHaveBeenLastCalledWith('w1', expect.objectContaining({ currentState: 'RUNNING' }) as object);
		});

		it.each([
			['POWER_OFF', 'powered off'],
			['PAUSE', 'paused'],
			['ERROR', 'reports an error'],
			['END', 'not ready to start'],
			['RESERVED', 'not ready to start'],
			['WEIRD', 'not ready to start'],
		])('should refuse START without any control call when the washer is %s', async (currentState, reasonPart) => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState(currentState, 'MAIN', undefined, true));

			// Act
			const outcome = await service.startCycle(WASHER);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining(reasonPart) as string });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse START when remote control is off even though the washer is INITIAL', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, false));

			// Act
			const outcome = await service.startCycle(WASHER);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('Remote start is off') as string,
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse START when the state has no currentState (fail closed)', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue([{ location: { locationName: 'MAIN' } }]);

			// Act
			const outcome = await service.startCycle(WASHER);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining('unknown') as string });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse START when the profile is not writable', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			const readOnlyWasher: ThinqConnectWasher = {
				...WASHER,
				operationMode: { writable: false, allowedValues: ['START', 'STOP'] },
			};

			// Act
			const outcome = await service.startCycle(readOnlyWasher);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining('not writable') as string });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse START when START is not listed in the profile', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			const limitedWasher: ThinqConnectWasher = {
				...WASHER,
				operationMode: { writable: true, allowedValues: ['STOP', 'POWER_OFF'] },
			};

			// Act
			const outcome = await service.startCycle(limitedWasher);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('does not list "START"') as string,
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse START and mention locationName when the profile has no locationName', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			const noLocationWasher: ThinqConnectWasher = { ...WASHER, locationName: undefined };

			// Act
			const outcome = await service.startCycle(noLocationWasher);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining('locationName') as string });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should return noop without a control call when the washer is already RUNNING', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING', 'MAIN', undefined, true));

			// Act
			const outcome = await service.startCycle(WASHER);

			// Assert
			expect(outcome.status).toBe('noop');
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it.each([
			['2301', 'Remote start is off'],
			['2304', 'powered off'],
			['2209', 'may or may not'],
			['2207', 'Nothing ran'],
		])(
			'should return failed with resultCode %s and a plain hint when controlDevice rejects',
			async (resultCode, hintPart) => {
				// Arrange
				client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
				client.controlDevice.mockRejectedValue(new ThinqConnectApiError('boom', resultCode));

				// Act
				const outcome = await service.startCycle(WASHER);

				// Assert
				expect(outcome).toMatchObject({
					status: 'failed',
					error: 'boom',
					resultCode,
					hint: expect.stringContaining(hintPart) as string,
				});
				expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
			},
		);

		it('should return failed with the error message as hint and no resultCode when the network fails', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			client.controlDevice.mockRejectedValue(new Error('network down'));

			// Act
			const outcome = await service.startCycle(WASHER);

			// Assert
			expect(outcome).toEqual({
				status: 'failed',
				error: 'network down',
				hint: 'network down',
				state: expect.objectContaining({ currentState: 'INITIAL' }) as object,
			});
		});

		it('should schedule a state re-read after the delay when controlDevice fails', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			client.controlDevice.mockRejectedValue(new ThinqConnectApiError('boom', '2209'));
			const listener = vi.fn();
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);
			const readsBefore = client.getDeviceState.mock.calls.length;
			const listenerCallsBefore = listener.mock.calls.length;
			await service.startCycle(WASHER);

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS);

			// Assert
			expect(client.getDeviceState.mock.calls.length - readsBefore).toBe(2);
			expect(listener.mock.calls.length - listenerCallsBefore).toBe(1);
		});

		it('should return failed without a control call and never throw when getDeviceState rejects', async () => {
			// Arrange
			client.getDeviceState.mockRejectedValue(new Error('state unavailable'));

			// Act & Assert
			await expect(service.startCycle(WASHER)).resolves.toMatchObject({
				status: 'failed',
				error: 'state unavailable',
				hint: 'state unavailable',
				state: {},
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should read the state exactly once and send at most one control call', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('INITIAL', 'MAIN', undefined, true));
			client.controlDevice.mockResolvedValue({});

			// Act
			await service.startCycle(WASHER);

			// Assert
			expect(client.getDeviceState).toHaveBeenCalledTimes(1);
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
		});
	});

	describe('stopCycle', () => {
		it.each<[string, boolean | undefined]>([
			['RUNNING', true],
			['SOAKING', undefined],
			['PAUSE', true],
		])('should send STOP once when the washer is %s', async (currentState, remoteControlEnabled) => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState(currentState, 'MAIN', undefined, remoteControlEnabled));
			client.controlDevice.mockResolvedValue({});

			// Act
			const outcome = await service.stopCycle(WASHER);

			// Assert
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
			expect(client.controlDevice).toHaveBeenCalledWith('w1', STOP_PAYLOAD);
			expect(outcome).toEqual({ status: 'sent', state: {} });
		});

		it.each(['POWER_OFF', 'INITIAL', 'END', 'ERROR'])(
			'should return noop without a control call when the washer is %s',
			async (currentState) => {
				// Arrange
				client.getDeviceState.mockResolvedValue(washerState(currentState, 'MAIN', undefined, true));

				// Act
				const outcome = await service.stopCycle(WASHER);

				// Assert
				expect(outcome).toMatchObject({ status: 'noop', state: expect.objectContaining({ currentState }) as object });
				expect(client.controlDevice).not.toHaveBeenCalled();
			},
		);

		it('should refuse STOP when remote control is off while RUNNING', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING', 'MAIN', undefined, false));

			// Act
			const outcome = await service.stopCycle(WASHER);

			// Assert
			expect(outcome).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('Remote start is off') as string,
			});
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should refuse STOP when the state has no currentState (fail closed)', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue([{ location: { locationName: 'MAIN' } }]);

			// Act
			const outcome = await service.stopCycle(WASHER);

			// Assert
			expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringContaining('unknown') as string });
			expect(client.controlDevice).not.toHaveBeenCalled();
		});

		it('should return failed with resultCode and hint when STOP is rejected by ThinQ', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING', 'MAIN', undefined, true));
			client.controlDevice.mockRejectedValue(new ThinqConnectApiError('boom', '2208'));

			// Act
			const outcome = await service.stopCycle(WASHER);

			// Assert
			expect(outcome).toMatchObject({
				status: 'failed',
				error: 'boom',
				resultCode: '2208',
				hint: 'The washer failed to carry out the command.',
			});
		});
	});

	describe('cycle command in-flight guard', () => {
		it('should refuse a stop while a start is pending and let a later start proceed once it finished', async () => {
			// Arrange
			let release: (value: ThinqConnectPayload) => void = () => undefined;
			client.getDeviceState
				.mockReturnValueOnce(
					new Promise<ThinqConnectPayload>((resolve) => {
						release = resolve;
					}),
				)
				.mockResolvedValue(washerState('RUNNING', 'MAIN', undefined, true));
			client.controlDevice.mockResolvedValue({});

			// Act
			const first = service.startCycle(WASHER);
			const second = await service.stopCycle(WASHER);
			release(washerState('INITIAL', 'MAIN', undefined, true));
			const firstOutcome = await first;
			const third = await service.startCycle(WASHER);

			// Assert
			expect(second).toMatchObject({
				status: 'refused',
				reason: expect.stringContaining('already in progress') as string,
			});
			expect(firstOutcome.status).toBe('sent');
			expect(third.status).toBe('noop');
			expect(client.controlDevice).toHaveBeenCalledTimes(1);
		});
	});

	describe('startPolling', () => {
		it('should run the first tick immediately, before any interval elapses', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));
			const listener = vi.fn();

			// Act
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);

			// Assert
			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith('w1', { currentState: 'RUNNING', powerOn: true });
		});

		it('should pass remainingSeconds to the listener during polling', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING', 'MAIN', { remainHour: 1, remainMinute: 30 }));
			const listener = vi.fn();

			// Act
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);

			// Assert
			expect(listener).toHaveBeenCalledWith('w1', {
				currentState: 'RUNNING',
				powerOn: true,
				remainingSeconds: 5400,
			});
		});

		it('should run a subsequent tick after each intervalMs', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));
			const listener = vi.fn();
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);

			// Act
			await vi.advanceTimersByTimeAsync(60000);

			// Assert
			expect(listener).toHaveBeenCalledTimes(2);
		});

		it('should warn for a failing washer without stopping the others or later ticks', async () => {
			// Arrange
			const other: ThinqConnectWasher = { ...WASHER, deviceId: 'w2', name: 'Other' };
			client.getDeviceState.mockImplementation(async (deviceId: string) => {
				if (deviceId === 'w1') {
					throw new Error('w1 offline');
				}
				return washerState('INITIAL');
			});
			const listener = vi.fn();

			// Act
			service.startPolling(60000, [WASHER, other], listener);
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(60000);

			// Assert
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('w1'));
			expect(listener.mock.calls.filter((call: unknown[]) => call[0] === 'w2')).toHaveLength(2);
		});

		it('should skip an overlapping tick while the previous tick is still pending', async () => {
			// Arrange
			let releaseFirst: () => void = () => undefined;
			client.getDeviceState.mockReturnValueOnce(
				new Promise<ThinqConnectPayload>((resolve) => {
					releaseFirst = () => resolve(washerState('RUNNING'));
				}),
			);
			service.startPolling(60000, [WASHER], vi.fn());

			// Act
			await vi.advanceTimersByTimeAsync(60000);

			// Assert
			expect(client.getDeviceState).toHaveBeenCalledTimes(1);
			releaseFirst();
			await vi.advanceTimersByTimeAsync(0);
		});

		it('should not double the timers when startPolling is called twice', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));
			const listener = vi.fn();
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);

			// Act
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);
			const callsBefore = listener.mock.calls.length;
			await vi.advanceTimersByTimeAsync(60000);

			// Assert
			expect(vi.getTimerCount()).toBe(1);
			expect(listener.mock.calls.length - callsBefore).toBe(1);
		});

		it('should stop further ticks when stopPolling is called', async () => {
			// Arrange
			client.getDeviceState.mockResolvedValue(washerState('RUNNING'));
			const listener = vi.fn();
			service.startPolling(60000, [WASHER], listener);
			await vi.advanceTimersByTimeAsync(0);
			const callsBefore = listener.mock.calls.length;

			// Act
			service.stopPolling();
			await vi.advanceTimersByTimeAsync(120000);

			// Assert
			expect(listener.mock.calls.length).toBe(callsBefore);
		});
	});
});
