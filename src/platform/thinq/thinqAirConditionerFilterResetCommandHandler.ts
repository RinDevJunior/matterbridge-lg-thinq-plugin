import { MatterbridgeEndpoint } from 'matterbridge';
import { AnsiLogger } from 'matterbridge/logger';

import type { ThinqAirConditionerDevice } from '../../core/domain/entities/ThinqDevice.js';
import type { AirConditionerCapabilities } from '../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqFilterState } from '../../core/domain/value-objects/ThinqFilterState.js';
import type { ThinqAcFilterControlConfig } from '../../model/LgThinkqPluginPlatformConfig.js';
import type { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';

const KEY_USE_TIME = 'airState.filterMngState.useTime';
const KEY_REMAIN_TIME = 'airState.filterMngState.remainTime';
const KEY_MAX_TIME = 'airState.filterMngState.maxTime';
const KEY_CHANGE_DATE = 'airState.filterMngState.changeDate';

/**
 * Builds the `filterMngStateCtrl` `Set` payload for a filter-counter reset, scoped strictly to the
 * field names already proven present in this device's own live `Get` response — echoes `maxTime`
 * back unchanged (never mutates the device's rated filter life) and resets `useTime`/`remainTime`/
 * `changeDate` to their reset-state values.
 */
export function resolveFilterResetPayload(
	filterState: ThinqFilterState,
	now: Date = new Date(),
): Record<string, unknown> {
	return {
		[KEY_USE_TIME]: 0,
		[KEY_REMAIN_TIME]: filterState.ratedMaxTimeHours,
		[KEY_MAX_TIME]: filterState.ratedMaxTimeHours,
		[KEY_CHANGE_DATE]: formatChangeDate(now),
	};
}

function formatChangeDate(date: Date): number {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return Number(`${year}${month}${day}`);
}

/**
 * Registers the Matter `HepaFilterMonitoring.resetCondition()` command handler. No-ops entirely when
 * `supportsFilterMonitoring` is false (the cluster is never created on the endpoint in that case).
 * Never writes `condition`/`changeIndication`/`lastChangedTime` itself — matterbridge's own
 * `MatterbridgeHepaFilterMonitoringServer.resetCondition()` does that automatically, but only after
 * this handler resolves without throwing.
 */
export function registerFilterResetCommandHandler(
	airConditioner: MatterbridgeEndpoint,
	device: ThinqAirConditionerDevice,
	apiClient: ThinqApiClient,
	logger: AnsiLogger,
	capabilities: AirConditionerCapabilities,
	filterResetControl: ThinqAcFilterControlConfig,
): void {
	if (!capabilities.supportsFilterMonitoring) {
		return;
	}

	airConditioner.addCommandHandler('resetCondition', async () => {
		if (!filterResetControl.allowFilterReset) {
			logger.warn(`ThinQ AirConditioner filter reset is disabled by configuration (deviceId=${device.id})`);
			throw new Error('ThinQ AirConditioner filter reset is disabled by configuration.');
		}

		let filterState: ThinqFilterState | undefined;
		try {
			filterState = ThinqFilterState.fromRaw(await apiClient.getFilterState(device.id));
		} catch (error) {
			logger.error(
				`ThinQ AirConditioner filter reset failed to read current filter state: ${error instanceof Error ? error.message : String(error)} (deviceId=${device.id})`,
			);
			throw error;
		}

		if (!filterState) {
			logger.warn(
				`ThinQ AirConditioner filter reset: no current filter data available, refusing to reset (deviceId=${device.id})`,
			);
			throw new Error('ThinQ AirConditioner filter reset: no current filter data available for this device.');
		}

		try {
			await apiClient.sendCommand(device.id, {
				ctrlKey: 'filterMngStateCtrl',
				command: 'Set',
				dataSetList: resolveFilterResetPayload(filterState),
			});
			logger.info(`ThinQ AirConditioner filter reset succeeded (deviceId=${device.id})`);
		} catch (error) {
			logger.error(
				`ThinQ AirConditioner filter reset command failed: ${error instanceof Error ? error.message : String(error)} (deviceId=${device.id})`,
			);
			throw error;
		}
	});
}
