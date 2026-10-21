import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import { ThinqConnectApiClient } from '../../services/thinqConnect/thinqConnectApiClient.js';
import { ThinqServiceV2Container, type ThinqV2Options } from '../../thinqV2/thinqServiceV2Container.js';
import { asPartial, createMockLogger } from '../helpers/testUtils.js';

vi.mock('../../services/thinqConnect/thinqConnectApiClient.js', () => ({
	ThinqConnectApiClient: vi.fn(),
}));

const PAT_SENTINEL = 'pat-sentinel-do-not-log-1234567890';

function createOptions(overrides: Partial<ThinqV2Options> = {}): ThinqV2Options {
	return { personalAccessToken: PAT_SENTINEL, country: 'US', pollIntervalSeconds: 60, ...overrides };
}

describe('ThinqServiceV2Container', () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
			return asPartial<ThinqConnectApiClient>({ getDevices: vi.fn() });
		});
	});

	describe('getConnectApiClient', () => {
		it('should return the same client instance on repeated calls', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions());

			// Act
			const client1 = container.getConnectApiClient();
			const client2 = container.getConnectApiClient();

			// Assert
			expect(client1).toBe(client2);
		});

		it('should construct ThinqConnectApiClient with the token, country and logger', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions({ country: 'DE' }));

			// Act
			container.getConnectApiClient();

			// Assert
			expect(ThinqConnectApiClient).toHaveBeenCalledWith(PAT_SENTINEL, 'DE', logger);
		});

		it('should not construct the client until getConnectApiClient is called', () => {
			// Arrange & Act
			const container = new ThinqServiceV2Container(logger, createOptions({ personalAccessToken: '' }));

			// Assert
			expect(container).toBeDefined();
			expect(ThinqConnectApiClient).not.toHaveBeenCalled();
		});

		it('should throw when the client rejects an empty token, only at getConnectApiClient time', () => {
			// Arrange
			vi.mocked(ThinqConnectApiClient).mockImplementationOnce(function () {
				throw new ThinqConnectApiError('A ThinQ Personal Access Token is required', '1103');
			});
			const container = new ThinqServiceV2Container(logger, createOptions({ personalAccessToken: '' }));

			// Act & Assert
			expect(() => container.getConnectApiClient()).toThrow(ThinqConnectApiError);
		});
	});

	describe('getWasherService', () => {
		it('should return the same washer service instance on repeated calls', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions());

			// Act
			const service1 = container.getWasherService();
			const service2 = container.getWasherService();

			// Assert
			expect(service1).toBe(service2);
		});
	});

	describe('pollIntervalMs', () => {
		it('should return 60000 ms for a 60 second interval', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions({ pollIntervalSeconds: 60 }));

			// Act & Assert
			expect(container.pollIntervalMs).toBe(60000);
		});

		it('should clamp a 5 second interval up to 15000 ms', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions({ pollIntervalSeconds: 5 }));

			// Act & Assert
			expect(container.pollIntervalMs).toBe(15000);
		});

		it('should keep a 15 second interval at exactly 15000 ms', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions({ pollIntervalSeconds: 15 }));

			// Act & Assert
			expect(container.pollIntervalMs).toBe(15000);
		});
	});

	describe('shutdown', () => {
		it('should not throw when the washer service was never created', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions());

			// Act & Assert
			expect(() => container.shutdown()).not.toThrow();
		});

		it('should stop washer polling when the washer service was created', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions());
			const service = container.getWasherService();
			const stopSpy = vi.spyOn(service, 'stopPolling');

			// Act
			container.shutdown();

			// Assert
			expect(stopSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('logging', () => {
		it('should never log the PAT while creating and shutting down the client and service', () => {
			// Arrange
			const container = new ThinqServiceV2Container(logger, createOptions());

			// Act
			container.getWasherService();
			container.shutdown();

			// Assert
			const logged = [
				...vi.mocked(logger.debug).mock.calls,
				...vi.mocked(logger.info).mock.calls,
				...vi.mocked(logger.warn).mock.calls,
				...vi.mocked(logger.error).mock.calls,
			];
			expect(logged.flat().join(' ')).not.toContain(PAT_SENTINEL);
		});
	});
});
