import type { MatterbridgeEndpoint } from 'matterbridge';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { readAirConditionerProfile } from '../../services/thinqConnect/thinqConnectAirConditioner.js';
import { buildThinqV2AirConditionerEndpoint } from '../../thinqV2/thinqV2AirConditionerEndpoint.js';
import { registerThinqV2AirConditioners } from '../../thinqV2/thinqV2AirConditionerRegistration.js';
import type {
	ThinqV2AirConditioner,
	ThinqV2AirConditionerService,
} from '../../thinqV2/thinqV2AirConditionerService.js';
import type { ThinqV2MatterIdentityOverride } from '../../thinqV2/thinqV2MatterIdentity.js';
import { asPartial, createMockLogger } from '../helpers/testUtils.js';
import { STUDY_PROFILE } from '../helpers/thinqV2AirConditionerFixtures.js';

vi.mock('../../thinqV2/thinqV2AirConditionerEndpoint.js', () => ({
	buildThinqV2AirConditionerEndpoint: vi.fn(),
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

function buildAc(deviceId: string, name: string): ThinqV2AirConditioner {
	return { deviceId, name, profile: readAirConditionerProfile(STUDY_PROFILE) };
}

describe('registerThinqV2AirConditioners', () => {
	type Service = Pick<
		ThinqV2AirConditionerService,
		'discoverAirConditioners' | 'setPower' | 'setCoolMode' | 'setTargetTemperature' | 'setWindStrength' | 'setSwing'
	>;

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
				discoverAirConditioners: vi.fn<Service['discoverAirConditioners']>(),
				setPower: vi.fn<Service['setPower']>(),
				setCoolMode: vi.fn<Service['setCoolMode']>(),
				setTargetTemperature: vi.fn<Service['setTargetTemperature']>(),
				setWindStrength: vi.fn<Service['setWindStrength']>(),
				setSwing: vi.fn<Service['setSwing']>(),
			},
			logger,
			isIgnored: vi.fn((deviceId: string): boolean => deviceId === 'ignored-ac'),
			registerDevice: vi.fn<(endpoint: MatterbridgeEndpoint) => Promise<void>>().mockResolvedValue(undefined),
			unregisterIgnoredDevice: vi
				.fn<(deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>>()
				.mockResolvedValue(undefined),
			remember: vi.fn<(deviceId: string, endpoint: MatterbridgeEndpoint) => void>(),
		};
		vi.mocked(buildThinqV2AirConditionerEndpoint).mockImplementation((ac) => endpointFor(ac.deviceId));
	});

	it('should register and remember both air conditioners and return both', async () => {
		// Arrange
		const studyAc = buildAc('study-ac', 'Study Room AC');
		const bedroomAc = buildAc('bedroom-ac', 'Bedroom AC');
		deps.service.discoverAirConditioners.mockResolvedValue([studyAc, bedroomAc]);

		// Act
		const result = await registerThinqV2AirConditioners(deps);

		// Assert
		expect(deps.registerDevice).toHaveBeenCalledWith(endpointFor('study-ac'));
		expect(deps.registerDevice).toHaveBeenCalledWith(endpointFor('bedroom-ac'));
		expect(deps.remember).toHaveBeenCalledWith('study-ac', endpointFor('study-ac'));
		expect(deps.remember).toHaveBeenCalledWith('bedroom-ac', endpointFor('bedroom-ac'));
		expect(result).toEqual([studyAc, bedroomAc]);
	});

	it('should unregister an ignored air conditioner without registering or remembering it', async () => {
		// Arrange
		deps.service.discoverAirConditioners.mockResolvedValue([buildAc('ignored-ac', 'Ignored AC')]);

		// Act
		const result = await registerThinqV2AirConditioners(deps);

		// Assert
		expect(deps.unregisterIgnoredDevice).toHaveBeenCalledWith('ignored-ac', endpointFor('ignored-ac'));
		expect(deps.registerDevice).not.toHaveBeenCalled();
		expect(deps.remember).not.toHaveBeenCalled();
		expect(result).toEqual([]);
	});

	it('should log the error and still register the second air conditioner when the first registration rejects', async () => {
		// Arrange
		const secondAc = buildAc('bedroom-ac', 'Bedroom AC');
		deps.service.discoverAirConditioners.mockResolvedValue([buildAc('study-ac', 'Study Room AC'), secondAc]);
		deps.registerDevice.mockRejectedValueOnce(new Error('bridge refused'));

		// Act
		const result = await registerThinqV2AirConditioners(deps);

		// Assert
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('bridge refused'));
		expect(deps.remember).toHaveBeenCalledTimes(1);
		expect(deps.remember).toHaveBeenCalledWith('bedroom-ac', endpointFor('bedroom-ac'));
		expect(result).toEqual([secondAc]);
	});

	it('should return an empty list and register nothing when no air conditioners are discovered', async () => {
		// Arrange
		deps.service.discoverAirConditioners.mockResolvedValue([]);

		// Act
		const result = await registerThinqV2AirConditioners(deps);

		// Assert
		expect(result).toEqual([]);
		expect(deps.registerDevice).not.toHaveBeenCalled();
		expect(deps.remember).not.toHaveBeenCalled();
	});

	it('should propagate a discovery failure without registering anything so the caller can isolate it', async () => {
		// Arrange
		deps.service.discoverAirConditioners.mockRejectedValue(new Error('discovery unavailable'));

		// Act & Assert
		await expect(registerThinqV2AirConditioners(deps)).rejects.toThrow('discovery unavailable');
		expect(deps.registerDevice).not.toHaveBeenCalled();
	});

	describe('identity resolution', () => {
		it('should pass the identity returned by resolveIdentity for each device to the endpoint builder', async () => {
			// Arrange
			const studyAc = buildAc('study-ac', 'Study Room AC');
			const bedroomAc = buildAc('bedroom-ac', 'Bedroom AC');
			deps.service.discoverAirConditioners.mockResolvedValue([studyAc, bedroomAc]);
			const resolveIdentity = vi.fn<(deviceId: string) => ThinqV2MatterIdentityOverride>((deviceId) =>
				deviceId === 'study-ac' ? { productName: 'Study AC' } : { vendorName: 'Acme' },
			);

			// Act
			await registerThinqV2AirConditioners({ ...deps, resolveIdentity });

			// Assert
			expect(resolveIdentity).toHaveBeenCalledWith('study-ac');
			expect(resolveIdentity).toHaveBeenCalledWith('bedroom-ac');
			expect(buildThinqV2AirConditionerEndpoint).toHaveBeenCalledWith(studyAc, deps.service, logger, {
				productName: 'Study AC',
			});
			expect(buildThinqV2AirConditionerEndpoint).toHaveBeenCalledWith(bedroomAc, deps.service, logger, {
				vendorName: 'Acme',
			});
		});

		it('should build and register the air conditioner with no identity override when resolveIdentity is absent', async () => {
			// Arrange
			const studyAc = buildAc('study-ac', 'Study Room AC');
			deps.service.discoverAirConditioners.mockResolvedValue([studyAc]);

			// Act
			const result = await registerThinqV2AirConditioners(deps);

			// Assert
			expect(vi.mocked(buildThinqV2AirConditionerEndpoint).mock.calls[0]?.[3]).toBeUndefined();
			expect(deps.registerDevice).toHaveBeenCalledWith(endpointFor('study-ac'));
			expect(result).toEqual([studyAc]);
		});
	});
});
