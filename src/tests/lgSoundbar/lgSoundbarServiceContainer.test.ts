import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	LG_SOUNDBAR_MIN_POLL_INTERVAL_SECONDS,
	LgSoundbarServiceContainer,
} from '../../lgSoundbar/lgSoundbarServiceContainer.js';
import { LgSoundbarService } from '../../services/lgSoundbar/lgSoundbarService.js';
import { createMockLogger } from '../helpers/testUtils.js';

vi.mock('../../services/lgSoundbar/lgSoundbarService.js', () => ({
	LgSoundbarService: vi.fn(function () {
		return { stopPolling: vi.fn() };
	}),
}));

describe('LgSoundbarServiceContainer', () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
	});

	describe('getService', () => {
		it('should return the same LgSoundbarService instance on repeated calls', () => {
			// Arrange
			const container = new LgSoundbarServiceContainer(logger, 30);

			// Act
			const first = container.getService();
			const second = container.getService();

			// Assert
			expect(first).toBe(second);
			expect(vi.mocked(LgSoundbarService)).toHaveBeenCalledTimes(1);
		});
	});

	describe('pollIntervalMs', () => {
		it('should clamp a config value below the minimum up to the minimum, in milliseconds', () => {
			// Arrange
			const container = new LgSoundbarServiceContainer(logger, 1);

			// Act
			const result = container.pollIntervalMs;

			// Assert
			expect(result).toBe(LG_SOUNDBAR_MIN_POLL_INTERVAL_SECONDS * 1000);
		});

		it('should use the configured value in milliseconds when above the minimum', () => {
			// Arrange
			const container = new LgSoundbarServiceContainer(logger, 60);

			// Act
			const result = container.pollIntervalMs;

			// Assert
			expect(result).toBe(60000);
		});
	});

	describe('shutdown', () => {
		it('should call stopPolling only if getService was already called at least once', () => {
			// Arrange
			const container = new LgSoundbarServiceContainer(logger, 30);
			const service = container.getService();

			// Act
			container.shutdown();

			// Assert
			expect(service.stopPolling).toHaveBeenCalledTimes(1);
		});

		it('should not construct the service when shutdown is called without a prior getService call', () => {
			// Arrange
			const container = new LgSoundbarServiceContainer(logger, 30);

			// Act
			container.shutdown();

			// Assert
			expect(vi.mocked(LgSoundbarService)).not.toHaveBeenCalled();
		});
	});
});
