import type { AnsiLogger } from 'matterbridge/logger';

import type { ThinqConnectApiClient } from '../services/thinqConnect/thinqConnectApiClient.js';
import {
	buildWasherPowerPayload,
	evaluateWasherPowerGuards,
	findProfileLocationName,
	isWasherPoweredOn,
	readWasherCurrentState,
	readWasherOperationModeProfile,
	type WasherOperationModeProfile,
	type WasherPowerCommand,
} from '../services/thinqConnect/thinqConnectWasher.js';

export const THINQ_V2_POST_COMMAND_REFRESH_DELAY_MS = 3000;

export interface ThinqV2Washer {
	deviceId: string;
	name: string;
	modelName?: string;
	locationName?: string;
	operationMode?: WasherOperationModeProfile;
}

export interface ThinqV2WasherState {
	currentState?: string;
	powerOn?: boolean;
}

export type ThinqV2PowerOutcome =
	| { status: 'sent'; state: ThinqV2WasherState }
	| { status: 'noop'; state: ThinqV2WasherState }
	| { status: 'refused'; reason: string; state: ThinqV2WasherState }
	| { status: 'failed'; error: string; state: ThinqV2WasherState };

export type ThinqV2StateListener = (deviceId: string, state: ThinqV2WasherState) => void;

export type ThinqV2ConnectClient = Pick<
	ThinqConnectApiClient,
	'getDevices' | 'getDeviceProfile' | 'getDeviceState' | 'controlDevice'
>;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Discovers ThinQ Connect washers, reads their state, sends guarded power commands, and polls state. */
export class ThinqV2WasherService {
	private readonly lastState = new Map<string, ThinqV2WasherState>();
	private readonly inFlight = new Set<string>();
	private readonly refreshTimers = new Set<NodeJS.Timeout>();
	private pollTimer: NodeJS.Timeout | undefined;
	private tickRunning = false;
	private listener: ThinqV2StateListener | undefined;

	constructor(
		private readonly client: ThinqV2ConnectClient,
		private readonly logger: AnsiLogger,
	) {}

	public async discoverWashers(): Promise<ThinqV2Washer[]> {
		const devices = await this.client.getDevices();
		const washers: ThinqV2Washer[] = [];

		for (const device of devices) {
			if (device.deviceInfo?.deviceType !== 'DEVICE_WASHER') {
				continue;
			}
			try {
				const profile = await this.client.getDeviceProfile(device.deviceId);
				washers.push({
					deviceId: device.deviceId,
					name: device.deviceInfo.alias?.trim() || device.deviceInfo.modelName || 'LG Washer',
					modelName: device.deviceInfo.modelName,
					locationName: findProfileLocationName(profile),
					operationMode: readWasherOperationModeProfile(profile),
				});
			} catch (error) {
				this.logger.warn(
					`ThinQ Connect: skipping washer ${device.deviceId}, profile unavailable: ${errorMessage(error)}`,
				);
			}
		}

		return washers;
	}

	public async readState(washer: ThinqV2Washer): Promise<ThinqV2WasherState> {
		const payload = await this.client.getDeviceState(washer.deviceId);
		const currentState = readWasherCurrentState(payload, washer.locationName);
		const state: ThinqV2WasherState = { currentState, powerOn: isWasherPoweredOn(currentState) };
		this.lastState.set(washer.deviceId, state);
		return state;
	}

	/** Never throws; every path resolves to an outcome. */
	public async setPower(washer: ThinqV2Washer, on: boolean): Promise<ThinqV2PowerOutcome> {
		const { deviceId } = washer;
		const command: WasherPowerCommand = on ? 'POWER_ON' : 'POWER_OFF';

		if (this.inFlight.has(deviceId)) {
			const reason = 'Another command is already in progress for this washer.';
			this.logger.warn(`ThinQ Connect: ${command} refused for ${deviceId}: ${reason}`);
			return { status: 'refused', reason, state: this.lastState.get(deviceId) ?? {} };
		}

		this.inFlight.add(deviceId);
		try {
			let state: ThinqV2WasherState;
			try {
				state = await this.readState(washer);
			} catch (error) {
				const message = errorMessage(error);
				this.logger.error(`ThinQ Connect: ${command} failed for ${deviceId} reading state: ${message}`);
				return { status: 'failed', error: message, state: this.lastState.get(deviceId) ?? {} };
			}

			if (state.powerOn === on) {
				this.logger.info(`ThinQ Connect: ${command} for ${deviceId} skipped, already in requested power state.`);
				return { status: 'noop', state };
			}

			const reason = evaluateWasherPowerGuards(command, washer.operationMode, state.currentState);
			if (reason !== undefined) {
				this.logger.warn(`ThinQ Connect: ${command} refused for ${deviceId}: ${reason}`);
				return { status: 'refused', reason, state };
			}

			try {
				await this.client.controlDevice(deviceId, buildWasherPowerPayload(command, washer.locationName));
			} catch (error) {
				const message = errorMessage(error);
				this.logger.error(`ThinQ Connect: ${command} failed for ${deviceId}: ${message}`);
				return { status: 'failed', error: message, state };
			}

			this.logger.info(`ThinQ Connect: ${command} sent for ${deviceId}.`);
			this.scheduleRefresh(washer);
			return { status: 'sent', state: { currentState: undefined, powerOn: on } };
		} finally {
			this.inFlight.delete(deviceId);
		}
	}

	public startPolling(intervalMs: number, washers: readonly ThinqV2Washer[], listener: ThinqV2StateListener): void {
		this.stopPolling();
		this.listener = listener;

		const tick = async (): Promise<void> => {
			if (this.tickRunning) {
				return;
			}
			this.tickRunning = true;
			try {
				for (const washer of washers) {
					try {
						listener(washer.deviceId, await this.readState(washer));
					} catch (error) {
						this.logger.warn(`ThinQ Connect: state poll failed for ${washer.deviceId}: ${errorMessage(error)}`);
					}
				}
			} finally {
				this.tickRunning = false;
			}
		};

		void tick();
		this.pollTimer = setInterval(() => void tick(), intervalMs);
	}

	public stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		for (const timer of this.refreshTimers) {
			clearTimeout(timer);
		}
		this.refreshTimers.clear();
		this.listener = undefined;
	}

	private scheduleRefresh(washer: ThinqV2Washer): void {
		const { listener } = this;
		if (!listener) {
			return;
		}
		const timer = setTimeout(() => {
			this.refreshTimers.delete(timer);
			this.readState(washer).then(
				(state) => listener(washer.deviceId, state),
				(error: unknown) =>
					this.logger.warn(`ThinQ Connect: post-command refresh failed for ${washer.deviceId}: ${errorMessage(error)}`),
			);
		}, THINQ_V2_POST_COMMAND_REFRESH_DELAY_MS);
		this.refreshTimers.add(timer);
	}
}
