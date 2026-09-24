import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';
import { HepaFilterMonitoring, ResourceMonitoring } from 'matterbridge/matter/clusters';

import type { ThinqFilterState } from '../../core/domain/value-objects/ThinqFilterState.js';

const FILTER_WARNING_THRESHOLD_PERCENT = 10;

/** 3-way threshold mapping from remaining filter life percent to a Matter `ChangeIndication`. */
export function resolveFilterChangeIndication(remainingPercent: number): ResourceMonitoring.ChangeIndication {
	if (remainingPercent <= 0) {
		return ResourceMonitoring.ChangeIndication.Critical;
	}
	if (remainingPercent <= FILTER_WARNING_THRESHOLD_PERCENT) {
		return ResourceMonitoring.ChangeIndication.Warning;
	}
	return ResourceMonitoring.ChangeIndication.Ok;
}

/**
 * Pushes filter-life state to the AC endpoint's `HepaFilterMonitoring` cluster. When `filterState` is
 * `undefined` (e.g. the device has no filter sensor), writes nothing and leaves the cluster's
 * construction-time defaults (`condition=100, changeIndication=Ok`) in place.
 */
export async function applyThinqFilterStateToAirConditioner(
	airConditioner: MatterbridgeEndpoint,
	filterState: ThinqFilterState | undefined,
	logger: AnsiLogger,
): Promise<void> {
	if (!filterState) {
		logger.debug('ThinQ filter state: no data, skipping HepaFilterMonitoring update.');
		return;
	}

	await airConditioner.updateAttribute(HepaFilterMonitoring.id, 'condition', filterState.remainingPercent, logger);
	await airConditioner.updateAttribute(
		HepaFilterMonitoring.id,
		'changeIndication',
		resolveFilterChangeIndication(filterState.remainingPercent),
		logger,
	);
}
