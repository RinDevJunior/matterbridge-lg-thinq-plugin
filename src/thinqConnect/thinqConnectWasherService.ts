import type { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiError } from '../errors/index.js';
import type { ThinqConnectApiClient } from '../services/thinqConnect/thinqConnectApiClient.js';
import {
	buildWasherOperationPayload,
	buildWasherPowerPayload,
	describeWasherCommandFailure,
	evaluateWasherCycleCommand,
	evaluateWasherPowerGuards,
	findProfileLocationName,
	isWasherPoweredOn,
	readWasherCurrentState,
	readWasherOperationModeProfile,
	readWasherRemainingSeconds,
	readWasherRemoteControlEnabled,
	type WasherCycleCommand,
	type WasherOperationModeProfile,
	type WasherPowerCommand,
} from '../services/thinqConnect/thinqConnectWasher.js';

export const THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS = 3000;

export interface ThinqConnectWasher {
	deviceId: string;
	name: string;
	modelName?: string;
	locationName?: string;
	operationMode?: WasherOperationModeProfile;
}

export interface ThinqConnectWasherState {
	currentState?: string;
	powerOn?: boolean;
	remainingSeconds?: number;
	remoteControlEnabled?: boolean;
}

export type ThinqConnectWasherPowerOutcome =
	| { status: 'sent'; state: ThinqConnectWasherState }
	| { status: 'noop'; state: ThinqConnectWasherState }
	| { status: 'refused'; reason: string; state: ThinqConnectWasherState }
	| { status: 'failed'; error: string; state: ThinqConnectWasherState };

export type ThinqConnectWasherCommandOutcome =
	| { status: 'sent'; state: ThinqConnectWasherState }
	| { status: 'noop'; state: ThinqConnectWasherState }
	| { status: 'refused'; reason: string; state: ThinqConnectWasherState }
	| { status: 'failed'; error: string; hint: string; resultCode?: string; state: ThinqConnectWasherState };

export type ThinqConnectWasherStateListener = (deviceId: string, state: ThinqConnectWasherState) => void;

export type ThinqConnectWasherClient = Pick<
	ThinqConnectApiClient,
	'getDevices' | 'getDeviceProfile' | 'getDeviceState' | 'controlDevice'
>;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const errorResultCode = (error: unknown): string | undefined => {
	if (!(error instanceof ThinqConnectApiError)) {
		return undefined;
	}
	const code = error.metadata?.['resultCode'];
	return typeof code === 'string' ? code : undefined;
};

/** Discovers ThinQ Connect washers, reads their state, sends guarded power commands, and polls state. */
export class ThinqConnectWasherService {
	private readonly lastState = new Map<string, ThinqConnectWasherState>();
	private readonly inFlight = new Set<string>();
	private readonly refreshTimers = new Set<NodeJS.Timeout>();
	private pollTimer: NodeJS.Timeout | undefined;
	private tickRunning = false;
	private listener: ThinqConnectWasherStateListener | undefined;

	constructor(
		private readonly client: ThinqConnectWasherClient,
		private readonly logger: AnsiLogger,
	) {}

	public async discoverWashers(): Promise<ThinqConnectWasher[]> {
		const devices = await this.client.getDevices();
		const washers: ThinqConnectWasher[] = [];

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

	public async readState(washer: ThinqConnectWasher): Promise<ThinqConnectWasherState> {
		const payload = await this.client.getDeviceState(washer.deviceId);
		const currentState = readWasherCurrentState(payload, washer.locationName);
		const state: ThinqConnectWasherState = {
			currentState,
			powerOn: isWasherPoweredOn(currentState),
			remainingSeconds: readWasherRemainingSeconds(payload, washer.locationName),
			remoteControlEnabled: readWasherRemoteControlEnabled(payload, washer.locationName),
		};
		this.lastState.set(washer.deviceId, state);
		return state;
	}

	/** Never throws; every path resolves to an outcome. */
	public async setPower(washer: ThinqConnectWasher, on: boolean): Promise<ThinqConnectWasherPowerOutcome> {
		const { deviceId } = washer;
		const command: WasherPowerCommand = on ? 'POWER_ON' : 'POWER_OFF';

		if (this.inFlight.has(deviceId)) {
			const reason = 'Another command is already in progress for this washer.';
			this.logger.warn(`ThinQ Connect: ${command} refused for ${deviceId}: ${reason}`);
			return { status: 'refused', reason, state: this.lastState.get(deviceId) ?? {} };
		}

		this.inFlight.add(deviceId);
		try {
			let state: ThinqConnectWasherState;
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

	/** Never throws; every path resolves to an outcome. */
	public async startCycle(washer: ThinqConnectWasher): Promise<ThinqConnectWasherCommandOutcome> {
		return this.runCycleCommand(washer, 'START');
	}

	/** Never throws; every path resolves to an outcome. */
	public async stopCycle(washer: ThinqConnectWasher): Promise<ThinqConnectWasherCommandOutcome> {
		return this.runCycleCommand(washer, 'STOP');
	}

	public startPolling(
		intervalMs: number,
		washers: readonly ThinqConnectWasher[],
		listener: ThinqConnectWasherStateListener,
	): void {
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

	private async runCycleCommand(
		washer: ThinqConnectWasher,
		command: WasherCycleCommand,
	): Promise<ThinqConnectWasherCommandOutcome> {
		const { deviceId, locationName } = washer;

		if (this.inFlight.has(deviceId)) {
			const reason = 'Another command is already in progress for this washer.';
			this.logger.warn(`ThinQ Connect: ${command} refused for ${deviceId}: ${reason}`);
			return { status: 'refused', reason, state: this.lastState.get(deviceId) ?? {} };
		}

		this.inFlight.add(deviceId);
		try {
			if (locationName === undefined) {
				const reason = 'Washer profile has no locationName; refusing to send (ThinQ would answer 2207).';
				this.logger.warn(`ThinQ Connect: ${command} refused for ${deviceId}: ${reason}`);
				return { status: 'refused', reason, state: this.lastState.get(deviceId) ?? {} };
			}

			let state: ThinqConnectWasherState;
			try {
				state = await this.readState(washer);
			} catch (error) {
				const message = errorMessage(error);
				const resultCode = errorResultCode(error);
				this.logger.error(`ThinQ Connect: ${command} failed for ${deviceId} reading state: ${message}`);
				return {
					status: 'failed',
					error: message,
					hint: describeWasherCommandFailure(resultCode, message),
					resultCode,
					state: this.lastState.get(deviceId) ?? {},
				};
			}

			const decision = evaluateWasherCycleCommand(
				command,
				washer.operationMode,
				state.currentState,
				state.remoteControlEnabled,
			);
			if (decision.kind === 'noop') {
				this.logger.info(`ThinQ Connect: ${command} for ${deviceId} skipped: ${decision.reason}`);
				return { status: 'noop', state };
			}
			if (decision.kind === 'refuse') {
				this.logger.warn(`ThinQ Connect: ${command} refused for ${deviceId}: ${decision.reason}`);
				return { status: 'refused', reason: decision.reason, state };
			}

			try {
				await this.client.controlDevice(deviceId, buildWasherOperationPayload(command, locationName));
			} catch (error) {
				const message = errorMessage(error);
				const resultCode = errorResultCode(error);
				this.logger.error(`ThinQ Connect: ${command} failed for ${deviceId}: ${message}`);
				this.scheduleRefresh(washer);
				return {
					status: 'failed',
					error: message,
					hint: describeWasherCommandFailure(resultCode, message),
					resultCode,
					state,
				};
			}

			this.logger.info(`ThinQ Connect: ${command} sent for ${deviceId}.`);
			this.scheduleRefresh(washer);
			return { status: 'sent', state: {} };
		} finally {
			this.inFlight.delete(deviceId);
		}
	}

	private scheduleRefresh(washer: ThinqConnectWasher): void {
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
		}, THINQ_CONNECT_WASHER_POST_COMMAND_REFRESH_DELAY_MS);
		this.refreshTimers.add(timer);
	}
}
