import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';

import { type ThinqWasherDevice, toThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import { maskSecret } from '../../utils/mask.js';
import { readWasherFields } from './thinqWasherFields.js';
import { applyThinqSnapshotToWasher } from './thinqWasherStateSync.js';
import type { WasherVtAction, WasherVtController, WasherVtPorts } from './thinqWasherVtController.js';

export type WasherVtRunner = Pick<WasherVtController, 'run'>;

export const WASHER_VT_DEFERRED_APPLY_DELAY_MS = 500;

const CHANGE_TO_MODE_REFUSAL = 'Wash course is chosen in the plugin settings (Selected Wash Course), not from Home.';

/** Real ports: a fresh device-list read (never the cached poll snapshot), `control-sync` sends, real timers. */
export function createWasherVtPorts(device: ThinqWasherDevice, apiClient: ThinqApiClient): WasherVtPorts {
	return {
		readReading: async () => {
			const found = (await apiClient.getListDevices()).map(toThinqDevice).find((item) => item.id === device.id);
			return found === undefined
				? undefined
				: { fields: readWasherFields(found), online: found.online, snapshot: found.snapshot };
		},
		send: (body) => apiClient.sendCommandAndGetResponse(device.id, body),
		sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
	};
}

export function registerWasherVtCommandHandlers(
	washer: MatterbridgeEndpoint,
	device: ThinqWasherDevice,
	runner: WasherVtRunner,
	logger: AnsiLogger,
): void {
	const prefix = `ThinQ Washer ${maskSecret(device.id, 4)}`;

	const handle = async (action: WasherVtAction, kind: 'onOff' | 'operationalState'): Promise<void> => {
		const previousOnOff = washer.getAttribute(OnOff.id, 'onOff') as boolean | undefined;
		const previousOperationalState = washer.getAttribute(OperationalState.id, 'operationalState') as number | undefined;

		const outcome = await runner.run(action);

		const { snapshot } = outcome;
		if (snapshot) {
			// Deferred: awaiting updateAttribute inside a handler deadlocks; Home self-corrects once it lands.
			setTimeout(() => {
				applyThinqSnapshotToWasher(washer, snapshot, logger).catch((error: unknown) => {
					logger.warn(
						`${prefix}: state sync after '${action}' failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
			}, WASHER_VT_DEFERRED_APPLY_DELAY_MS);
		}

		if (outcome.status === 'done' || outcome.status === 'noop') {
			logger.info(`${prefix}: '${action}' ${outcome.status}: ${outcome.message}`);
			return;
		}

		logger.warn(`${prefix}: '${action}' ${outcome.status}: ${outcome.message}`);
		if (!snapshot) {
			if (kind === 'onOff') {
				washer.updateAttribute(OnOff.id, 'onOff', previousOnOff ?? false, washer.log).catch(() => {
					// Best-effort revert; the failure is already logged above.
				});
			} else {
				washer
					.updateAttribute(
						OperationalState.id,
						'operationalState',
						previousOperationalState ?? OperationalState.OperationalStateEnum.Stopped,
						washer.log,
					)
					.catch(() => {
						// Best-effort revert; the failure is already logged above.
					});
			}
		}
		throw new Error(outcome.message);
	};

	washer.addCommandHandler('on', async () => handle('power-on', 'onOff'));
	washer.addCommandHandler('off', async () => handle('power-off', 'onOff'));
	washer.addCommandHandler('start', async () => handle('start', 'operationalState'));
	washer.addCommandHandler('pause', async () => handle('pause', 'operationalState'));
	washer.addCommandHandler('resume', async () => handle('resume', 'operationalState'));
	washer.addCommandHandler('stop', async () => handle('stop', 'operationalState'));
	washer.addCommandHandler('changeToMode', async () => {
		logger.warn(`${prefix}: 'changeToMode' refused, the course is chosen in the plugin settings`);
		throw new Error(CHANGE_TO_MODE_REFUSAL);
	});
}
