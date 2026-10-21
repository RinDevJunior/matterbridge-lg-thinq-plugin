import type { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiClient } from '../services/thinqConnect/thinqConnectApiClient.js';
import { ThinqConnectAirConditionerService } from './thinqConnectAirConditionerService.js';
import { ThinqConnectWasherService } from './thinqConnectWasherService.js';

export const THINQ_CONNECT_MIN_POLL_INTERVAL_SECONDS = 15;

export interface ThinqConnectOptions {
	personalAccessToken: string;
	country: string;
	pollIntervalSeconds: number;
}

/** DI container for the ThinQ Connect (PAT) generation; lazy singletons. Never logs its options. */
export class ThinqConnectServiceContainer {
	private connectApiClientInstance: ThinqConnectApiClient | undefined;
	private washerServiceInstance: ThinqConnectWasherService | undefined;
	private airConditionerServiceInstance: ThinqConnectAirConditionerService | undefined;

	constructor(
		private readonly logger: AnsiLogger,
		private readonly options: ThinqConnectOptions,
	) {}

	public getConnectApiClient(): ThinqConnectApiClient {
		this.connectApiClientInstance ??= new ThinqConnectApiClient(
			this.options.personalAccessToken,
			this.options.country,
			this.logger,
		);
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

	public shutdown(): void {
		this.washerServiceInstance?.stopPolling();
		this.airConditionerServiceInstance?.stopPolling();
	}
}
