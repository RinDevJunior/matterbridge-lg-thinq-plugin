import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';

import type { ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';

/**
 * v1 washer support is read-only telemetry only (mirrors `homebridge-lg-thinq`'s own washer
 * implementation). Every command that would mutate washer state throws before any local Matter
 * attribute mutation happens, so the command fails cleanly instead of silently reverting.
 */
const READ_ONLY_WASHER_COMMANDS = ['on', 'off', 'pause', 'stop', 'start', 'resume', 'changeToMode'] as const;

export function registerWasherCommandHandlers(
	washer: MatterbridgeEndpoint,
	device: ThinqWasherDevice,
	logger: AnsiLogger,
): void {
	for (const command of READ_ONLY_WASHER_COMMANDS) {
		washer.addCommandHandler(command, async () => {
			logger.warn(`ThinQ Washer remote control ('${command}') is not supported yet (deviceId=${device.id})`);
			throw new Error(`ThinQ Washer remote control ('${command}') is not supported yet`);
		});
	}
}
