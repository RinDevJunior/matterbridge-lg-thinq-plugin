import { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasher } from 'matterbridge/devices';
import type { AnsiLogger } from 'matterbridge/logger';
import { OnOff } from 'matterbridge/matter/clusters';

import type { ThinqV2Washer, ThinqV2WasherService, ThinqV2WasherState } from './thinqV2WasherService.js';

/**
 * Builds the Matter `LaundryWasher` endpoint for a ThinQ Connect washer. `on`/`off` run the guarded
 * power command first and write the final OnOff value afterwards, because matterbridge does not await
 * the handler and mutates the attribute right after dispatch.
 */
export function buildThinqV2WasherEndpoint(
	washer: ThinqV2Washer,
	service: Pick<ThinqV2WasherService, 'setPower'>,
	logger: AnsiLogger,
): MatterbridgeEndpoint {
	const endpoint = new LaundryWasher(washer.name, washer.deviceId);
	endpoint.createDefaultBasicInformationClusterServer(
		washer.name,
		washer.deviceId,
		0xfff1,
		'Matterbridge',
		0x8001,
		'LG Washer',
	);

	const handlePower = async (on: boolean): Promise<void> => {
		try {
			const outcome = await service.setPower(washer, on);
			logger.debug(`ThinQ V2 ${washer.deviceId} power ${on ? 'on' : 'off'} -> ${outcome.status}`);
			const powerOn = outcome.state.powerOn ?? (outcome.status === 'sent' ? on : !on);
			await applyThinqV2WasherState(endpoint, { powerOn }, logger);
		} catch (error) {
			logger.error(
				`ThinQ V2 ${washer.deviceId} power handler failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	endpoint.addCommandHandler('on', async () => handlePower(true));
	endpoint.addCommandHandler('off', async () => handlePower(false));

	return endpoint;
}

export async function applyThinqV2WasherState(
	endpoint: MatterbridgeEndpoint,
	state: ThinqV2WasherState,
	logger: AnsiLogger,
): Promise<void> {
	if (state.powerOn === undefined) {
		logger.debug('ThinQ V2 washer state has unknown power state, skipping OnOff update.');
		return;
	}
	await endpoint.updateAttribute(OnOff.id, 'onOff', state.powerOn, logger);
}
