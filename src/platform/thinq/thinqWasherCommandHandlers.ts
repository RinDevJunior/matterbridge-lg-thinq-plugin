import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { LaundryWasherMode, OnOff, OperationalState } from 'matterbridge/matter/clusters';

import type { ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqWasherControlConfig } from '../../model/LgThinkqPluginPlatformConfig.js';
import type { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import type { WasherStopCommandPayload } from './thinqWasherStopCommandResolver.js';

/**
 * v1 washer support is read-only telemetry only (mirrors `homebridge-lg-thinq`'s own washer
 * implementation), except for `stop` (v2, real command — see `registerWasherCommandHandlers`).
 * Every command in this list throws before any real ThinQ call happens. Because the currently
 * installed matterbridge dispatches commands without awaiting the handler (see revert helpers
 * below), each throw is paired with a best-effort revert so Apple Home self-corrects immediately
 * instead of showing a value ThinQ never accepted.
 */
const READ_ONLY_WASHER_COMMANDS = ['on', 'off', 'pause', 'start', 'resume', 'changeToMode'] as const;

const ON_OFF_COMMANDS = new Set<(typeof READ_ONLY_WASHER_COMMANDS)[number]>(['on', 'off']);

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

export function registerWasherCommandHandlers(
	washer: MatterbridgeEndpoint,
	device: ThinqWasherDevice,
	apiClient: ThinqApiClient,
	logger: AnsiLogger,
	washerControl: ThinqWasherControlConfig,
	stopCommandPayload: WasherStopCommandPayload | undefined,
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

	washer.addCommandHandler('stop', async () => {
		if (!washerControl.allowRemoteStop) {
			logger.warn(`ThinQ Washer remote control ('stop') is disabled by configuration (deviceId=${device.id})`);
			throw new Error(`ThinQ Washer remote control ('stop') is disabled by configuration.`);
		}

		if (!stopCommandPayload) {
			logger.warn(
				`ThinQ Washer remote control ('stop') is not available for this device model yet (deviceId=${device.id})`,
			);
			throw new Error(`ThinQ Washer remote control ('stop') is not available for this device model yet.`);
		}

		const previousState = washer.getAttribute(OperationalState.id, 'operationalState') as number | undefined;

		try {
			await apiClient.sendCommand(device.id, { ctrlKey: 'WMControl', ...stopCommandPayload });
		} catch (error) {
			logger.error(
				`ThinQ Washer command 'stop' failed: ${error instanceof Error ? error.message : String(error)} (deviceId=${device.id})`,
			);
			washer
				.updateAttribute(
					OperationalState.id,
					'operationalState',
					previousState ?? OperationalState.OperationalStateEnum.Stopped,
					washer.log,
				)
				.catch(() => {
					// Best-effort revert; original failure already logged above.
				});
			throw error;
		}
	});
}
