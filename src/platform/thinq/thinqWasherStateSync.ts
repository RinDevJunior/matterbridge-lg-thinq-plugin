import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';

import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';

/** Maps a ThinQ washer snapshot to a Matter `OperationalState.OperationalStateEnum`. */
export function mapWasherStateToOperationalState(snapshot: ThinqSnapshot): OperationalState.OperationalStateEnum {
	if (snapshot.isWasherError) {
		return OperationalState.OperationalStateEnum.Error;
	}
	if (snapshot.isWasherRunning) {
		return OperationalState.OperationalStateEnum.Running;
	}
	if (snapshot.washerRawState === 'PAUSE') {
		return OperationalState.OperationalStateEnum.Paused;
	}
	return OperationalState.OperationalStateEnum.Stopped;
}

/**
 * Pushes a freshly polled ThinQ Washer snapshot onto the Matter `LaundryWasher` endpoint's attributes
 * (device → Apple Home). Read-only v1: no washer-specific commands are ever sent back.
 */
export async function applyThinqSnapshotToWasher(
	washer: MatterbridgeEndpoint,
	snapshot: ThinqSnapshot,
	logger: AnsiLogger,
): Promise<void> {
	const deviceId = washer.serialNumber ?? washer.uniqueId ?? 'unknown';

	if (snapshot.washerRawState === undefined) {
		logger.debug(`applyThinqSnapshotToWasher: skipped (source key absent): washerDryer.state, deviceId=${deviceId}`);
		return;
	}

	logger.debug(`applyThinqSnapshotToWasher: entry for deviceId=${deviceId}`);

	await washer.updateAttribute(OnOff.id, 'onOff', snapshot.isWasherPowerOn, logger);
	await washer.updateAttribute(
		OperationalState.id,
		'operationalState',
		mapWasherStateToOperationalState(snapshot),
		logger,
	);
	await washer.updateAttribute(
		OperationalState.id,
		'operationalError',
		{
			errorStateId: snapshot.isWasherError
				? OperationalState.ErrorState.UnableToCompleteOperation
				: OperationalState.ErrorState.NoError,
		},
		logger,
	);

	if (snapshot.washerRemainingDurationSeconds !== undefined) {
		await washer.updateAttribute(OperationalState.id, 'countdownTime', snapshot.washerRemainingDurationSeconds, logger);
	}
}
