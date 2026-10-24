import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { LaundryWasherMode, OnOff, OperationalState } from 'matterbridge/matter/clusters';

import type { ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import type { WasherStartCommandPayload } from './thinqWasherStartCommandResolver.js';
import type { WasherPauseCommandPayload, WasherStopCommandPayload } from './thinqWasherStopCommandResolver.js';

/**
 * Washer commands that ThinQ does not support yet. `start`, `pause` and `stop` are wired to real ThinQ
 * controls (see `registerWasherCommandHandlers`); `resume` has no LG control. Every command in this list
 * throws before any real ThinQ call happens. Because the currently installed matterbridge dispatches
 * commands without awaiting the handler (see revert helpers below), each throw is paired with a
 * best-effort revert so Apple Home self-corrects immediately instead of showing a value ThinQ never
 * accepted.
 */
const READ_ONLY_WASHER_COMMANDS = ['on', 'off', 'resume', 'changeToMode'] as const;

const ON_OFF_COMMANDS = new Set<(typeof READ_ONLY_WASHER_COMMANDS)[number]>(['on', 'off']);

/**
 * Real ThinQ command payloads resolved from the device model, one per Matter command the washer accepts.
 * Each `undefined` makes that command fail with a "not available" error instead of guessing a control.
 */
export interface WasherCommandPayloads {
	readonly pause: WasherPauseCommandPayload | undefined;
	readonly stop: WasherStopCommandPayload | undefined;
	readonly start: WasherStartCommandPayload | undefined;
}

/**
 * Reverts `OnOff.onOff` back to `oldValue` after a rejected command, so Apple Home self-corrects
 * immediately instead of showing a value ThinQ never accepted. Best-effort: `updateAttribute`
 * failures are swallowed since the rejection is already logged by the caller.
 */
function revertOnOffOnFailure(washer: MatterbridgeEndpoint, oldValue: boolean): void {
	washer.updateAttribute(OnOff.id, 'onOff', oldValue, washer.log).catch(() => {
		// Best-effort revert; rejection already logged by the caller.
	});
}

/**
 * Reverts `OperationalState.operationalState` (and, for `changeToMode`, `LaundryWasherMode.currentMode`)
 * back to their last-known-correct values after a rejected command. Best-effort: `updateAttribute`
 * failures are swallowed since the rejection is already logged by the caller.
 */
function revertOperationalStateOnFailure(
	washer: MatterbridgeEndpoint,
	oldOperationalState: number,
	command: (typeof READ_ONLY_WASHER_COMMANDS)[number],
	oldCurrentMode: number,
): void {
	washer.updateAttribute(OperationalState.id, 'operationalState', oldOperationalState, washer.log).catch(() => {
		// Best-effort revert; rejection already logged by the caller.
	});

	if (command === 'changeToMode') {
		washer.updateAttribute(LaundryWasherMode.id, 'currentMode', oldCurrentMode, washer.log).catch(() => {
			// Best-effort revert; rejection already logged by the caller.
		});
	}
}

/**
 * Sends a real `WMControl` command (`pause` -> LG PAUSE, `stop` -> LG POWEROFF) to the physical washer.
 * The caller owns any state revert on failure.
 */
async function sendWasherControlCommand(
	device: ThinqWasherDevice,
	apiClient: ThinqApiClient,
	logger: AnsiLogger,
	commandName: 'pause' | 'stop',
	payload: WasherStopCommandPayload | undefined,
): Promise<void> {
	if (!payload) {
		logger.warn(
			`ThinQ Washer remote control ('${commandName}') is not available for this device model yet (deviceId=${device.id})`,
		);
		throw new Error(`ThinQ Washer remote control ('${commandName}') is not available for this device model yet.`);
	}

	logger.info(`ThinQ Washer ${device.id}: sending ${commandName}-command payload: ${JSON.stringify(payload)}`);

	try {
		await apiClient.sendCommand(device.id, { ctrlKey: 'WMControl', ...payload });
	} catch (error) {
		logger.error(
			`ThinQ Washer command '${commandName}' failed: ${error instanceof Error ? error.message : String(error)} (deviceId=${device.id})`,
		);
		throw error;
	}
}

/**
 * Sends a real `WMStart` command to the physical washer, using the model-resolved default-course
 * payload. Used by the washer's `start` command handler; the caller owns any state revert on failure.
 */
async function performWasherStart(
	device: ThinqWasherDevice,
	apiClient: ThinqApiClient,
	logger: AnsiLogger,
	startCommandPayload: WasherStartCommandPayload | undefined,
): Promise<void> {
	if (!startCommandPayload) {
		logger.warn(
			`ThinQ Washer remote control ('start') is not available for this device model yet (deviceId=${device.id})`,
		);
		throw new Error(`ThinQ Washer remote control ('start') is not available for this device model yet.`);
	}

	logger.info(`ThinQ Washer ${device.id}: sending start-command payload: ${JSON.stringify(startCommandPayload)}`);

	try {
		await apiClient.sendCommand(device.id, { ctrlKey: 'WMStart', ...startCommandPayload });
	} catch (error) {
		logger.error(
			`ThinQ Washer command 'start' failed: ${error instanceof Error ? error.message : String(error)} (deviceId=${device.id})`,
		);
		throw error;
	}
}

export function registerWasherCommandHandlers(
	washer: MatterbridgeEndpoint,
	device: ThinqWasherDevice,
	apiClient: ThinqApiClient,
	logger: AnsiLogger,
	payloads: WasherCommandPayloads,
): void {
	for (const command of READ_ONLY_WASHER_COMMANDS) {
		washer.addCommandHandler(command, async () => {
			logger.warn(`ThinQ Washer remote control ('${command}') is not supported yet (deviceId=${device.id})`);

			if (ON_OFF_COMMANDS.has(command)) {
				const previousOnOff = washer.getAttribute(OnOff.id, 'onOff') as boolean | undefined;
				revertOnOffOnFailure(washer, previousOnOff ?? false);
			} else {
				const previousOperationalState = washer.getAttribute(OperationalState.id, 'operationalState') as
					number | undefined;
				const previousCurrentMode = washer.getAttribute(LaundryWasherMode.id, 'currentMode') as number | undefined;
				revertOperationalStateOnFailure(
					washer,
					previousOperationalState ?? OperationalState.OperationalStateEnum.Stopped,
					command,
					previousCurrentMode ?? 0,
				);
			}

			throw new Error(`ThinQ Washer remote control ('${command}') is not supported yet`);
		});
	}

	washer.addCommandHandler('start', async () => {
		const currentState = washer.getAttribute(OperationalState.id, 'operationalState') as number | undefined;
		if (currentState === OperationalState.OperationalStateEnum.Running) {
			logger.debug(`ThinQ Washer 'start' ignored: washer is already running (deviceId=${device.id})`);
			return;
		}
		if (currentState === OperationalState.OperationalStateEnum.Paused) {
			logger.warn(
				`ThinQ Washer 'start' while paused would be a resume, which ThinQ does not support (deviceId=${device.id})`,
			);
			throw new Error(`ThinQ Washer remote control ('start') while paused is not supported.`);
		}
		if (currentState === OperationalState.OperationalStateEnum.Error) {
			logger.warn(`ThinQ Washer 'start' rejected: washer is in an error state (deviceId=${device.id})`);
			throw new Error(`ThinQ Washer remote control ('start') is rejected while the washer is in an error state.`);
		}

		try {
			await performWasherStart(device, apiClient, logger, payloads.start);
		} catch (error) {
			washer
				.updateAttribute(
					OperationalState.id,
					'operationalState',
					currentState ?? OperationalState.OperationalStateEnum.Stopped,
					washer.log,
				)
				.catch(() => {
					// Best-effort revert; original failure already logged by performWasherStart.
				});
			throw error;
		}
	});

	washer.addCommandHandler('pause', async () => {
		const currentState = washer.getAttribute(OperationalState.id, 'operationalState') as number | undefined;
		if (currentState === OperationalState.OperationalStateEnum.Paused) {
			logger.debug(`ThinQ Washer 'pause' ignored: washer is already paused (deviceId=${device.id})`);
			return;
		}
		if (currentState !== OperationalState.OperationalStateEnum.Running) {
			logger.warn(`ThinQ Washer 'pause' ignored: washer is not running (deviceId=${device.id})`);
			return;
		}

		try {
			await sendWasherControlCommand(device, apiClient, logger, 'pause', payloads.pause);
		} catch (error) {
			washer.updateAttribute(OperationalState.id, 'operationalState', currentState, washer.log).catch(() => {
				// Best-effort revert; original failure already logged by sendWasherControlCommand.
			});
			throw error;
		}
	});

	washer.addCommandHandler('stop', async () => {
		const currentState = washer.getAttribute(OperationalState.id, 'operationalState') as number | undefined;
		if (currentState === undefined || currentState === OperationalState.OperationalStateEnum.Stopped) {
			logger.debug(`ThinQ Washer 'stop' ignored: washer is already stopped (deviceId=${device.id})`);
			return;
		}

		try {
			await sendWasherControlCommand(device, apiClient, logger, 'stop', payloads.stop);
		} catch (error) {
			washer.updateAttribute(OperationalState.id, 'operationalState', currentState, washer.log).catch(() => {
				// Best-effort revert; original failure already logged by sendWasherControlCommand.
			});
			throw error;
		}
	});
}
