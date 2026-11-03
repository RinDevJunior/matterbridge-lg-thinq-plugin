import { Speaker } from 'matterbridge/devices';
import { LevelControl, ModeSelect, OnOff } from 'matterbridge/matter/clusters';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	applyLgSoundbarState,
	buildLgSoundbarEndpoint,
	LG_SOUNDBAR_SOUND_MODES,
	mapDeviceVolumeToMatterLevel,
	mapMatterLevelToDeviceVolume,
	narrowSoundModes,
} from '../../lgSoundbar/lgSoundbarEndpoint.js';
import type { LgSoundbar, LgSoundbarService, LgSoundbarState } from '../../services/lgSoundbar/lgSoundbarService.js';
import { createMockLogger } from '../helpers/testUtils.js';

const mocks = vi.hoisted(() => ({
	endpoint: {
		mode: undefined as string | undefined,
		createDefaultBasicInformationClusterServer: vi.fn(),
		createDefaultModeSelectClusterServer: vi.fn(),
		addCommandHandler: vi.fn(),
		updateAttribute: vi.fn(),
	},
}));

vi.mock('matterbridge/devices', () => ({
	Speaker: vi.fn(function () {
		return mocks.endpoint;
	}),
}));

type CommandName = 'on' | 'off' | 'moveToLevel' | 'moveToLevelWithOnOff' | 'changeToMode';

interface MockService {
	setPower: Mock<LgSoundbarService['setPower']>;
	setVolume: Mock<LgSoundbarService['setVolume']>;
	setSoundMode: Mock<LgSoundbarService['setSoundMode']>;
}

const SOUNDBAR: LgSoundbar = { deviceId: 'sb1', name: 'Soundbar', host: '10.0.0.5', port: 9741 };

function createMockService(): MockService {
	return {
		setPower: vi.fn<LgSoundbarService['setPower']>(),
		setVolume: vi.fn<LgSoundbarService['setVolume']>(),
		setSoundMode: vi.fn<LgSoundbarService['setSoundMode']>(),
	};
}

function getHandler(name: CommandName): (...args: unknown[]) => Promise<void> {
	const call = mocks.endpoint.addCommandHandler.mock.calls.find((entry: unknown[]) => entry[0] === name);
	if (!call) {
		throw new Error(`no ${name} handler registered`);
	}
	return call[1] as (...args: unknown[]) => Promise<void>;
}

describe('lgSoundbarEndpoint', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let service: MockService;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		service = createMockService();
		mocks.endpoint.mode = undefined;
	});

	describe('mapDeviceVolumeToMatterLevel', () => {
		it('should map the mid-range value proportionally into [1,254]', () => {
			// Act
			const result = mapDeviceVolumeToMatterLevel(20, 0, 40);

			// Assert
			expect(result).toBe(128);
		});

		it('should map volume === min to 1', () => {
			// Act
			const result = mapDeviceVolumeToMatterLevel(0, 0, 40);

			// Assert
			expect(result).toBe(1);
		});

		it('should map volume === max to 254', () => {
			// Act
			const result = mapDeviceVolumeToMatterLevel(40, 0, 40);

			// Assert
			expect(result).toBe(254);
		});

		it('should return 1 when min === max, avoiding a divide-by-zero', () => {
			// Act
			const result = mapDeviceVolumeToMatterLevel(10, 10, 10);

			// Assert
			expect(result).toBe(1);
		});
	});

	describe('mapMatterLevelToDeviceVolume', () => {
		it('should be the inverse of mapDeviceVolumeToMatterLevel at the mid-range sample point', () => {
			// Act
			const result = mapMatterLevelToDeviceVolume(128, 0, 40);

			// Assert
			expect(result).toBe(20);
		});

		it('should map level 1 (MATTER_LEVEL_MIN) to min', () => {
			// Act
			const result = mapMatterLevelToDeviceVolume(1, 0, 40);

			// Assert
			expect(result).toBe(0);
		});

		it('should map level 254 (MATTER_LEVEL_MAX) to max', () => {
			// Act
			const result = mapMatterLevelToDeviceVolume(254, 0, 40);

			// Assert
			expect(result).toBe(40);
		});

		it('should clamp an out-of-range level of 0 into [min,max]', () => {
			// Act
			const result = mapMatterLevelToDeviceVolume(0, 0, 40);

			// Assert
			expect(result).toBe(0);
		});

		it('should clamp an out-of-range level of 300 into [min,max]', () => {
			// Act
			const result = mapMatterLevelToDeviceVolume(300, 0, 40);

			// Assert
			expect(result).toBe(40);
		});

		it('should return min when min === max, avoiding a divide-by-zero', () => {
			// Act
			const result = mapMatterLevelToDeviceVolume(100, 10, 10);

			// Assert
			expect(result).toBe(10);
		});
	});

	describe('narrowSoundModes', () => {
		it('should return the mapped subset for a valid, non-empty array of in-range indices', () => {
			// Act
			const result = narrowSoundModes([0, 5, 12]);

			// Assert
			expect(result).toEqual([
				{ label: LG_SOUNDBAR_SOUND_MODES[0].label, mode: 0, semanticTags: [] },
				{ label: LG_SOUNDBAR_SOUND_MODES[5].label, mode: 5, semanticTags: [] },
				{ label: LG_SOUNDBAR_SOUND_MODES[12].label, mode: 12, semanticTags: [] },
			]);
		});

		it('should dedupe repeated indices', () => {
			// Act
			const result = narrowSoundModes([2, 2, 5]);

			// Assert
			expect(result).toHaveLength(2);
			expect(result.map((o) => o.mode)).toEqual([2, 5]);
		});

		it('should return the full list when given undefined', () => {
			// Act
			const result = narrowSoundModes(undefined);

			// Assert
			expect(result).toEqual(LG_SOUNDBAR_SOUND_MODES);
		});

		it('should return the full list when given an empty array', () => {
			// Act
			const result = narrowSoundModes([]);

			// Assert
			expect(result).toEqual(LG_SOUNDBAR_SOUND_MODES);
		});

		it('should return the full list when every index is out of range', () => {
			// Act
			const result = narrowSoundModes([99, -1]);

			// Assert
			expect(result).toEqual(LG_SOUNDBAR_SOUND_MODES);
		});
	});

	describe('buildLgSoundbarEndpoint', () => {
		it('should set the endpoint mode to server so the soundbar runs as its own Matter node', () => {
			// Arrange & Act
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Assert
			expect(mocks.endpoint.mode).toBe('server');
		});

		it('should construct the Speaker with the soundbar name and deviceId', () => {
			// Arrange & Act
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Assert
			expect(vi.mocked(Speaker)).toHaveBeenCalledWith('Soundbar', 'sb1');
		});

		it('should set basic information with defaults when no identity override is given', () => {
			// Arrange & Act
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Soundbar',
				'sb1',
				0xfff1,
				'Matterbridge',
				0x8002,
				'LG Soundbar',
			);
		});

		it('should apply identity overrides to basic information', () => {
			// Arrange & Act
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger, {
				vendorId: 0x1234,
				vendorName: 'Acme',
				productId: 0x9999,
				productName: 'Acme Bar',
			});

			// Assert
			expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Soundbar',
				'sb1',
				0x1234,
				'Acme',
				0x9999,
				'Acme Bar',
			);
		});

		it('should register exactly the on, off, moveToLevel, moveToLevelWithOnOff and changeToMode command handlers', () => {
			// Arrange & Act
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Assert
			const names = mocks.endpoint.addCommandHandler.mock.calls.map((entry: unknown[]) => entry[0]);
			expect(names).toEqual(['on', 'off', 'moveToLevel', 'moveToLevelWithOnOff', 'changeToMode']);
		});

		it('should create the ModeSelect cluster server with the Sound Mode label and preset list', () => {
			// Arrange & Act
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultModeSelectClusterServer).toHaveBeenCalledWith(
				'Sound Mode',
				LG_SOUNDBAR_SOUND_MODES,
				0,
				0,
			);
		});
	});

	describe('changeToMode handler', () => {
		beforeEach(() => {
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);
		});

		it('should call service.setSoundMode(soundbar, newMode) with the request.newMode value', async () => {
			// Arrange
			service.setSoundMode.mockResolvedValue(undefined);

			// Act
			await getHandler('changeToMode')({ request: { newMode: 9 } });

			// Assert
			expect(service.setSoundMode).toHaveBeenCalledWith(SOUNDBAR, 9);
		});

		it('should rethrow when service.setSoundMode rejects', async () => {
			// Arrange
			service.setSoundMode.mockRejectedValue(new Error('unreachable'));

			// Act & Assert
			await expect(getHandler('changeToMode')({ request: { newMode: 9 } })).rejects.toThrow('unreachable');
		});
	});

	describe('on/off handlers', () => {
		beforeEach(() => {
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);
		});

		it('should call service.setPower(soundbar, true) for the on handler', async () => {
			// Arrange
			service.setPower.mockResolvedValue(undefined);

			// Act
			await getHandler('on')();

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(SOUNDBAR, true);
		});

		it('should call service.setPower(soundbar, false) for the off handler', async () => {
			// Arrange
			service.setPower.mockResolvedValue(undefined);

			// Act
			await getHandler('off')();

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(SOUNDBAR, false);
		});

		it('should rethrow when service.setPower rejects for the on handler', async () => {
			// Arrange
			service.setPower.mockRejectedValue(new Error('unreachable'));

			// Act & Assert
			await expect(getHandler('on')()).rejects.toThrow('unreachable');
		});
	});

	describe('moveToLevel handler', () => {
		beforeEach(() => {
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);
		});

		it('should use the default [0,254] range before any state has been applied', async () => {
			// Arrange
			service.setVolume.mockResolvedValue(undefined);

			// Act
			await getHandler('moveToLevel')({ request: { level: 50 } });

			// Assert
			expect(service.setVolume).toHaveBeenCalledWith(SOUNDBAR, mapMatterLevelToDeviceVolume(50, 0, 254));
		});

		it('should map request.level through the endpoint last-known min/max and call service.setVolume with the mapped device volume', async () => {
			// Arrange
			service.setVolume.mockResolvedValue(undefined);
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);
			await applyLgSoundbarState(endpoint, { powerOn: undefined, volume: 10, volumeMin: 0, volumeMax: 40 }, logger);

			// Act
			await getHandler('moveToLevel')({ request: { level: 128 } });

			// Assert
			expect(service.setVolume).toHaveBeenCalledWith(SOUNDBAR, 20);
		});
	});

	describe('moveToLevelWithOnOff handler', () => {
		beforeEach(() => {
			buildLgSoundbarEndpoint(SOUNDBAR, service, logger);
		});

		it('should call setPower(true) and setVolume, in that order', async () => {
			// Arrange
			service.setPower.mockResolvedValue(undefined);
			service.setVolume.mockResolvedValue(undefined);
			// Pin a known volume range (min=0,max=254) so the mapped value is deterministic
			// regardless of any range left behind by other tests sharing the mocked endpoint.
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);
			await applyLgSoundbarState(endpoint, { powerOn: undefined, volume: 1, volumeMin: 0, volumeMax: 254 }, logger);

			// Act
			await getHandler('moveToLevelWithOnOff')({ request: { level: 254 } });

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(SOUNDBAR, true);
			expect(service.setVolume).toHaveBeenCalledWith(SOUNDBAR, 254);
			const powerOrder = service.setPower.mock.invocationCallOrder[0];
			const volumeOrder = service.setVolume.mock.invocationCallOrder[0];
			expect(powerOrder).toBeLessThan(volumeOrder);
		});
	});

	describe('applyLgSoundbarState', () => {
		it('should write OnOff once when powerOn is defined', async () => {
			// Arrange
			const state: LgSoundbarState = { powerOn: true, volume: undefined, volumeMin: undefined, volumeMax: undefined };
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should not write OnOff when powerOn is undefined', async () => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(OnOff.id, 'onOff', expect.anything(), logger);
		});

		it('should write LevelControl currentLevel once when volume/volumeMin/volumeMax are all defined', async () => {
			// Arrange
			const state: LgSoundbarState = { powerOn: undefined, volume: 20, volumeMin: 0, volumeMax: 40 };
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				LevelControl.id,
				'currentLevel',
				mapDeviceVolumeToMatterLevel(20, 0, 40),
				logger,
			);
		});

		it.each<[Partial<LgSoundbarState>]>([
			[{ volume: undefined, volumeMin: 0, volumeMax: 40 }],
			[{ volume: 20, volumeMin: undefined, volumeMax: 40 }],
			[{ volume: 20, volumeMin: 0, volumeMax: undefined }],
		])('should not write LevelControl when any of volume/volumeMin/volumeMax is undefined (%#)', async (partial) => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
				...partial,
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				LevelControl.id,
				'currentLevel',
				expect.anything(),
				logger,
			);
		});

		it('should write both OnOff and LevelControl when all fields are defined', async () => {
			// Arrange
			const state: LgSoundbarState = { powerOn: false, volume: 5, volumeMin: 0, volumeMax: 10 };
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(2);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should write ModeSelect currentMode once when soundMode is defined', async () => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
				soundMode: 4,
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(ModeSelect.id, 'currentMode', 4, logger);
		});

		it('should not write ModeSelect currentMode when soundMode is omitted', async () => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				ModeSelect.id,
				'currentMode',
				expect.anything(),
				logger,
			);
		});

		it('should still write ModeSelect currentMode when soundMode is defined but volume/volumeMin/volumeMax are all undefined', async () => {
			// Arrange: the exact shape the old early-return would have short-circuited on.
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
				soundMode: 6,
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(ModeSelect.id, 'currentMode', 6, logger);
		});

		it('should write ModeSelect supportedModes once when supportedSoundModes is defined', async () => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
				supportedSoundModes: [1, 3],
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				ModeSelect.id,
				'supportedModes',
				narrowSoundModes([1, 3]),
				logger,
			);
		});

		it('should not write ModeSelect supportedModes when supportedSoundModes is undefined', async () => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				ModeSelect.id,
				'supportedModes',
				expect.anything(),
				logger,
			);
		});

		it('should write supportedModes before currentMode when both soundMode and supportedSoundModes are defined in the same tick', async () => {
			// Arrange
			const state: LgSoundbarState = {
				powerOn: undefined,
				volume: undefined,
				volumeMin: undefined,
				volumeMax: undefined,
				soundMode: 4,
				supportedSoundModes: [1, 3, 4],
			};
			const endpoint = buildLgSoundbarEndpoint(SOUNDBAR, service, logger);

			// Act
			await applyLgSoundbarState(endpoint, state, logger);

			// Assert
			const calls = mocks.endpoint.updateAttribute.mock.calls;
			const supportedModesIndex = calls.findIndex((c: unknown[]) => c[1] === 'supportedModes');
			const currentModeIndex = calls.findIndex((c: unknown[]) => c[1] === 'currentMode');
			expect(supportedModesIndex).toBeGreaterThanOrEqual(0);
			expect(currentModeIndex).toBeGreaterThanOrEqual(0);
			expect(supportedModesIndex).toBeLessThan(currentModeIndex);
		});
	});
});
