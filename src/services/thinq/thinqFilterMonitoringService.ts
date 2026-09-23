import { AnsiLogger } from 'matterbridge/logger';

import { ThinqFilterState } from '../../core/domain/value-objects/ThinqFilterState.js';
import { ThinqApiClient } from './thinqApiClient.js';

export type ThinqFilterUpdateListener = (deviceId: string, filterState: ThinqFilterState | undefined) => void;

/**
 * Dedicated low-frequency poll job for AC filter-life state. Separate from `ThinqDeviceService`'s
 * snapshot polling because filter state is a different, per-device `Get` RPC on a much slower cadence.
 */
export class ThinqFilterMonitoringService {
	private pollTimer: NodeJS.Timeout | undefined;
	private pollTickCount = 0;

	constructor(
		private readonly apiClient: ThinqApiClient,
		private readonly logger: AnsiLogger,
	) {}

	public startPolling(intervalMs: number, deviceIds: string[], onUpdate: ThinqFilterUpdateListener): void {
		this.stopPolling();
		this.pollTickCount = 0;
		this.logger.debug(`ThinQ filter monitoring: starting with interval=${intervalMs}ms, devices=${deviceIds.length}`);
		this.pollTimer = setInterval(() => {
			void this.pollOnce(deviceIds, onUpdate);
		}, intervalMs);
	}

	public stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
			this.logger.debug(`ThinQ filter monitoring: stopped after ${this.pollTickCount} tick(s)`);
		}
	}

	private async pollOnce(deviceIds: string[], onUpdate: ThinqFilterUpdateListener): Promise<void> {
		this.pollTickCount += 1;
		this.logger.debug(`ThinQ filter monitoring: tick #${this.pollTickCount} at ${new Date().toISOString()}`);
		for (const deviceId of deviceIds) {
			try {
				const data = await this.apiClient.getFilterState(deviceId);
				onUpdate(deviceId, ThinqFilterState.fromRaw(data));
			} catch (error) {
				this.logger.debug(
					`ThinQ filter monitoring failed for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
				);
				onUpdate(deviceId, undefined);
			}
		}
	}
}
