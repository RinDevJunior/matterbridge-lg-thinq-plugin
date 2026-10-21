import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import type { ThinqConnectMatterIdentityOverride } from './thinqConnectMatterIdentity.js';
import { buildThinqConnectWasherEndpoint } from './thinqConnectWasherEndpoint.js';
import type { ThinqConnectWasher, ThinqConnectWasherService } from './thinqConnectWasherService.js';

export interface ThinqConnectWasherRegistrationDeps {
	service: Pick<ThinqConnectWasherService, 'discoverWashers' | 'setPower'>;
	logger: AnsiLogger;
	isIgnored: (deviceId: string) => boolean;
	resolveIdentity?: (deviceId: string) => ThinqConnectMatterIdentityOverride;
	registerDevice: (endpoint: MatterbridgeEndpoint) => Promise<void>;
	unregisterIgnoredDevice: (deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>;
	remember: (deviceId: string, endpoint: MatterbridgeEndpoint) => void;
}

/** Discovers ThinQ Connect washers and registers each one; returns those actually registered. */
export async function registerThinqConnectWashers(
	deps: ThinqConnectWasherRegistrationDeps,
): Promise<ThinqConnectWasher[]> {
	const { service, logger, isIgnored, resolveIdentity, registerDevice, unregisterIgnoredDevice, remember } = deps;
	const registered: ThinqConnectWasher[] = [];

	for (const washer of await service.discoverWashers()) {
		try {
			const endpoint = buildThinqConnectWasherEndpoint(washer, service, logger, resolveIdentity?.(washer.deviceId));
			if (isIgnored(washer.deviceId)) {
				await unregisterIgnoredDevice(washer.deviceId, endpoint);
				continue;
			}
			await registerDevice(endpoint);
			remember(washer.deviceId, endpoint);
			registered.push(washer);
		} catch (error) {
			logger.error(
				`ThinQ Connect: failed to register washer ${washer.deviceId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return registered;
}
