import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqFilterState } from '../../core/domain/value-objects/ThinqFilterState.js';
import { asPartial, createMockLogger } from '../../tests/helpers/testUtils.js';
import type { ThinqApiClient } from './thinqApiClient.js';
import { ThinqFilterMonitoringService } from './thinqFilterMonitoringService.js';

describe('ThinqFilterMonitoringService', () => {
	let mockApiClient: ThinqApiClient;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let service: ThinqFilterMonitoringService;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockLogger = createMockLogger();
		mockApiClient = asPartial<ThinqApiClient>({
			getFilterState: vi.fn(),
		});
		service = new ThinqFilterMonitoringService(mockApiClient, mockLogger);
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('startPolling', () => {
		it('should set interval and call onUpdate with filter state', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			const filterData = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);

			service.startPolling(1000, deviceIds, onUpdate);

			// Advance timer to trigger first poll
			await vi.advanceTimersByTimeAsync(1000);

			expect(onUpdate).toHaveBeenCalledTimes(1);
			const filterState = onUpdate.mock.calls[0][1] as ThinqFilterState | undefined;
			expect(filterState?.remainingPercent).toBe(98);
		});

		it('should not call onUpdate before interval elapses', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(1000, deviceIds, onUpdate);

			// Do not advance timers
			expect(onUpdate).not.toHaveBeenCalled();
		});

		it('should call getFilterState for each device in the list', async () => {
			const deviceIds = ['device-1', 'device-2', 'device-3'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(1000, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			expect(vi.mocked(mockApiClient.getFilterState)).toHaveBeenCalledTimes(3);
			expect(vi.mocked(mockApiClient.getFilterState)).toHaveBeenCalledWith('device-1');
			expect(vi.mocked(mockApiClient.getFilterState)).toHaveBeenCalledWith('device-2');
			expect(vi.mocked(mockApiClient.getFilterState)).toHaveBeenCalledWith('device-3');
		});

		it('should handle per-device errors and continue with other devices', async () => {
			const deviceIds = ['device-1', 'device-2', 'device-3'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState)
				.mockResolvedValueOnce({ 'airState.filterMngStates.useTime': 11, 'airState.filterMngStates.maxTime': 720 })
				.mockRejectedValueOnce(new Error('Device 2 failed'))
				.mockResolvedValueOnce({ 'airState.filterMngStates.useTime': 5, 'airState.filterMngStates.maxTime': 600 });

			service.startPolling(1000, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			expect(onUpdate).toHaveBeenCalledTimes(3);
			// device-1: success
			expect(onUpdate.mock.calls[0][0]).toBe('device-1');
			expect(onUpdate.mock.calls[0][1]).toBeDefined();
			// device-2: error
			expect(onUpdate.mock.calls[1][0]).toBe('device-2');
			expect(onUpdate.mock.calls[1][1]).toBeUndefined();
			// device-3: success
			expect(onUpdate.mock.calls[2][0]).toBe('device-3');
			expect(onUpdate.mock.calls[2][1]).toBeDefined();
		});

		it('should call onUpdate with undefined when device response is empty', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue(undefined);

			service.startPolling(1000, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			expect(onUpdate).toHaveBeenCalledWith('device-1', undefined);
		});

		it('should continue polling on interval', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(500, deviceIds, onUpdate);

			await vi.advanceTimersByTimeAsync(500);
			expect(onUpdate).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(500);
			expect(onUpdate).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(500);
			expect(onUpdate).toHaveBeenCalledTimes(3);

			service.stopPolling();
		});

		it('should clear prior timer when startPolling called twice', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(1000, deviceIds, onUpdate);
			service.startPolling(1000, deviceIds, onUpdate);

			// Only one timer should be active
			await vi.advanceTimersByTimeAsync(1000);

			expect(onUpdate).toHaveBeenCalledTimes(1);
		});

		it('should log debug message when starting polling', async () => {
			const deviceIds = ['device-1', 'device-2'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue(undefined);

			service.startPolling(1000, deviceIds, onUpdate);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('starting with interval=1000ms, devices=2'),
			);
		});

		it('should log per-device errors at debug level', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			const error = new Error('Network error');
			vi.mocked(mockApiClient.getFilterState).mockRejectedValue(error);

			service.startPolling(1000, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('ThinQ filter monitoring failed for device-1'),
			);
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Network error'));
		});
	});

	describe('stopPolling', () => {
		it('should clear timer and stop polling', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(1000, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);
			expect(onUpdate).toHaveBeenCalledTimes(1);

			service.stopPolling();
			await vi.advanceTimersByTimeAsync(1000);

			// Should not have been called again after stopPolling
			expect(onUpdate).toHaveBeenCalledTimes(1);
		});

		it('should not throw when no timer is active', () => {
			expect(() => service.stopPolling()).not.toThrow();
		});

		it('should log debug message when stopped', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(1000, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000);

			service.stopPolling();

			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('stopped after 1 tick(s)'));
		});

		it('should reset tick count across start/stop cycles', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(500, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(1000); // 2 ticks

			service.stopPolling();

			vi.mocked(mockLogger.debug).mockClear();

			service.startPolling(500, deviceIds, onUpdate);
			await vi.advanceTimersByTimeAsync(500); // 1 tick

			service.stopPolling();

			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('stopped after 1 tick(s)'));
		});

		it('should log tick number with timestamp', async () => {
			const deviceIds = ['device-1'];
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			});

			service.startPolling(100, deviceIds, onUpdate);

			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(100);

			service.stopPolling();

			const debugCalls = vi.mocked(mockLogger.debug).mock.calls.map((call) => call[0]);
			expect(debugCalls.some((call) => call.includes('tick #1'))).toBe(true);
			expect(debugCalls.some((call) => call.includes('tick #2'))).toBe(true);
		});
	});
});
