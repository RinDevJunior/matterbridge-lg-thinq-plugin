import type { AnsiLogger } from 'matterbridge/logger';

import {
	type AirConditionerProfile,
	type AirConditionerRawState,
	type AirConditionerTemperatureUnit,
	buildAirConditionerJobModePayload,
	buildAirConditionerPowerPayload,
	buildAirConditionerSwingPayload,
	buildAirConditionerTargetTemperaturePayload,
	buildAirConditionerWindStepPayload,
	buildAirConditionerWindStrengthPayload,
	celsiusToFahrenheit,
	evaluateAirConditionerEnumWrite,
	evaluateAirConditionerRangeWrite,
	evaluateAirConditionerWindStepWrite,
	fahrenheitToCelsius,
	filterRemainingPercent,
	isAirConditionerFaultState,
	readAirConditionerProfile,
	readAirConditionerState,
	resolveTargetTemperatureUnit,
	snapToRange,
} from '../services/thinqConnect/thinqConnectAirConditioner.js';
import type { ThinqConnectApiClient, ThinqConnectResource } from '../services/thinqConnect/thinqConnectApiClient.js';

export const THINQ_CONNECT_AC_POST_COMMAND_REFRESH_DELAY_MS = 3000;

export interface ThinqConnectAirConditioner {
	deviceId: string;
	name: string;
	modelName?: string;
	profile: AirConditionerProfile;
	initialState?: ThinqConnectAirConditionerState;
}

export interface ThinqConnectAirConditionerState {
	powerOn?: boolean;
	jobMode?: string;
	temperatureUnit?: AirConditionerTemperatureUnit;
	currentTemperatureC?: number;
	targetTemperatureC?: number;
	windStrength?: string;
	windStep?: number;
	rotateUpDown?: boolean;
	rotateLeftRight?: boolean;
	humidityPercent?: number;
	filterRemainingPercent?: number;
}

export type ThinqConnectAirConditionerOutcome =
	| { status: 'sent'; state: ThinqConnectAirConditionerState }
	| { status: 'noop'; state: ThinqConnectAirConditionerState }
	| { status: 'refused'; reason: string; state: ThinqConnectAirConditionerState }
	| { status: 'failed'; error: string; state: ThinqConnectAirConditionerState };

export type ThinqConnectAirConditionerStateListener = (
	deviceId: string,
	state: ThinqConnectAirConditionerState,
) => void;

export type ThinqConnectAirConditionerClient = Pick<
	ThinqConnectApiClient,
	'getDevices' | 'getDeviceProfile' | 'getDeviceState' | 'controlDevice'
>;

type CommandPlan =
	| { kind: 'noop' }
	| { kind: 'refuse'; reason: string }
	| { kind: 'send'; payload: ThinqConnectResource; patch: Partial<ThinqConnectAirConditionerState> };

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const toCelsius = (value: number | undefined, unit: AirConditionerTemperatureUnit | undefined): number | undefined => {
	if (value === undefined) {
		return undefined;
	}
	return unit === 'F' ? fahrenheitToCelsius(value) : value;
};

const toState = (
	raw: AirConditionerRawState,
	fallbackUnit?: AirConditionerTemperatureUnit,
): ThinqConnectAirConditionerState => ({
	powerOn: raw.powerOn,
	jobMode: raw.jobMode,
	temperatureUnit: raw.temperatureUnit,
	currentTemperatureC: toCelsius(raw.currentTemperature, raw.temperatureUnit ?? fallbackUnit),
	targetTemperatureC: toCelsius(raw.targetTemperature, raw.temperatureUnit ?? fallbackUnit),
	windStrength: raw.windStrength,
	windStep: raw.windStep,
	rotateUpDown: raw.rotateUpDown,
	rotateLeftRight: raw.rotateLeftRight,
	humidityPercent: raw.humidityPercent,
	filterRemainingPercent: filterRemainingPercent(raw),
});

/** Discovers ThinQ Connect air conditioners, reads their state, sends guarded commands, and polls state. */
export class ThinqConnectAirConditionerService {
	private readonly lastState = new Map<string, ThinqConnectAirConditionerState>();
	private readonly lastRaw = new Map<string, AirConditionerRawState>();
	private readonly faultState = new Map<string, string>();
	private readonly inFlight = new Set<string>();
	private readonly refreshTimers = new Set<NodeJS.Timeout>();
	private pollTimer: NodeJS.Timeout | undefined;
	private tickRunning = false;
	private pollTick: (() => Promise<void>) | undefined;
	private listener: ThinqConnectAirConditionerStateListener | undefined;

	constructor(
		private readonly client: ThinqConnectAirConditionerClient,
		private readonly logger: AnsiLogger,
	) {}

	public async discoverAirConditioners(): Promise<ThinqConnectAirConditioner[]> {
		const devices = await this.client.getDevices();
		const airConditioners: ThinqConnectAirConditioner[] = [];

		for (const device of devices) {
			if (device.deviceInfo?.deviceType !== 'DEVICE_AIR_CONDITIONER') {
				continue;
			}
			try {
				const profile = await this.client.getDeviceProfile(device.deviceId);
				const airConditioner: ThinqConnectAirConditioner = {
					deviceId: device.deviceId,
					name: device.deviceInfo.alias?.trim() || device.deviceInfo.modelName || 'LG Air Conditioner',
					modelName: device.deviceInfo.modelName,
					profile: readAirConditionerProfile(profile),
				};
				try {
					airConditioner.initialState = await this.readState(airConditioner);
				} catch (error) {
					this.logger.warn(
						`ThinQ Connect: initial state unavailable for air conditioner ${device.deviceId}: ${errorMessage(error)}`,
					);
				}
				airConditioners.push(airConditioner);
			} catch (error) {
				this.logger.warn(
					`ThinQ Connect: skipping air conditioner ${device.deviceId}, profile unavailable: ${errorMessage(error)}`,
				);
			}
		}

		return airConditioners;
	}

	public async readState(ac: ThinqConnectAirConditioner): Promise<ThinqConnectAirConditionerState> {
		const payload = await this.client.getDeviceState(ac.deviceId);
		const raw = readAirConditionerState(payload);
		this.trackFaultState(ac, raw.runState);
		const state = toState(raw, resolveTargetTemperatureUnit(ac.profile));
		this.lastRaw.set(ac.deviceId, raw);
		this.lastState.set(ac.deviceId, state);
		return state;
	}

	public async setPower(ac: ThinqConnectAirConditioner, on: boolean): Promise<ThinqConnectAirConditionerOutcome> {
		const label = on ? 'POWER_ON' : 'POWER_OFF';
		return this.runCommand(ac, label, (state) => this.planPower(ac, state, on));
	}

	public async setCoolMode(ac: ThinqConnectAirConditioner): Promise<ThinqConnectAirConditionerOutcome> {
		return this.runCommand(ac, 'COOL', (state) => {
			if (state.powerOn === undefined) {
				return { kind: 'refuse', reason: 'Air conditioner state is unknown; refusing to send.' };
			}
			if (!state.powerOn) {
				return this.planPower(ac, state, true);
			}
			if (state.jobMode === undefined) {
				return { kind: 'refuse', reason: 'Air conditioner job mode is unknown; refusing to send.' };
			}
			if (state.jobMode === 'COOL') {
				return { kind: 'noop' };
			}
			const reason = evaluateAirConditionerEnumWrite('airConJobMode.currentJobMode', ac.profile.jobMode, 'COOL');
			if (reason !== undefined) {
				return { kind: 'refuse', reason };
			}
			return { kind: 'send', payload: buildAirConditionerJobModePayload('COOL'), patch: { jobMode: 'COOL' } };
		});
	}

	public async setTargetTemperature(
		ac: ThinqConnectAirConditioner,
		celsius: number,
	): Promise<ThinqConnectAirConditionerOutcome> {
		return this.runCommand(ac, 'TARGET_TEMPERATURE', (state) => {
			const offReason = this.requirePoweredOn(state);
			if (offReason !== undefined) {
				return { kind: 'refuse', reason: offReason };
			}
			const range = ac.profile.targetTemperature;
			const reason = evaluateAirConditionerRangeWrite('temperature.targetTemperature', range);
			if (reason !== undefined || !range) {
				return { kind: 'refuse', reason: reason ?? 'Profile has no temperature.targetTemperature.' };
			}
			const unit = resolveTargetTemperatureUnit(ac.profile);
			const requested = unit === 'F' ? celsiusToFahrenheit(celsius) : celsius;
			const snapped = snapToRange(requested, range);
			const snappedCelsius = unit === 'F' ? fahrenheitToCelsius(snapped) : snapped;
			const raw = this.lastRaw.get(ac.deviceId);
			const currentCelsius = toCelsius(raw?.targetTemperature, raw?.temperatureUnit ?? unit);
			if (currentCelsius !== undefined && Math.abs(snappedCelsius - currentCelsius) < 0.001) {
				return { kind: 'noop' };
			}
			return {
				kind: 'send',
				payload: buildAirConditionerTargetTemperaturePayload(snapped, unit),
				patch: { targetTemperatureC: snappedCelsius },
			};
		});
	}

	public async setWindStrength(
		ac: ThinqConnectAirConditioner,
		strength: 'LOW' | 'MID' | 'HIGH' | 'AUTO',
	): Promise<ThinqConnectAirConditionerOutcome> {
		return this.runCommand(ac, `WIND_${strength}`, (state) => {
			const offReason = this.requirePoweredOn(state);
			if (offReason !== undefined) {
				return { kind: 'refuse', reason: offReason };
			}
			const reason = evaluateAirConditionerEnumWrite('airFlow.windStrength', ac.profile.windStrength, strength);
			if (reason !== undefined) {
				return { kind: 'refuse', reason };
			}
			if (state.windStrength === undefined) {
				return { kind: 'refuse', reason: 'Wind strength is unknown; refusing to send.' };
			}
			if (state.windStrength === strength) {
				return { kind: 'noop' };
			}
			return {
				kind: 'send',
				payload: buildAirConditionerWindStrengthPayload(strength),
				patch: { windStrength: strength },
			};
		});
	}

	public async setWindStep(ac: ThinqConnectAirConditioner, step: number): Promise<ThinqConnectAirConditionerOutcome> {
		return this.runCommand(ac, `WIND_STEP_${step}`, (state) => {
			const offReason = this.requirePoweredOn(state);
			if (offReason !== undefined) {
				return { kind: 'refuse', reason: offReason };
			}
			const reason = evaluateAirConditionerWindStepWrite(ac.profile, step);
			if (reason !== undefined) {
				return { kind: 'refuse', reason };
			}
			if (state.windStep === undefined) {
				return { kind: 'refuse', reason: 'Wind step is unknown; refusing to send.' };
			}
			if (state.windStep === step) {
				return { kind: 'noop' };
			}
			return {
				kind: 'send',
				payload: buildAirConditionerWindStepPayload(step),
				patch: { windStep: step, windStrength: undefined },
			};
		});
	}

	public async setSwing(
		ac: ThinqConnectAirConditioner,
		axes: { rotateUpDown?: boolean; rotateLeftRight?: boolean },
	): Promise<ThinqConnectAirConditionerOutcome> {
		return this.runCommand(ac, 'SWING', (state) => {
			const offReason = this.requirePoweredOn(state);
			if (offReason !== undefined) {
				return { kind: 'refuse', reason: offReason };
			}
			const changed: { rotateUpDown?: boolean; rotateLeftRight?: boolean } = {};
			for (const axis of ['rotateUpDown', 'rotateLeftRight'] as const) {
				const requested = axes[axis];
				if (requested === undefined) {
					continue;
				}
				if (!ac.profile[axis]) {
					return { kind: 'refuse', reason: `windDirection.${axis} is not writable for this device.` };
				}
				const current = state[axis];
				if (current === undefined) {
					return { kind: 'refuse', reason: `windDirection.${axis} state is unknown; refusing to send.` };
				}
				if (current !== requested) {
					changed[axis] = requested;
				}
			}
			if (Object.keys(changed).length === 0) {
				return { kind: 'noop' };
			}
			return { kind: 'send', payload: buildAirConditionerSwingPayload(changed), patch: changed };
		});
	}

	public startPolling(
		intervalMs: number,
		acs: readonly ThinqConnectAirConditioner[],
		listener: ThinqConnectAirConditionerStateListener,
	): void {
		this.stopPolling();
		this.listener = listener;

		const tick = async (): Promise<void> => {
			if (this.tickRunning) {
				return;
			}
			this.tickRunning = true;
			try {
				for (const ac of acs) {
					try {
						listener(ac.deviceId, await this.readState(ac));
					} catch (error) {
						this.logger.warn(`ThinQ Connect: state poll failed for ${ac.deviceId}: ${errorMessage(error)}`);
					}
				}
			} finally {
				this.tickRunning = false;
			}
		};

		this.pollTick = tick;
		void tick();
		this.pollTimer = setInterval(() => void tick(), intervalMs);
	}

	/** Replaces only the interval timer; no-op when not polling. */
	public setPollInterval(intervalMs: number, pollNow = false): void {
		const { pollTick } = this;
		if (!this.pollTimer || !pollTick) {
			return;
		}
		clearInterval(this.pollTimer);
		this.pollTimer = setInterval(() => void pollTick(), intervalMs);
		if (pollNow) {
			void pollTick();
		}
	}

	/** Push-triggered re-read; never throws. */
	public async refreshState(ac: ThinqConnectAirConditioner): Promise<void> {
		try {
			const state = await this.readState(ac);
			this.listener?.(ac.deviceId, state);
		} catch (error) {
			this.logger.warn(`ThinQ Connect: push refresh failed for ${ac.deviceId}: ${errorMessage(error)}`);
		}
	}

	public stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.pollTick = undefined;
		for (const timer of this.refreshTimers) {
			clearTimeout(timer);
		}
		this.refreshTimers.clear();
		this.listener = undefined;
	}

	private trackFaultState(ac: ThinqConnectAirConditioner, runState: string | undefined): void {
		if (runState === undefined) {
			return;
		}
		const previous = this.faultState.get(ac.deviceId);
		if (isAirConditionerFaultState(runState)) {
			if (previous !== runState) {
				this.faultState.set(ac.deviceId, runState);
				this.logger.warn(
					`ThinQ Connect: air conditioner "${ac.name}" (${ac.deviceId}) reports ${runState}. Check the unit or the LG ThinQ app.`,
				);
			}
			return;
		}
		if (previous !== undefined) {
			this.faultState.delete(ac.deviceId);
			this.logger.info(`ThinQ Connect: air conditioner "${ac.name}" (${ac.deviceId}) is back to ${runState}.`);
		}
	}

	private requirePoweredOn(state: ThinqConnectAirConditionerState): string | undefined {
		if (state.powerOn === undefined) {
			return 'Air conditioner state is unknown; refusing to send.';
		}
		return state.powerOn ? undefined : 'Air conditioner is off; refusing to change settings.';
	}

	private planPower(ac: ThinqConnectAirConditioner, state: ThinqConnectAirConditionerState, on: boolean): CommandPlan {
		const reason = evaluateAirConditionerEnumWrite(
			'operation.airConOperationMode',
			ac.profile.power,
			on ? 'POWER_ON' : 'POWER_OFF',
		);
		if (reason !== undefined) {
			return { kind: 'refuse', reason };
		}
		if (state.powerOn === undefined) {
			return { kind: 'refuse', reason: 'Air conditioner state is unknown; refusing to send.' };
		}
		if (state.powerOn === on) {
			return { kind: 'noop' };
		}
		return { kind: 'send', payload: buildAirConditionerPowerPayload(on), patch: { powerOn: on } };
	}

	/** Never throws; every path resolves to an outcome. Refused/failed outcomes carry the freshly read state. */
	private async runCommand(
		ac: ThinqConnectAirConditioner,
		label: string,
		plan: (state: ThinqConnectAirConditionerState) => CommandPlan,
	): Promise<ThinqConnectAirConditionerOutcome> {
		const { deviceId } = ac;

		if (this.inFlight.has(deviceId)) {
			const reason = 'Another command is already in progress for this air conditioner.';
			this.logger.warn(`ThinQ Connect: ${label} refused for ${deviceId}: ${reason}`);
			return { status: 'refused', reason, state: this.lastState.get(deviceId) ?? {} };
		}

		this.inFlight.add(deviceId);
		try {
			let state: ThinqConnectAirConditionerState;
			try {
				state = await this.readState(ac);
			} catch (error) {
				const message = errorMessage(error);
				this.logger.error(`ThinQ Connect: ${label} failed for ${deviceId} reading state: ${message}`);
				return { status: 'failed', error: message, state: this.lastState.get(deviceId) ?? {} };
			}

			const decision = plan(state);
			if (decision.kind === 'noop') {
				this.logger.info(`ThinQ Connect: ${label} for ${deviceId} skipped, already in requested state.`);
				return { status: 'noop', state };
			}
			if (decision.kind === 'refuse') {
				this.logger.warn(`ThinQ Connect: ${label} refused for ${deviceId}: ${decision.reason}`);
				return { status: 'refused', reason: decision.reason, state };
			}

			try {
				await this.client.controlDevice(deviceId, decision.payload);
			} catch (error) {
				const message = errorMessage(error);
				this.logger.error(`ThinQ Connect: ${label} failed for ${deviceId}: ${message}`);
				return { status: 'failed', error: message, state };
			}

			this.logger.info(`ThinQ Connect: ${label} sent for ${deviceId}.`);
			this.scheduleRefresh(ac);
			return { status: 'sent', state: { ...state, ...decision.patch } };
		} finally {
			this.inFlight.delete(deviceId);
		}
	}

	private scheduleRefresh(ac: ThinqConnectAirConditioner): void {
		const { listener } = this;
		if (!listener) {
			return;
		}
		const timer = setTimeout(() => {
			this.refreshTimers.delete(timer);
			this.readState(ac).then(
				(state) => listener(ac.deviceId, state),
				(error: unknown) =>
					this.logger.warn(`ThinQ Connect: post-command refresh failed for ${ac.deviceId}: ${errorMessage(error)}`),
			);
		}, THINQ_CONNECT_AC_POST_COMMAND_REFRESH_DELAY_MS);
		this.refreshTimers.add(timer);
	}
}
