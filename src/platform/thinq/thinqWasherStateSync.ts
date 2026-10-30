import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';

import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';
import { WasherCycleTracker, type WasherRunStatus } from './thinqWasherCycleTracker.js';
import { applyWasherSelectionDisplay, type WasherMatterPlan } from './thinqWasherMatterPlan.js';
import { resolveWasherPhaseIndex, WASHER_PHASE_LIST } from './thinqWasherPhases.js';

/** Maps a ThinQ washer snapshot to the coarse run status shared by the Matter state and the cycle tracker. */
export function resolveWasherRunStatus(snapshot: ThinqSnapshot): WasherRunStatus {
	if (snapshot.isWasherError) {
		return 'error';
	}
	if (snapshot.isWasherRunning) {
		return 'running';
	}
	if (snapshot.washerRawState === 'PAUSE') {
		return 'paused';
	}
	return 'stopped';
}

/** Maps a ThinQ washer snapshot to a Matter `OperationalState.OperationalStateEnum`. */
export function mapWasherStateToOperationalState(snapshot: ThinqSnapshot): OperationalState.OperationalStateEnum {
	switch (resolveWasherRunStatus(snapshot)) {
		case 'error':
			return OperationalState.OperationalStateEnum.Error;
		case 'running':
			return OperationalState.OperationalStateEnum.Running;
		case 'paused':
			return OperationalState.OperationalStateEnum.Paused;
		case 'stopped':
			return OperationalState.OperationalStateEnum.Stopped;
	}
}

/**
 * Pushes a freshly polled ThinQ Washer snapshot onto the Matter `LaundryWasher` endpoint's attributes
 * (device → Matter attribute sync).
 */
export async function applyThinqSnapshotToWasher(
	washer: MatterbridgeEndpoint,
	snapshot: ThinqSnapshot,
	logger: AnsiLogger,
	cycleTracker?: WasherCycleTracker,
	display?: { readonly plan: WasherMatterPlan },
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

	const runStatus = resolveWasherRunStatus(snapshot);
	const phaseIndex = runStatus === 'running' ? resolveWasherPhaseIndex(snapshot.washerRawState) : undefined;
	if (runStatus === 'running' && phaseIndex === undefined) {
		logger.debug(
			`applyThinqSnapshotToWasher: unmapped washer phase state '${snapshot.washerRawState}', deviceId=${deviceId}`,
		);
	}
	await washer.updateAttribute(OperationalState.id, 'phaseList', [...WASHER_PHASE_LIST], logger);
	await washer.updateAttribute(OperationalState.id, 'currentPhase', phaseIndex ?? null, logger);

	const completion = cycleTracker?.observe(deviceId, runStatus, snapshot.washerRawState);
	if (completion !== undefined) {
		logger.info(
			`applyThinqSnapshotToWasher: wash cycle completed, emitting OperationCompletion for deviceId=${deviceId}`,
		);
		// completionErrorCode 0 === OperationalState.ErrorState.NoError
		await washer.triggerEvent(OperationalState.id, 'operationCompletion', { ...completion }, logger);
	}

	if (display !== undefined) {
		await applyWasherSelectionDisplay(washer, snapshot, display.plan, logger);
	}
}
