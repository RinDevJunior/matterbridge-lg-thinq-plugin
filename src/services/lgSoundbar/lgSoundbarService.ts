import type { LgSoundbarDeviceConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import { LgSoundbarClient, type LgSoundbarState } from './lgSoundbarClient.js';
import { LG_SOUNDBAR_PORT, type LgSoundbarLogger } from './lgSoundbarProtocol.js';

export type { LgSoundbarDeviceConfig } from '../../model/LgThinqPluginPlatformConfig.js';
export type { LgSoundbarState } from './lgSoundbarClient.js';

export interface LgSoundbar {
	readonly deviceId: string;
	readonly name: string;
	readonly host: string;
	readonly port: number;
}

/** Local-network LG Soundbar service: config mapping, per-device clients, and periodic state polling. */
export class LgSoundbarService {
	private readonly clients = new Map<string, LgSoundbarClient>();
	private pollTimer: NodeJS.Timeout | undefined;

	constructor(private readonly logger: LgSoundbarLogger) {}

	/** Pure config mapping; performs no network I/O. */
	public discoverSoundbars(configs: readonly LgSoundbarDeviceConfig[]): LgSoundbar[] {
		return configs.map((config) => ({
			deviceId: config.id,
			name: config.name ?? `LG Soundbar ${config.host}`,
			host: config.host,
			port: config.port ?? LG_SOUNDBAR_PORT,
		}));
	}

	public getState(soundbar: LgSoundbar): Promise<LgSoundbarState> {
		return this.clientFor(soundbar).getState();
	}

	public setPower(soundbar: LgSoundbar, on: boolean): Promise<void> {
		return this.clientFor(soundbar).setPower(on);
	}

	public setVolume(soundbar: LgSoundbar, deviceVolume: number): Promise<void> {
		return this.clientFor(soundbar).setVolume(deviceVolume);
	}

	public getSoundMode(soundbar: LgSoundbar): Promise<number | undefined> {
		return this.clientFor(soundbar).getSoundMode();
	}

	public setSoundMode(soundbar: LgSoundbar, eq: number): Promise<void> {
		return this.clientFor(soundbar).setSoundMode(eq);
	}

	public startPolling(
		intervalMs: number,
		soundbars: readonly LgSoundbar[],
		onUpdate: (deviceId: string, state: LgSoundbarState) => void,
	): void {
		this.stopPolling();
		this.pollTimer = setInterval(() => {
			void this.pollAll(soundbars, onUpdate);
		}, intervalMs);
	}

	public stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	private async pollAll(
		soundbars: readonly LgSoundbar[],
		onUpdate: (deviceId: string, state: LgSoundbarState) => void,
	): Promise<void> {
		for (const soundbar of soundbars) {
			try {
				const state = await this.getState(soundbar);
				const soundMode = await this.getSoundMode(soundbar);
				onUpdate(soundbar.deviceId, { ...state, soundMode });
			} catch (error) {
				this.logger.warn(
					`LG Soundbar ${soundbar.deviceId}: poll failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	private clientFor(soundbar: LgSoundbar): LgSoundbarClient {
		const existing = this.clients.get(soundbar.deviceId);
		if (existing) {
			return existing;
		}
		const created = new LgSoundbarClient({ host: soundbar.host, port: soundbar.port }, this.logger);
		this.clients.set(soundbar.deviceId, created);
		return created;
	}
}
