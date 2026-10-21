import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import { buildThinqConnectAirConditionerEndpoint } from './thinqConnectAirConditionerEndpoint.js';
import type {
	ThinqConnectAirConditioner,
	ThinqConnectAirConditionerService,
} from './thinqConnectAirConditionerService.js';
import type { ThinqConnectMatterIdentityOverride } from './thinqConnectMatterIdentity.js';

export interface ThinqConnectAirConditionerRegistrationDeps {
	service: Pick<
		ThinqConnectAirConditionerService,
		'discoverAirConditioners' | 'setPower' | 'setCoolMode' | 'setTargetTemperature' | 'setWindStrength' | 'setSwing'
	>;
	logger: AnsiLogger;
	isIgnored: (deviceId: string) => boolean;
	resolveIdentity?: (deviceId: string) => ThinqConnectMatterIdentityOverride;
	registerDevice: (endpoint: MatterbridgeEndpoint) => Promise<void>;
	unregisterIgnoredDevice: (deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>;
	remember: (deviceId: string, endpoint: MatterbridgeEndpoint) => void;
}

/** Discovers ThinQ Connect air conditioners and registers each one; returns those actually registered. */
export async function registerThinqConnectAirConditioners(
	deps: ThinqConnectAirConditionerRegistrationDeps,
): Promise<ThinqConnectAirConditioner[]> {
	const { service, logger, isIgnored, resolveIdentity, registerDevice, unregisterIgnoredDevice, remember } = deps;
	const registered: ThinqConnectAirConditioner[] = [];

	for (const ac of await service.discoverAirConditioners()) {
		try {
			const endpoint = buildThinqConnectAirConditionerEndpoint(ac, service, logger, resolveIdentity?.(ac.deviceId));
			if (isIgnored(ac.deviceId)) {
				await unregisterIgnoredDevice(ac.deviceId, endpoint);
				continue;
			}
			await registerDevice(endpoint);
			remember(ac.deviceId, endpoint);
			registered.push(ac);
		} catch (error) {
			logger.error(
				`ThinQ Connect: failed to register air conditioner ${ac.deviceId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return registered;
}
