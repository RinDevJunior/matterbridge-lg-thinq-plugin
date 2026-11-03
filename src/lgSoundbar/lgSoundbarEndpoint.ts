import { MatterbridgeEndpoint } from 'matterbridge';
import { Speaker } from 'matterbridge/devices';
import type { AnsiLogger } from 'matterbridge/logger';
import { LevelControl, ModeSelect, OnOff } from 'matterbridge/matter/clusters';

import type { LgSoundbar, LgSoundbarService, LgSoundbarState } from '../services/lgSoundbar/lgSoundbarService.js';

export interface LgSoundbarMatterIdentityOverride {
	vendorId?: number;
	vendorName?: string;
	productId?: number;
	productName?: string;
}

interface VolumeRange {
	readonly min: number;
	readonly max: number;
}

const MATTER_LEVEL_MIN = 1;
const MATTER_LEVEL_MAX = 254;
const DEFAULT_VOLUME_RANGE: VolumeRange = { min: 0, max: MATTER_LEVEL_MAX };

export const LG_SOUNDBAR_SOUND_MODE_LABELS: readonly string[] = [
	'Standard',
	'Bass',
	'Flat',
	'Boost',
	'Treble and Bass',
	'User',
	'Music',
	'Cinema',
	'Night',
	'News',
	'Voice',
	'ia_sound',
	'Adaptive Sound Control',
	'Movie',
	'Bass Blast',
	'Dolby Atmos',
	'DTS Virtual X',
	'Bass Boost Plus',
	'DTS X',
	'AI Sound Pro',
	'Clear Voice',
	'Sports',
	'Game',
];

export const LG_SOUNDBAR_SOUND_MODES: ModeSelect.ModeOption[] = LG_SOUNDBAR_SOUND_MODE_LABELS.map((label, mode) => ({
	label,
	mode,
	semanticTags: [],
}));

// Device volume range is read from the soundbar on each poll; kept per endpoint for the level-to-volume mapping.
const volumeRangeByEndpoint = new WeakMap<MatterbridgeEndpoint, VolumeRange>();

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export function mapDeviceVolumeToMatterLevel(volume: number, min: number, max: number): number {
	if (max <= min) {
		return MATTER_LEVEL_MIN;
	}
	const ratio = (clamp(volume, min, max) - min) / (max - min);
	return clamp(
		Math.round(MATTER_LEVEL_MIN + ratio * (MATTER_LEVEL_MAX - MATTER_LEVEL_MIN)),
		MATTER_LEVEL_MIN,
		MATTER_LEVEL_MAX,
	);
}

export function mapMatterLevelToDeviceVolume(level: number, min: number, max: number): number {
	if (max <= min) {
		return min;
	}
	const ratio =
		(clamp(level, MATTER_LEVEL_MIN, MATTER_LEVEL_MAX) - MATTER_LEVEL_MIN) / (MATTER_LEVEL_MAX - MATTER_LEVEL_MIN);
	return clamp(Math.round(min + ratio * (max - min)), min, max);
}

/**
 * Builds the Matter `Speaker` endpoint (OnOff = device power, LevelControl = volume) for an LG Soundbar.
 * matterbridge awaits these handlers and then sets OnOff/LevelControl itself: return = success, throw = refusal.
 */
export function buildLgSoundbarEndpoint(
	soundbar: LgSoundbar,
	service: Pick<LgSoundbarService, 'setPower' | 'setVolume' | 'setSoundMode'>,
	logger: AnsiLogger,
	identity: LgSoundbarMatterIdentityOverride = {},
): MatterbridgeEndpoint {
	const endpoint = new Speaker(soundbar.name, soundbar.deviceId);
	endpoint.createDefaultBasicInformationClusterServer(
		soundbar.name,
		soundbar.deviceId,
		identity.vendorId ?? 0xfff1,
		identity.vendorName ?? 'Matterbridge',
		identity.productId ?? 0x8002,
		identity.productName ?? 'LG Soundbar',
	);

	// Standalone Matter node (own pairing code), matching the AC/Washer families.
	endpoint.mode = 'server';
	endpoint.createDefaultModeSelectClusterServer('Sound Mode', LG_SOUNDBAR_SOUND_MODES, 0, 0);

	const handlePower = async (on: boolean): Promise<void> => {
		try {
			await service.setPower(soundbar, on);
		} catch (error) {
			logger.error(
				`LG Soundbar ${soundbar.deviceId} power handler failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
		logger.debug(`LG Soundbar ${soundbar.deviceId} power ${on ? 'on' : 'off'}`);
	};

	const handleVolume = async (level: number): Promise<void> => {
		const { min, max } = volumeRangeByEndpoint.get(endpoint) ?? DEFAULT_VOLUME_RANGE;
		const deviceVolume = mapMatterLevelToDeviceVolume(level, min, max);
		try {
			await service.setVolume(soundbar, deviceVolume);
		} catch (error) {
			logger.error(
				`LG Soundbar ${soundbar.deviceId} volume handler failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
		logger.debug(`LG Soundbar ${soundbar.deviceId} volume ${deviceVolume}`);
	};

	const handleSoundMode = async (newMode: number): Promise<void> => {
		try {
			await service.setSoundMode(soundbar, newMode);
		} catch (error) {
			logger.error(
				`LG Soundbar ${soundbar.deviceId} sound mode handler failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
		logger.debug(`LG Soundbar ${soundbar.deviceId} sound mode ${newMode}`);
	};

	endpoint.addCommandHandler('on', async () => handlePower(true));
	endpoint.addCommandHandler('off', async () => handlePower(false));
	endpoint.addCommandHandler('moveToLevel', async ({ request }) => handleVolume(request.level));
	endpoint.addCommandHandler('moveToLevelWithOnOff', async ({ request }) => {
		await handlePower(true);
		await handleVolume(request.level);
	});
	endpoint.addCommandHandler('changeToMode', async ({ request }) => handleSoundMode(request.newMode));

	return endpoint;
}

export async function applyLgSoundbarState(
	endpoint: MatterbridgeEndpoint,
	state: LgSoundbarState,
	logger: AnsiLogger,
): Promise<void> {
	if (state.powerOn !== undefined) {
		await endpoint.updateAttribute(OnOff.id, 'onOff', state.powerOn, logger);
	}

	const { volume, volumeMin, volumeMax } = state;
	if (volume !== undefined && volumeMin !== undefined && volumeMax !== undefined) {
		volumeRangeByEndpoint.set(endpoint, { min: volumeMin, max: volumeMax });
		await endpoint.updateAttribute(
			LevelControl.id,
			'currentLevel',
			mapDeviceVolumeToMatterLevel(volume, volumeMin, volumeMax),
			logger,
		);
	}

	if (state.soundMode !== undefined) {
		await endpoint.updateAttribute(ModeSelect.id, 'currentMode', state.soundMode, logger);
	}
}
