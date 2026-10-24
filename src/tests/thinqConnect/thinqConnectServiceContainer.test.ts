import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import { ThinqConnectApiClient } from '../../services/thinqConnect/thinqConnectApiClient.js';
import type { ThinqConnectAirConditioner } from '../../thinqConnect/thinqConnectAirConditionerService.js';
import { type ThinqConnectPushHandlers, ThinqConnectPushService } from '../../thinqConnect/thinqConnectPushService.js';
import {
	type ThinqConnectOptions,
	ThinqConnectServiceContainer,
} from '../../thinqConnect/thinqConnectServiceContainer.js';
import type { ThinqConnectWasher } from '../../thinqConnect/thinqConnectWasherService.js';
import { asPartial, createMockLogger } from '../helpers/testUtils.js';

vi.mock('../../services/thinqConnect/thinqConnectApiClient.js', () => ({
	ThinqConnectApiClient: vi.fn(),
}));

vi.mock('../../thinqConnect/thinqConnectPushService.js', () => ({
	ThinqConnectPushService: vi.fn(),
}));

const PAT_SENTINEL = 'pat-sentinel-do-not-log-1234567890';
const CLIENT_ID = 'thinq-open-6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';

function createOptions(overrides: Partial<ThinqConnectOptions> = {}): ThinqConnectOptions {
	return { personalAccessToken: PAT_SENTINEL, country: 'US', pollIntervalSeconds: 60, ...overrides };
}

function handlersOf(start: Mock): ThinqConnectPushHandlers {
	const call = start.mock.calls[0];
	if (!call) {
		throw new Error('Push start was not called.');
	}
	return call[1];
}

describe('ThinqConnectServiceContainer push and poll coordination', () => {
	const washer = asPartial<ThinqConnectWasher>({ deviceId: 'w1', name: 'Washer' });
	const ac = asPartial<ThinqConnectAirConditioner>({ deviceId: 'ac1', name: 'AC' });
	let logger: ReturnType<typeof createMockLogger>;
	let pushStart: Mock;
	let pushStop: Mock;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		pushStart = vi.fn();
		pushStop = vi.fn().mockResolvedValue(undefined);
		vi.mocked(ThinqConnectApiClient).mockImplementation(function () {
			return asPartial<ThinqConnectApiClient>({ getDevices: vi.fn() });
		});
		vi.mocked(ThinqConnectPushService).mockImplementation(function () {
			return asPartial<ThinqConnectPushService>({ start: pushStart, stop: pushStop });
		});
	});

	describe('client id', () => {
		it('should pass the client id as the fourth argument when clientId is configured', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ clientId: CLIENT_ID }));

			// Act
			container.getConnectApiClient();

			// Assert
			expect(ThinqConnectApiClient).toHaveBeenCalledWith(PAT_SENTINEL, 'US', logger, CLIENT_ID);
		});
	});

	describe('safetyPollIntervalMs', () => {
		it.each([
			[60, 300_000],
			[300, 300_000],
			[600, 600_000],
		])('should use max(configured, 300 s) for a %i s configured interval', (seconds, expectedMs) => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ pollIntervalSeconds: seconds }));

			// Act & Assert
			expect(container.safetyPollIntervalMs).toBe(expectedMs);
		});
	});

	describe('startPush', () => {
		it('should start the push service with the washer and air conditioner ids', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act
			container.startPush({ washers: [washer], airConditioners: [ac] });

			// Assert
			expect(pushStart).toHaveBeenCalledWith(['w1', 'ac1'], {
				onDeviceEvent: expect.any(Function),
				onHealthChange: expect.any(Function),
			});
		});

		it('should call the matching service refreshState for a known device and nothing for an unknown one', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			const washerRefresh = vi.spyOn(container.getWasherService(), 'refreshState').mockResolvedValue(undefined);
			const acRefresh = vi.spyOn(container.getAirConditionerService(), 'refreshState').mockResolvedValue(undefined);
			container.startPush({ washers: [washer], airConditioners: [ac] });
			const handlers = handlersOf(pushStart);

			// Act
			handlers.onDeviceEvent('w1');
			handlers.onDeviceEvent('ac1');
			handlers.onDeviceEvent('unknown');

			// Assert
			expect(washerRefresh).toHaveBeenCalledTimes(1);
			expect(washerRefresh).toHaveBeenCalledWith(washer);
			expect(acRefresh).toHaveBeenCalledTimes(1);
			expect(acRefresh).toHaveBeenCalledWith(ac);
		});

		it('should switch both services to the safety interval without an immediate poll when healthy', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			const washerPoll = vi.spyOn(container.getWasherService(), 'setPollInterval').mockImplementation(() => undefined);
			const acPoll = vi
				.spyOn(container.getAirConditionerService(), 'setPollInterval')
				.mockImplementation(() => undefined);
			container.startPush({ washers: [washer], airConditioners: [ac] });

			// Act
			handlersOf(pushStart).onHealthChange(true);

			// Assert
			expect(washerPoll).toHaveBeenCalledWith(300_000, false);
			expect(acPoll).toHaveBeenCalledWith(300_000, false);
		});

		it('should restore the configured interval with an immediate poll when unhealthy', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ pollIntervalSeconds: 60 }));
			const washerPoll = vi.spyOn(container.getWasherService(), 'setPollInterval').mockImplementation(() => undefined);
			const acPoll = vi
				.spyOn(container.getAirConditionerService(), 'setPollInterval')
				.mockImplementation(() => undefined);
			container.startPush({ washers: [washer], airConditioners: [ac] });

			// Act
			handlersOf(pushStart).onHealthChange(false);

			// Assert
			expect(washerPoll).toHaveBeenCalledWith(60_000, true);
			expect(acPoll).toHaveBeenCalledWith(60_000, true);
		});
	});

	describe('stopPush and shutdown', () => {
		it('should resolve without error when stopPush is called before push was created', async () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act & Assert
			await expect(container.stopPush()).resolves.toBeUndefined();
			expect(ThinqConnectPushService).not.toHaveBeenCalled();
		});

		it('should await the push service stop when stopPush is called', async () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			container.startPush({ washers: [washer], airConditioners: [ac] });

			// Act
			await container.stopPush();

			// Assert
			expect(pushStop).toHaveBeenCalledTimes(1);
		});

		it('should keep shutdown synchronous and stop both pollers and push', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			container.startPush({ washers: [washer], airConditioners: [ac] });
			const washerStop = vi.spyOn(container.getWasherService(), 'stopPolling');
			const acStop = vi.spyOn(container.getAirConditionerService(), 'stopPolling');

			// Act
			const result: unknown = container.shutdown();

			// Assert
			expect(result).toBeUndefined();
			expect(washerStop).toHaveBeenCalledTimes(1);
			expect(acStop).toHaveBeenCalledTimes(1);
			expect(pushStop).toHaveBeenCalledTimes(1);
		});

		it('should delegate to the idempotent push stop again when shutdown follows stopPush', async () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			container.startPush({ washers: [washer], airConditioners: [ac] });
			await container.stopPush();

			// Act
			container.shutdown();

			// Assert
			expect(pushStop).toHaveBeenCalledTimes(2);
		});

		it('should not log the PAT while starting push and shutting down', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act
			container.startPush({ washers: [washer], airConditioners: [ac] });
			container.shutdown();

			// Assert
			const logged = [logger.debug, logger.info, logger.warn, logger.error].flatMap((fn) =>
				vi.mocked(fn).mock.calls.map((args) => args.map(String).join(' ')),
			);
			expect(logged.join(' ')).not.toContain(PAT_SENTINEL);
		});
	});
});

describe('ThinqConnectServiceContainer', () => {
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
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act
			const client1 = container.getConnectApiClient();
			const client2 = container.getConnectApiClient();

			// Assert
			expect(client1).toBe(client2);
		});

		it('should construct ThinqConnectApiClient with the token, country and logger', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ country: 'DE' }));

			// Act
			container.getConnectApiClient();

			// Assert
			expect(ThinqConnectApiClient).toHaveBeenCalledWith(PAT_SENTINEL, 'DE', logger);
		});

		it('should not construct the client until getConnectApiClient is called', () => {
			// Arrange & Act
			const container = new ThinqConnectServiceContainer(logger, createOptions({ personalAccessToken: '' }));

			// Assert
			expect(container).toBeDefined();
			expect(ThinqConnectApiClient).not.toHaveBeenCalled();
		});

		it('should throw when the client rejects an empty token, only at getConnectApiClient time', () => {
			// Arrange
			vi.mocked(ThinqConnectApiClient).mockImplementationOnce(function () {
				throw new ThinqConnectApiError('A ThinQ Personal Access Token is required', '1103');
			});
			const container = new ThinqConnectServiceContainer(logger, createOptions({ personalAccessToken: '' }));

			// Act & Assert
			expect(() => container.getConnectApiClient()).toThrow(ThinqConnectApiError);
		});
	});

	describe('getWasherService', () => {
		it('should return the same washer service instance on repeated calls', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act
			const service1 = container.getWasherService();
			const service2 = container.getWasherService();

			// Assert
			expect(service1).toBe(service2);
		});
	});

	describe('getAirConditionerService', () => {
		it('should return the same air conditioner service instance on repeated calls', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act
			const service1 = container.getAirConditionerService();
			const service2 = container.getAirConditionerService();

			// Assert
			expect(service1).toBe(service2);
		});

		it('should share the same Connect API client as the washer service', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act
			const airConditionerService = container.getAirConditionerService();
			const washerService = container.getWasherService();

			// Assert
			expect(airConditionerService['client']).toBe(container.getConnectApiClient());
			expect(airConditionerService['client']).toBe(washerService['client']);
		});
	});

	describe('pollIntervalMs', () => {
		it('should return 60000 ms for a 60 second interval', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ pollIntervalSeconds: 60 }));

			// Act & Assert
			expect(container.pollIntervalMs).toBe(60000);
		});

		it('should clamp a 5 second interval up to 15000 ms', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ pollIntervalSeconds: 5 }));

			// Act & Assert
			expect(container.pollIntervalMs).toBe(15000);
		});

		it('should keep a 15 second interval at exactly 15000 ms', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions({ pollIntervalSeconds: 15 }));

			// Act & Assert
			expect(container.pollIntervalMs).toBe(15000);
		});
	});

	describe('shutdown', () => {
		it('should not throw when the washer service was never created', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act & Assert
			expect(() => container.shutdown()).not.toThrow();
		});

		it('should stop washer polling when the washer service was created', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			const service = container.getWasherService();
			const stopSpy = vi.spyOn(service, 'stopPolling');

			// Act
			container.shutdown();

			// Assert
			expect(stopSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('shutdown with air conditioner polling', () => {
		it('should not throw when the air conditioner service was never created', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

			// Act & Assert
			expect(() => container.shutdown()).not.toThrow();
		});

		it('should stop air conditioner polling and still stop washer polling', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());
			const airConditionerService = container.getAirConditionerService();
			const washerService = container.getWasherService();
			const airStopSpy = vi.spyOn(airConditionerService, 'stopPolling');
			const washerStopSpy = vi.spyOn(washerService, 'stopPolling');

			// Act
			container.shutdown();

			// Assert
			expect(airStopSpy).toHaveBeenCalledTimes(1);
			expect(washerStopSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('logging', () => {
		it('should never log the PAT while creating and shutting down the client and service', () => {
			// Arrange
			const container = new ThinqConnectServiceContainer(logger, createOptions());

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
