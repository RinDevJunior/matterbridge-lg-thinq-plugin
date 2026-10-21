import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import { buildThinqV2AirConditionerEndpoint } from './thinqV2AirConditionerEndpoint.js';
import type { ThinqV2AirConditioner, ThinqV2AirConditionerService } from './thinqV2AirConditionerService.js';
import type { ThinqV2MatterIdentityOverride } from './thinqV2MatterIdentity.js';

export interface ThinqV2AirConditionerRegistrationDeps {
	service: Pick<
		ThinqV2AirConditionerService,
		'discoverAirConditioners' | 'setPower' | 'setCoolMode' | 'setTargetTemperature' | 'setWindStrength' | 'setSwing'
	>;
	logger: AnsiLogger;
	isIgnored: (deviceId: string) => boolean;
	resolveIdentity?: (deviceId: string) => ThinqV2MatterIdentityOverride;
	registerDevice: (endpoint: MatterbridgeEndpoint) => Promise<void>;
	unregisterIgnoredDevice: (deviceId: string, endpoint: MatterbridgeEndpoint) => Promise<void>;
	remember: (deviceId: string, endpoint: MatterbridgeEndpoint) => void;
}

/** Discovers ThinQ Connect air conditioners and registers each one; returns those actually registered. */
export async function registerThinqV2AirConditioners(
	deps: ThinqV2AirConditionerRegistrationDeps,
): Promise<ThinqV2AirConditioner[]> {
	const { service, logger, isIgnored, resolveIdentity, registerDevice, unregisterIgnoredDevice, remember } = deps;
	const registered: ThinqV2AirConditioner[] = [];

	for (const ac of await service.discoverAirConditioners()) {
		try {
			const endpoint = buildThinqV2AirConditionerEndpoint(ac, service, logger, resolveIdentity?.(ac.deviceId));
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
