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

function washerState(currentState: string, locationName = 'MAIN'): ThinqConnectPayload {
	return [{ location: { locationName }, runState: { currentState }, operation: { washerOperationMode: 'POWER_ON' } }];
}

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
