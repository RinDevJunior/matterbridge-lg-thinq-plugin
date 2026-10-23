import type { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiClient } from '../services/thinqConnect/thinqConnectApiClient.js';
import {
	type ThinqConnectAirConditioner,
	ThinqConnectAirConditionerService,
} from './thinqConnectAirConditionerService.js';
import { ThinqConnectPushService } from './thinqConnectPushService.js';
import { type ThinqConnectWasher, ThinqConnectWasherService } from './thinqConnectWasherService.js';

export const THINQ_CONNECT_MIN_POLL_INTERVAL_SECONDS = 15;
export const THINQ_CONNECT_PUSH_SAFETY_POLL_SECONDS = 300;

export interface ThinqConnectOptions {
	personalAccessToken: string;
	country: string;
	pollIntervalSeconds: number;
	clientId?: string;
}

/** DI container for the ThinQ Connect (PAT) generation; lazy singletons. Never logs its options. */
export class ThinqConnectServiceContainer {
	private connectApiClientInstance: ThinqConnectApiClient | undefined;
	private washerServiceInstance: ThinqConnectWasherService | undefined;
	private airConditionerServiceInstance: ThinqConnectAirConditionerService | undefined;
	private pushServiceInstance: ThinqConnectPushService | undefined;

	constructor(
		private readonly logger: AnsiLogger,
		private readonly options: ThinqConnectOptions,
	) {}

	public getConnectApiClient(): ThinqConnectApiClient {
		if (!this.connectApiClientInstance) {
			const { personalAccessToken, country, clientId } = this.options;
			this.connectApiClientInstance =
				clientId === undefined
					? new ThinqConnectApiClient(personalAccessToken, country, this.logger)
					: new ThinqConnectApiClient(personalAccessToken, country, this.logger, clientId);
		}
		return this.connectApiClientInstance;
	}

	public getWasherService(): ThinqConnectWasherService {
		this.washerServiceInstance ??= new ThinqConnectWasherService(this.getConnectApiClient(), this.logger);
		return this.washerServiceInstance;
	}

	public getAirConditionerService(): ThinqConnectAirConditionerService {
		this.airConditionerServiceInstance ??= new ThinqConnectAirConditionerService(
			this.getConnectApiClient(),
			this.logger,
		);
		return this.airConditionerServiceInstance;
	}

	public get pollIntervalMs(): number {
		return Math.max(this.options.pollIntervalSeconds, THINQ_CONNECT_MIN_POLL_INTERVAL_SECONDS) * 1000;
	}

	public get safetyPollIntervalMs(): number {
		return Math.max(this.pollIntervalMs, THINQ_CONNECT_PUSH_SAFETY_POLL_SECONDS * 1000);
	}

	public getPushService(): ThinqConnectPushService {
		this.pushServiceInstance ??= new ThinqConnectPushService({
			api: this.getConnectApiClient(),
			logger: this.logger,
		});
		return this.pushServiceInstance;
	}

	/** Push is best effort: events trigger a normal state refresh and health switches the poll interval. */
	public startPush(devices: {
		washers: readonly ThinqConnectWasher[];
		airConditioners: readonly ThinqConnectAirConditioner[];
	}): void {
		const washers = new Map(devices.washers.map((washer) => [washer.deviceId, washer]));
		const airConditioners = new Map(devices.airConditioners.map((ac) => [ac.deviceId, ac]));
		this.getPushService().start([...washers.keys(), ...airConditioners.keys()], {
			onDeviceEvent: (deviceId) => {
				const washer = washers.get(deviceId);
				if (washer) {
					void this.getWasherService().refreshState(washer);
				}
				const ac = airConditioners.get(deviceId);
				if (ac) {
					void this.getAirConditionerService().refreshState(ac);
				}
			},
			onHealthChange: (healthy) => {
				const intervalMs = healthy ? this.safetyPollIntervalMs : this.pollIntervalMs;
				this.getWasherService().setPollInterval(intervalMs, !healthy);
				this.getAirConditionerService().setPollInterval(intervalMs, !healthy);
			},
		});
	}

	public async stopPush(): Promise<void> {
		await this.pushServiceInstance?.stop();
	}

	public shutdown(): void {
		void this.pushServiceInstance?.stop();
		this.washerServiceInstance?.stopPolling();
		this.airConditionerServiceInstance?.stopPolling();
	}
}
