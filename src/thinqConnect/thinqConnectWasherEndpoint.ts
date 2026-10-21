import { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasher } from 'matterbridge/devices';
import type { AnsiLogger } from 'matterbridge/logger';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';

import { PAUSED_STATES, RUNNING_STATES, STOPPED_STATES } from '../services/thinqConnect/thinqConnectWasher.js';
import type { ThinqConnectMatterIdentityOverride } from './thinqConnectMatterIdentity.js';
import type {
	ThinqConnectWasher,
	ThinqConnectWasherCommandOutcome,
	ThinqConnectWasherService,
	ThinqConnectWasherState,
} from './thinqConnectWasherService.js';

export type ThinqConnectWasherCommandService = Pick<ThinqConnectWasherService, 'setPower' | 'startCycle' | 'stopCycle'>;

export { PAUSED_STATES, RUNNING_STATES, STOPPED_STATES };

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
	service: ThinqConnectWasherCommandService,
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

	const revertOperationalState = async (
		state: ThinqConnectWasherState,
		previous: number | undefined,
	): Promise<void> => {
		try {
			if (state.currentState !== undefined) {
				await applyThinqConnectWasherState(endpoint, state, logger);
				return;
			}
			await endpoint.updateAttribute(
				OperationalState.id,
				'operationalState',
				previous ?? OperationalState.OperationalStateEnum.Stopped,
				logger,
			);
		} catch (error) {
			logger.warn(
				`ThinQ Connect ${washer.deviceId} could not revert the operational state: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	// matterbridge awaits these handlers and only then sets Running/Stopped: return = success, throw = refusal.
	const handleCycle = async (command: 'start' | 'stop'): Promise<void> => {
		const previous = endpoint.getAttribute(OperationalState.id, 'operationalState') as number | undefined;
		let outcome: ThinqConnectWasherCommandOutcome;
		try {
			outcome = await (command === 'start' ? service.startCycle(washer) : service.stopCycle(washer));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			outcome = { status: 'failed', error: message, hint: message, state: {} };
		}

		if (outcome.status === 'sent') {
			return;
		}
		if (outcome.status === 'noop') {
			await applyThinqConnectWasherState(endpoint, outcome.state, logger);
			return;
		}
		await revertOperationalState(outcome.state, previous);
		throw new Error(outcome.status === 'refused' ? outcome.reason : outcome.hint);
	};

	const rejectPauseResume = async (): Promise<void> => {
		const previous = endpoint.getAttribute(OperationalState.id, 'operationalState') as number | undefined;
		logger.warn(`ThinQ Connect washer ${washer.deviceId} pause/resume is not supported by the ThinQ Connect API`);
		await revertOperationalState({}, previous);
		throw new Error('Pause and resume are not supported by the ThinQ Connect API.');
	};

	endpoint.addCommandHandler('start', async () => handleCycle('start'));
	endpoint.addCommandHandler('stop', async () => handleCycle('stop'));
	endpoint.addCommandHandler('pause', async () => rejectPauseResume());
	endpoint.addCommandHandler('resume', async () => rejectPauseResume());

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
