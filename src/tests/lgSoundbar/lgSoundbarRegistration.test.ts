import type { MatterbridgeEndpoint } from 'matterbridge';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LgSoundbarRegistrationDeps, registerLgSoundbars } from '../../lgSoundbar/lgSoundbarRegistration.js';
import type { LgSoundbarDeviceConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { LgSoundbar, LgSoundbarService } from '../../services/lgSoundbar/lgSoundbarService.js';
import { asPartial, createMockLogger } from '../helpers/testUtils.js';

const mocks = vi.hoisted(() => ({
	endpoints: new Map<string, { id: string }>(),
}));

vi.mock('../../lgSoundbar/lgSoundbarEndpoint.js', () => ({
	buildLgSoundbarEndpoint: vi.fn((soundbar: LgSoundbar) => {
		const endpoint = { id: soundbar.deviceId };
		mocks.endpoints.set(soundbar.deviceId, endpoint);
		return endpoint;
	}),
}));

interface MockService {
	discoverSoundbars: Mock<LgSoundbarService['discoverSoundbars']>;
	setPower: Mock<LgSoundbarService['setPower']>;
	setVolume: Mock<LgSoundbarService['setVolume']>;
}

function createMockService(soundbars: LgSoundbar[]): MockService {
	return {
		discoverSoundbars: vi.fn().mockReturnValue(soundbars),
		setPower: vi.fn(),
		setVolume: vi.fn(),
	};
}

function endpointFor(deviceId: string): MatterbridgeEndpoint {
	const endpoint = mocks.endpoints.get(deviceId);
	if (!endpoint) {
		throw new Error(`no endpoint built for ${deviceId}`);
	}
	return asPartial<MatterbridgeEndpoint>(endpoint);
}

describe('registerLgSoundbars', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let isIgnored: Mock<(deviceId: string) => boolean>;
	let registerDevice: Mock<(endpoint: MatterbridgeEndpoint) => Promise<void>>;
	let unregisterIgnoredDevice: Mock<(deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>>;
	let remember: Mock<(deviceId: string, endpoint: MatterbridgeEndpoint) => void>;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.endpoints.clear();
		logger = createMockLogger();
		isIgnored = vi.fn().mockReturnValue(false);
		registerDevice = vi.fn().mockResolvedValue(undefined);
		unregisterIgnoredDevice = vi.fn().mockResolvedValue(undefined);
		remember = vi.fn();
	});

	function buildDeps(
		service: MockService,
		configs: readonly LgSoundbarDeviceConfig[] = [],
	): LgSoundbarRegistrationDeps {
		return {
			service,
			configs,
			logger,
			isIgnored,
			registerDevice,
			unregisterIgnoredDevice,
			remember,
		};
	}

	it('should register one endpoint per soundbar and return the registered soundbars', async () => {
		// Arrange
		const soundbars: LgSoundbar[] = [
			{ deviceId: 'sb1', name: 'Soundbar 1', host: '10.0.0.5', port: 9741 },
			{ deviceId: 'sb2', name: 'Soundbar 2', host: '10.0.0.6', port: 9741 },
		];
		const service = createMockService(soundbars);

		// Act
		const registered = await registerLgSoundbars(buildDeps(service));

		// Assert
		expect(registerDevice).toHaveBeenCalledTimes(2);
		expect(remember).toHaveBeenCalledWith('sb1', endpointFor('sb1'));
		expect(remember).toHaveBeenCalledWith('sb2', endpointFor('sb2'));
		expect(registered).toEqual(soundbars);
	});

	it('should pass an ignored device to unregisterIgnoredDevice and exclude it from the returned array', async () => {
		// Arrange
		const soundbars: LgSoundbar[] = [
			{ deviceId: 'sb1', name: 'Soundbar 1', host: '10.0.0.5', port: 9741 },
			{ deviceId: 'sb2', name: 'Soundbar 2', host: '10.0.0.6', port: 9741 },
		];
		const service = createMockService(soundbars);
		isIgnored.mockImplementation((deviceId: string) => deviceId === 'sb2');

		// Act
		const registered = await registerLgSoundbars(buildDeps(service));

		// Assert
		expect(unregisterIgnoredDevice).toHaveBeenCalledWith('sb2', endpointFor('sb2'));
		expect(registerDevice).not.toHaveBeenCalledWith(endpointFor('sb2'));
		expect(remember).not.toHaveBeenCalledWith('sb2', expect.anything());
		expect(registered).toEqual([soundbars[0]]);
	});

	it('should log and skip a device whose registerDevice rejects, without blocking the remaining soundbars', async () => {
		// Arrange
		const soundbars: LgSoundbar[] = [
			{ deviceId: 'sb1', name: 'Soundbar 1', host: '10.0.0.5', port: 9741 },
			{ deviceId: 'sb2', name: 'Soundbar 2', host: '10.0.0.6', port: 9741 },
		];
		const service = createMockService(soundbars);
		registerDevice.mockImplementation((endpoint: MatterbridgeEndpoint) => {
			if (endpoint.id === 'sb1') {
				return Promise.reject(new Error('registration failed'));
			}
			return Promise.resolve();
		});

		// Act
		const registered = await registerLgSoundbars(buildDeps(service));

		// Assert
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('sb1'));
		expect(remember).toHaveBeenCalledWith('sb2', endpointFor('sb2'));
		expect(registered).toEqual([soundbars[1]]);
	});

	it('should return an empty array when discoverSoundbars returns no soundbars', async () => {
		// Arrange
		const service = createMockService([]);

		// Act
		const registered = await registerLgSoundbars(buildDeps(service));

		// Assert
		expect(registered).toEqual([]);
		expect(registerDevice).not.toHaveBeenCalled();
	});
});
