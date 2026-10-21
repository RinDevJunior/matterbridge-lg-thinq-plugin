import type { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiClient } from '../services/thinqConnect/thinqConnectApiClient.js';
import { ThinqV2WasherService } from './thinqV2WasherService.js';

export const THINQ_V2_MIN_POLL_INTERVAL_SECONDS = 15;

export interface ThinqV2Options {
	personalAccessToken: string;
	country: string;
	pollIntervalSeconds: number;
}

/** DI container for the ThinQ Connect (PAT) generation; lazy singletons. Never logs its options. */
export class ThinqServiceV2Container {
	private connectApiClientInstance: ThinqConnectApiClient | undefined;
	private washerServiceInstance: ThinqV2WasherService | undefined;

	constructor(
		private readonly logger: AnsiLogger,
		private readonly options: ThinqV2Options,
	) {}

	public getConnectApiClient(): ThinqConnectApiClient {
		this.connectApiClientInstance ??= new ThinqConnectApiClient(
			this.options.personalAccessToken,
			this.options.country,
			this.logger,
		);
		return this.connectApiClientInstance;
	}

	public getWasherService(): ThinqV2WasherService {
		this.washerServiceInstance ??= new ThinqV2WasherService(this.getConnectApiClient(), this.logger);
		return this.washerServiceInstance;
	}

	public get pollIntervalMs(): number {
		return Math.max(this.options.pollIntervalSeconds, THINQ_V2_MIN_POLL_INTERVAL_SECONDS) * 1000;
	}

	public shutdown(): void {
		this.washerServiceInstance?.stopPolling();
	}
}
