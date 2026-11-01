import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import type { LgSoundbarDeviceConfig } from '../model/LgThinqPluginPlatformConfig.js';
import type { LgSoundbar, LgSoundbarService } from '../services/lgSoundbar/lgSoundbarService.js';
import { buildLgSoundbarEndpoint, type LgSoundbarMatterIdentityOverride } from './lgSoundbarEndpoint.js';

export interface LgSoundbarRegistrationDeps {
	service: Pick<LgSoundbarService, 'discoverSoundbars' | 'setPower' | 'setVolume'>;
	configs: readonly LgSoundbarDeviceConfig[];
	logger: AnsiLogger;
	isIgnored: (deviceId: string) => boolean;
	resolveIdentity?: (deviceId: string) => LgSoundbarMatterIdentityOverride;
	registerDevice: (endpoint: MatterbridgeEndpoint) => Promise<void>;
	unregisterIgnoredDevice: (deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>;
	remember: (deviceId: string, endpoint: MatterbridgeEndpoint) => void;
}

/** Maps configured LG Soundbars to Matter endpoints and registers each; returns those actually registered. */
export async function registerLgSoundbars(deps: LgSoundbarRegistrationDeps): Promise<LgSoundbar[]> {
	const { service, configs, logger, isIgnored, resolveIdentity, registerDevice, unregisterIgnoredDevice, remember } =
		deps;
	const registered: LgSoundbar[] = [];

	for (const soundbar of service.discoverSoundbars(configs)) {
		try {
			const endpoint = buildLgSoundbarEndpoint(soundbar, service, logger, resolveIdentity?.(soundbar.deviceId));
			if (isIgnored(soundbar.deviceId)) {
				await unregisterIgnoredDevice(soundbar.deviceId, endpoint);
				continue;
			}
			await registerDevice(endpoint);
			remember(soundbar.deviceId, endpoint);
			registered.push(soundbar);
		} catch (error) {
			logger.error(
				`LG Soundbar: failed to register ${soundbar.deviceId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return registered;
}
