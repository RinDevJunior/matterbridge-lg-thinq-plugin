import { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasher } from 'matterbridge/devices';
import type { AnsiLogger } from 'matterbridge/logger';
import { OnOff } from 'matterbridge/matter/clusters';

import type { ThinqConnectMatterIdentityOverride } from './thinqConnectMatterIdentity.js';
import type {
	ThinqConnectWasher,
	ThinqConnectWasherService,
	ThinqConnectWasherState,
} from './thinqConnectWasherService.js';

/**
 * Builds the Matter `LaundryWasher` endpoint for a ThinQ Connect washer. `on`/`off` run the guarded
 * power command first and write the final OnOff value afterwards, because matterbridge does not await
 * the handler and mutates the attribute right after dispatch.
 */
export function buildThinqConnectWasherEndpoint(
	washer: ThinqConnectWasher,
	service: Pick<ThinqConnectWasherService, 'setPower'>,
	logger: AnsiLogger,
	identity: ThinqConnectMatterIdentityOverride = {},
): MatterbridgeEndpoint {
	const endpoint = new LaundryWasher(washer.name, washer.deviceId);
	endpoint.createDefaultBasicInformationClusterServer(
		washer.name,
		washer.deviceId,
		identity.vendorId ?? 0xfff1,
		identity.vendorName ?? 'Matterbridge',
		identity.productId ?? 0x8001,
		identity.productName ?? 'LG Washer',
	);
	// Standalone Matter node (own pairing code), matching the account-login washer.
	endpoint.mode = 'server';

	const handlePower = async (on: boolean): Promise<void> => {
		try {
			const outcome = await service.setPower(washer, on);
			logger.debug(`ThinQ Connect ${washer.deviceId} power ${on ? 'on' : 'off'} -> ${outcome.status}`);
			const powerOn = outcome.state.powerOn ?? (outcome.status === 'sent' ? on : !on);
			await applyThinqConnectWasherState(endpoint, { powerOn }, logger);
		} catch (error) {
			logger.error(
				`ThinQ Connect ${washer.deviceId} power handler failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	endpoint.addCommandHandler('on', async () => handlePower(true));
	endpoint.addCommandHandler('off', async () => handlePower(false));

	return endpoint;
}

export async function applyThinqConnectWasherState(
	endpoint: MatterbridgeEndpoint,
	state: ThinqConnectWasherState,
	logger: AnsiLogger,
): Promise<void> {
	if (state.powerOn === undefined) {
		logger.debug('ThinQ Connect washer state has unknown power state, skipping OnOff update.');
		return;
	}
	await endpoint.updateAttribute(OnOff.id, 'onOff', state.powerOn, logger);
}
