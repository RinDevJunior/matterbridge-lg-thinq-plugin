import { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasher } from 'matterbridge/devices';
import type { AnsiLogger } from 'matterbridge/logger';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';

import type { ThinqConnectMatterIdentityOverride } from './thinqConnectMatterIdentity.js';
import type {
	ThinqConnectWasher,
	ThinqConnectWasherService,
	ThinqConnectWasherState,
} from './thinqConnectWasherService.js';

/** Explicit allowlists: an unknown or new Connect state must never default to Running. */
export const RUNNING_STATES: ReadonlySet<string> = new Set([
	'RUNNING',
	'SOAKING',
	'DETECTING',
	'RINSING',
	'DETERGENT_AMOUNT',
	'DRYING',
	'PREWASH',
	'STEAM_SOFTENING',
	'SPINNING',
	'DISPENSING',
	'ADD_DRAIN',
]);

export const PAUSED_STATES: ReadonlySet<string> = new Set(['PAUSE', 'RINSE_HOLD']);

export const STOPPED_STATES: ReadonlySet<string> = new Set([
	'POWER_OFF',
	'INITIAL',
	'END',
	'RESERVED',
	'REFRESHING',
	'FROZEN_PREVENT_INITIAL',
	'FROZEN_PREVENT_RUNNING',
	'FROZEN_PREVENT_PAUSE',
]);

const ERROR_STATE = 'ERROR';

export function mapThinqConnectWasherState(currentState: string | undefined): OperationalState.OperationalStateEnum {
	if (currentState === ERROR_STATE) {
		return OperationalState.OperationalStateEnum.Error;
	}
	if (currentState !== undefined && RUNNING_STATES.has(currentState)) {
		return OperationalState.OperationalStateEnum.Running;
	}
	if (currentState !== undefined && PAUSED_STATES.has(currentState)) {
		return OperationalState.OperationalStateEnum.Paused;
	}
	return OperationalState.OperationalStateEnum.Stopped;
}

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
	} else {
		await endpoint.updateAttribute(OnOff.id, 'onOff', state.powerOn, logger);
	}

	const { currentState } = state;
	if (currentState === undefined) {
		return;
	}
	if (
		currentState !== ERROR_STATE &&
		!RUNNING_STATES.has(currentState) &&
		!PAUSED_STATES.has(currentState) &&
		!STOPPED_STATES.has(currentState)
	) {
		logger.debug(`ThinQ Connect washer reported unknown state "${currentState}", treating it as Stopped.`);
	}

	const operationalState = mapThinqConnectWasherState(currentState);
	const isCycleActive =
		operationalState === OperationalState.OperationalStateEnum.Running ||
		operationalState === OperationalState.OperationalStateEnum.Paused;

	await endpoint.updateAttribute(OperationalState.id, 'operationalState', operationalState, logger);
	await endpoint.updateAttribute(
		OperationalState.id,
		'operationalError',
		{
			errorStateId:
				currentState === ERROR_STATE
					? OperationalState.ErrorState.UnableToCompleteOperation
					: OperationalState.ErrorState.NoError,
		},
		logger,
	);
	await endpoint.updateAttribute(
		OperationalState.id,
		'countdownTime',
		isCycleActive ? (state.remainingSeconds ?? null) : 0,
		logger,
	);
}
