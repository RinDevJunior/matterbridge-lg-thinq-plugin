import type { AnsiLogger } from 'matterbridge/logger';

import { LgSoundbarService } from '../services/lgSoundbar/lgSoundbarService.js';

export const LG_SOUNDBAR_MIN_POLL_INTERVAL_SECONDS = 10;

/** DI container for the local-network LG Soundbar family; lazy singleton service. */
export class LgSoundbarServiceContainer {
	private lgSoundbarServiceInstance: LgSoundbarService | undefined;

	constructor(
		private readonly logger: AnsiLogger,
		private readonly pollIntervalSeconds: number,
	) {}

	public getService(): LgSoundbarService {
		this.lgSoundbarServiceInstance ??= new LgSoundbarService(this.logger);
		return this.lgSoundbarServiceInstance;
	}

	public get pollIntervalMs(): number {
		return Math.max(this.pollIntervalSeconds, LG_SOUNDBAR_MIN_POLL_INTERVAL_SECONDS) * 1000;
	}

	public shutdown(): void {
		this.lgSoundbarServiceInstance?.stopPolling();
	}
}
