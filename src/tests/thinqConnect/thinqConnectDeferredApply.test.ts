import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	deferThinqConnectApply,
	THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS,
} from '../../thinqConnect/thinqConnectDeferredApply.js';
import { createMockLogger } from '../helpers/testUtils.js';

describe('deferThinqConnectApply', () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it('should not run the task synchronously or before the delay elapses', async () => {
		// Arrange
		const task = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

		// Act
		deferThinqConnectApply('state apply', task, logger);
		await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS - 1);

		// Assert
		expect(task).not.toHaveBeenCalled();
	});

	it('should run the task exactly once after the delay elapses', async () => {
		// Arrange
		const task = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

		// Act
		deferThinqConnectApply('state apply', task, logger);
		await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
		await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

		// Assert
		expect(task).toHaveBeenCalledTimes(1);
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('should return undefined immediately when the task never resolves', () => {
		// Arrange
		const neverResolves = (): Promise<void> => new Promise<void>(() => {});

		// Act
		const result = deferThinqConnectApply('state apply', neverResolves, logger);

		// Assert
		expect(result).toBeUndefined();
	});

	it('should log the description and error message when the task rejects', async () => {
		// Arrange
		const task = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('write failed'));

		// Act
		deferThinqConnectApply('state apply', task, logger);
		await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

		// Assert
		expect(logger.error).toHaveBeenCalledWith('state apply failed: write failed');
	});

	it('should log the error instead of throwing when the task throws synchronously', async () => {
		// Arrange
		const task = vi.fn<() => Promise<void>>(() => {
			throw new Error('sync boom');
		});

		// Act
		deferThinqConnectApply('corrective state apply', task, logger);
		await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

		// Assert
		expect(task).toHaveBeenCalledTimes(1);
		expect(logger.error).toHaveBeenCalledWith('corrective state apply failed: sync boom');
	});

	it('should log the stringified value when the task rejects with a non-Error', async () => {
		// Arrange
		const task = vi.fn<() => Promise<void>>().mockRejectedValue('plain text failure');

		// Act
		deferThinqConnectApply('operational state revert', task, logger);
		await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

		// Assert
		expect(logger.error).toHaveBeenCalledWith('operational state revert failed: plain text failure');
	});
});
