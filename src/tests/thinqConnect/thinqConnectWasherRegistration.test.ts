import type { MatterbridgeEndpoint } from 'matterbridge';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { ThinqConnectMatterIdentityOverride } from '../../thinqConnect/thinqConnectMatterIdentity.js';
import { buildThinqConnectWasherEndpoint } from '../../thinqConnect/thinqConnectWasherEndpoint.js';
import { registerThinqConnectWashers } from '../../thinqConnect/thinqConnectWasherRegistration.js';
import type { ThinqConnectWasher, ThinqConnectWasherService } from '../../thinqConnect/thinqConnectWasherService.js';
import { asPartial, createMockLogger } from '../helpers/testUtils.js';

vi.mock('../../thinqConnect/thinqConnectWasherEndpoint.js', () => ({
	buildThinqConnectWasherEndpoint: vi.fn(),
}));

const ENDPOINTS = new Map<string, MatterbridgeEndpoint>();

function endpointFor(deviceId: string): MatterbridgeEndpoint {
	const existing = ENDPOINTS.get(deviceId);
	if (existing) {
		return existing;
	}
	const endpoint = asPartial<MatterbridgeEndpoint>({});
	ENDPOINTS.set(deviceId, endpoint);
	return endpoint;
}

/** Shapes follow the real washer profile in workspace/device-dumps/v2-washer-connect-probe-raw.json (fake ids). */
function buildWasher(deviceId: string, name: string): ThinqConnectWasher {
	return {
		deviceId,
		name,
		modelName: 'WASHER-MODEL-FAKE',
		locationName: 'MAIN',
		operationMode: { writable: true, allowedValues: ['POWER_OFF', 'POWER_ON'] },
	};
}

const IGNORED_ID = 'ignored-washer';

describe('registerThinqConnectWashers', () => {
	type Service = Pick<ThinqConnectWasherService, 'discoverWashers' | 'setPower'>;

	let logger: ReturnType<typeof createMockLogger>;
	let deps: {
		service: { [K in keyof Service]: Mock<Service[K]> };
		logger: ReturnType<typeof createMockLogger>;
		isIgnored: Mock<(deviceId: string) => boolean>;
		registerDevice: Mock<(endpoint: MatterbridgeEndpoint) => Promise<void>>;
		unregisterIgnoredDevice: Mock<(deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>>;
		remember: Mock<(deviceId: string, endpoint: MatterbridgeEndpoint) => void>;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		ENDPOINTS.clear();
		logger = createMockLogger();
		deps = {
			service: {
				discoverWashers: vi.fn<Service['discoverWashers']>(),
				setPower: vi.fn<Service['setPower']>(),
			},
			logger,
			isIgnored: vi.fn((deviceId: string): boolean => deviceId === IGNORED_ID),
			registerDevice: vi.fn<(endpoint: MatterbridgeEndpoint) => Promise<void>>().mockResolvedValue(undefined),
			unregisterIgnoredDevice: vi
				.fn<(deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>>()
				.mockResolvedValue(undefined),
			remember: vi.fn<(deviceId: string, endpoint: MatterbridgeEndpoint) => void>(),
		};
		vi.mocked(buildThinqConnectWasherEndpoint).mockImplementation((washer) => endpointFor(washer.deviceId));
	});

	it('should build, register and remember both washers and return both when none is ignored', async () => {
		// Arrange
		const mainWasher = buildWasher('washer-fake-1', 'Laundry');
		const guestWasher = buildWasher('washer-fake-2', 'Guest Laundry');
		deps.service.discoverWashers.mockResolvedValue([mainWasher, guestWasher]);

		// Act
		const result = await registerThinqConnectWashers(deps);

		// Assert
		expect(deps.registerDevice).toHaveBeenCalledWith(endpointFor('washer-fake-1'));
		expect(deps.registerDevice).toHaveBeenCalledWith(endpointFor('washer-fake-2'));
		expect(deps.remember).toHaveBeenNthCalledWith(1, 'washer-fake-1', endpointFor('washer-fake-1'));
		expect(deps.remember).toHaveBeenNthCalledWith(2, 'washer-fake-2', endpointFor('washer-fake-2'));
		expect(result).toEqual([mainWasher, guestWasher]);
	});

	it('should unregister an ignored washer without registering or remembering it, and keep the other washer', async () => {
		// Arrange
		const ignoredWasher = buildWasher(IGNORED_ID, 'Ignored Laundry');
		const keptWasher = buildWasher('washer-fake-2', 'Guest Laundry');
		deps.service.discoverWashers.mockResolvedValue([ignoredWasher, keptWasher]);

		// Act
		const result = await registerThinqConnectWashers(deps);

		// Assert
		expect(deps.unregisterIgnoredDevice).toHaveBeenCalledWith(IGNORED_ID, endpointFor(IGNORED_ID));
		expect(deps.registerDevice).toHaveBeenCalledTimes(1);
		expect(deps.registerDevice).toHaveBeenCalledWith(endpointFor('washer-fake-2'));
		expect(deps.remember).toHaveBeenCalledTimes(1);
		expect(deps.remember).not.toHaveBeenCalledWith(IGNORED_ID, expect.anything());
		expect(result).toEqual([keptWasher]);
	});

	it('should return an empty list and register nothing when every washer is ignored', async () => {
		// Arrange
		deps.service.discoverWashers.mockResolvedValue([buildWasher(IGNORED_ID, 'Ignored Laundry')]);
		deps.isIgnored.mockReturnValue(true);

		// Act
		const result = await registerThinqConnectWashers(deps);

		// Assert
		expect(result).toEqual([]);
		expect(deps.registerDevice).not.toHaveBeenCalled();
		expect(deps.remember).not.toHaveBeenCalled();
	});

	it('should check the ignore setting with each washer deviceId', async () => {
		// Arrange
		deps.service.discoverWashers.mockResolvedValue([buildWasher('washer-fake-1', 'Laundry')]);

		// Act
		await registerThinqConnectWashers(deps);

		// Assert
		expect(deps.isIgnored).toHaveBeenCalledWith('washer-fake-1');
	});

	it('should log the error with the washer id and still register the other washer when the builder throws', async () => {
		// Arrange
		const secondWasher = buildWasher('washer-fake-2', 'Guest Laundry');
		deps.service.discoverWashers.mockResolvedValue([buildWasher('washer-fake-1', 'Laundry'), secondWasher]);
		vi.mocked(buildThinqConnectWasherEndpoint).mockImplementationOnce(() => {
			throw new Error('bad profile');
		});

		// Act
		const result = await registerThinqConnectWashers(deps);

		// Assert
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('washer-fake-1'));
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('bad profile'));
		expect(deps.registerDevice).toHaveBeenCalledTimes(1);
		expect(deps.remember).toHaveBeenCalledWith('washer-fake-2', endpointFor('washer-fake-2'));
		expect(result).toEqual([secondWasher]);
	});

	it('should log the error and skip the washer, without remembering it, when registerDevice rejects', async () => {
		// Arrange
		const secondWasher = buildWasher('washer-fake-2', 'Guest Laundry');
		deps.service.discoverWashers.mockResolvedValue([buildWasher('washer-fake-1', 'Laundry'), secondWasher]);
		deps.registerDevice.mockRejectedValueOnce(new Error('bridge refused'));

		// Act
		const result = await registerThinqConnectWashers(deps);

		// Assert
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('bridge refused'));
		expect(deps.remember).toHaveBeenCalledTimes(1);
		expect(deps.remember).not.toHaveBeenCalledWith('washer-fake-1', expect.anything());
		expect(result).toEqual([secondWasher]);
	});

	it('should reject when discoverWashers rejects', async () => {
		// Arrange
		deps.service.discoverWashers.mockRejectedValue(new Error('devices unavailable'));

		// Act & Assert
		await expect(registerThinqConnectWashers(deps)).rejects.toThrow('devices unavailable');
		expect(deps.registerDevice).not.toHaveBeenCalled();
	});

	it('should pass the resolved identity override to the builder', async () => {
		// Arrange
		const washer = buildWasher('washer-fake-1', 'Laundry');
		const identity: ThinqConnectMatterIdentityOverride = { productName: 'Den Washer' };
		const resolveIdentity = vi.fn((): ThinqConnectMatterIdentityOverride => identity);
		deps.service.discoverWashers.mockResolvedValue([washer]);

		// Act
		await registerThinqConnectWashers({ ...deps, resolveIdentity });

		// Assert
		expect(resolveIdentity).toHaveBeenCalledWith('washer-fake-1');
		expect(buildThinqConnectWasherEndpoint).toHaveBeenCalledWith(washer, deps.service, logger, identity);
	});

	it('should pass an undefined identity to the builder when resolveIdentity is omitted', async () => {
		// Arrange
		const washer = buildWasher('washer-fake-1', 'Laundry');
		deps.service.discoverWashers.mockResolvedValue([washer]);

		// Act
		await registerThinqConnectWashers(deps);

		// Assert
		expect(buildThinqConnectWasherEndpoint).toHaveBeenCalledWith(washer, deps.service, logger, undefined);
	});
});
