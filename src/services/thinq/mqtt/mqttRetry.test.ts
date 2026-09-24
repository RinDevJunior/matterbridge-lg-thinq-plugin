import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../../../tests/helpers/testUtils.js';
import { delayMs, MQTT_RETRY_ATTEMPTS, MQTT_RETRY_DELAY_MS, retryMqttRegistration } from './mqttRetry.js';

describe('mqttRetry', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('delayMs', () => {
		it('should return a promise that resolves after the specified time', async () => {
			vi.useFakeTimers();
			const promise = delayMs(1000);
			const start = Date.now();

			vi.advanceTimersByTime(1000);
			await promise;

			const elapsed = Date.now() - start;
			expect(elapsed).toBeGreaterThanOrEqual(1000);

			vi.useRealTimers();
		});

		it('should resolve immediately for zero delay', async () => {
			vi.useFakeTimers();
			const promise = delayMs(0);

			vi.advanceTimersByTime(0);
			await promise;

			vi.useRealTimers();
		});
	});

	describe('retryMqttRegistration', () => {
		it('should return true when register succeeds on first call', async () => {
			const register = vi.fn().mockResolvedValue(undefined);
			const delay = vi.fn().mockResolvedValue(undefined);

			const result = await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
			});

			expect(result).toBe(true);
			expect(register).toHaveBeenCalledTimes(1);
			expect(delay).not.toHaveBeenCalled();
		});

		it('should return false after default 5 attempts when register always fails', async () => {
			const register = vi.fn().mockRejectedValue(new Error('Connection failed'));
			const delay = vi.fn().mockResolvedValue(undefined);

			const result = await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
			});

			expect(result).toBe(false);
			expect(register).toHaveBeenCalledTimes(MQTT_RETRY_ATTEMPTS);
			expect(delay).toHaveBeenCalledTimes(MQTT_RETRY_ATTEMPTS - 1);
			expect(mockLogger.error).toHaveBeenCalledWith('Cannot start MQTT!');
		});

		it('should return true when register succeeds on the 3rd attempt', async () => {
			const register = vi
				.fn()
				.mockRejectedValueOnce(new Error('Attempt 1 failed'))
				.mockRejectedValueOnce(new Error('Attempt 2 failed'))
				.mockResolvedValueOnce(undefined);
			const delay = vi.fn().mockResolvedValue(undefined);

			const result = await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
			});

			expect(result).toBe(true);
			expect(register).toHaveBeenCalledTimes(3);
			expect(delay).toHaveBeenCalledTimes(2);
		});

		it('should respect custom attempts parameter', async () => {
			const register = vi.fn().mockRejectedValue(new Error('Connection failed'));
			const delay = vi.fn().mockResolvedValue(undefined);

			const result = await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
				attempts: 3,
			});

			expect(result).toBe(false);
			expect(register).toHaveBeenCalledTimes(3);
			expect(delay).toHaveBeenCalledTimes(2);
		});

		it('should respect custom retryDelayMs parameter', async () => {
			const register = vi.fn().mockRejectedValue(new Error('Connection failed'));
			const delay = vi.fn().mockResolvedValue(undefined);
			const customDelayMs = 1000;

			await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
				attempts: 2,
				retryDelayMs: customDelayMs,
			});

			expect(delay).toHaveBeenCalledWith(customDelayMs);
		});

		it('should use provided delay function', async () => {
			const register = vi.fn().mockRejectedValueOnce(new Error('Attempt 1 failed')).mockResolvedValueOnce(undefined);
			const delay = vi.fn().mockResolvedValue(undefined);

			const result = await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
			});

			expect(result).toBe(true);
			expect(delay).toHaveBeenCalledWith(MQTT_RETRY_DELAY_MS);
		});

		it('should use default delayMs when delay function not provided', async () => {
			const register = vi.fn().mockRejectedValueOnce(new Error('Attempt 1 failed')).mockResolvedValueOnce(undefined);

			vi.useFakeTimers();

			const resultPromise = retryMqttRegistration({
				register,
				logger: mockLogger,
			});

			// Advance timer to allow delay to complete
			await vi.advanceTimersByTimeAsync(MQTT_RETRY_DELAY_MS);
			const result = await resultPromise;

			expect(result).toBe(true);
			expect(register).toHaveBeenCalledTimes(2);

			vi.useRealTimers();
		});

		it('should log debug messages on each retry', async () => {
			const register = vi
				.fn()
				.mockRejectedValueOnce(new Error('Attempt 1 failed'))
				.mockRejectedValueOnce(new Error('Attempt 2 failed'))
				.mockResolvedValueOnce(undefined);
			const delay = vi.fn().mockResolvedValue(undefined);

			await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
			});

			// Should have debug logs: error message + retry message for each failed attempt before success
			expect(mockLogger.debug).toHaveBeenCalledWith('Cannot start MQTT, retrying in 5s.');
			// Two attempts failed, so 2 error messages + 2 retry messages = 4 total debug calls
			expect(
				vi.mocked(mockLogger.debug).mock.calls.filter((call) => call[0]?.includes('Cannot start MQTT')),
			).toHaveLength(2);
		});

		it('should not call delay after the last failed attempt', async () => {
			const register = vi.fn().mockRejectedValue(new Error('Connection failed'));
			const delay = vi.fn().mockResolvedValue(undefined);

			await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
				attempts: 3,
			});

			// delay should be called 2 times (after attempt 1 and 2, but not after attempt 3)
			expect(delay).toHaveBeenCalledTimes(2);
		});

		it('should handle error objects in debug logging', async () => {
			const error = new Error('Custom error message');
			const register = vi.fn().mockRejectedValue(error);
			const delay = vi.fn().mockResolvedValue(undefined);

			await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
				attempts: 2,
			});

			expect(mockLogger.debug).toHaveBeenCalledWith('mqtt err: Custom error message');
		});

		it('should handle non-Error objects in debug logging', async () => {
			const register = vi.fn().mockRejectedValue('string error');
			const delay = vi.fn().mockResolvedValue(undefined);

			await retryMqttRegistration({
				register,
				logger: mockLogger,
				delay,
				attempts: 2,
			});

			expect(mockLogger.debug).toHaveBeenCalledWith('mqtt err: string error');
		});
	});

	describe('MQTT_RETRY_ATTEMPTS constant', () => {
		it('should be 5', () => {
			expect(MQTT_RETRY_ATTEMPTS).toBe(5);
		});
	});

	describe('MQTT_RETRY_DELAY_MS constant', () => {
		it('should be 5000', () => {
			expect(MQTT_RETRY_DELAY_MS).toBe(5000);
		});
	});
});
