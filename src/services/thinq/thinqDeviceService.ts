import { AnsiLogger } from 'matterbridge/logger';

import {
	isAirConditionerDevice,
	isValidThinqDeviceId,
	ThinqDevice,
	toThinqDevice,
} from '../../core/domain/entities/ThinqDevice.js';
import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';
import { ThinqApiClient } from './thinqApiClient.js';

export type ThinqDeviceUpdateListener = (deviceId: string, snapshot: ThinqSnapshot) => void;

export const THINQ_KEEP_ALIVE_INTERVAL_MS = 60000;

/**
 * Discovers ThinQ devices and polls their state. Polling runs alongside a separate `ThinqMqttListener`
 * (Phase 4) that pushes the same update shape over MQTT — ports `pollThinQ2Devices()`'s
 * full-refetch-per-tick approach (`platformMonitor.ts:104-123`).
 */
export class ThinqDeviceService {
	private pollTimer: NodeJS.Timeout | undefined;
	private pollTickCount = 0;
	private keepAliveTimer: NodeJS.Timeout | undefined;
	private airConditionerOnlineStatus = new Map<string, boolean>();

	constructor(
		private readonly apiClient: ThinqApiClient,
		private readonly logger: AnsiLogger,
	) {}

	/** Fetches every device on the account and maps it to the generic `ThinqDevice` domain entity. */
	public async discoverDevices(): Promise<ThinqDevice[]> {
		const rawDevices = await this.apiClient.getListDevices();

		return rawDevices.filter((device) => isValidThinqDeviceId(device.deviceId)).map((device) => toThinqDevice(device));
	}

	public startPolling(intervalMs: number, onUpdate: ThinqDeviceUpdateListener): void {
		this.stopPolling();
		this.pollTickCount = 0;
		this.logger.debug(`ThinQ polling: starting with interval=${intervalMs}ms`);
		this.pollTimer = setInterval(() => {
			void this.pollOnce(onUpdate);
		}, intervalMs);
	}

	public stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
			this.logger.debug(`ThinQ polling: stopped after ${this.pollTickCount} tick(s)`);
		}
	}

	public startKeepAlive(intervalMs: number = THINQ_KEEP_ALIVE_INTERVAL_MS): void {
		this.stopKeepAlive();
		this.logger.debug(`ThinQ keep-alive: starting with interval=${intervalMs}ms`);
		this.keepAliveTimer = setInterval(() => {
			void this.keepAliveOnce();
		}, intervalMs);
	}

	public stopKeepAlive(): void {
		if (this.keepAliveTimer) {
			clearInterval(this.keepAliveTimer);
			this.keepAliveTimer = undefined;
			this.logger.debug(`ThinQ keep-alive: stopped`);
		}
	}

	private async keepAliveOnce(): Promise<void> {
		this.logger.debug(`ThinQ keep-alive: tick at ${new Date().toISOString()}`);
		for (const [deviceId, online] of this.airConditionerOnlineStatus.entries()) {
			if (!online) {
				continue;
			}
			try {
				await this.apiClient.sendKeepAlive(deviceId);
			} catch (error) {
				this.logger.debug(
					`ThinQ keep-alive failed for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	private async pollOnce(onUpdate: ThinqDeviceUpdateListener): Promise<void> {
		this.pollTickCount += 1;
		this.logger.debug(`ThinQ polling: tick #${this.pollTickCount} at ${new Date().toISOString()}`);
		try {
			const devices = await this.discoverDevices();
			this.airConditionerOnlineStatus = new Map(devices.filter(isAirConditionerDevice).map((d) => [d.id, d.online]));
			for (const device of devices) {
				onUpdate(device.id, device.snapshot);
			}
		} catch (error) {
			this.logger.error(`ThinQ polling tick failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
