/**
 * ThinQ `washerDryer.state` values that do NOT count as "actively running" (ported verbatim from
 * `homebridge-lg-thinq/src/devices/WasherDryer.ts:14-15`).
 */
const WASHER_NOT_RUNNING_STATES = [
	'COOLDOWN',
	'POWEROFF',
	'POWERFAIL',
	'INITIAL',
	'PAUSE',
	'AUDIBLE_DIAGNOSIS',
	'FIRMWARE',
	'COURSE_DOWNLOAD',
	'ERROR',
	'END',
];

/**
 * Typed accessor over a ThinQ device's raw flat-key snapshot bag (e.g. `airState.opMode`).
 * Phase 1 only exposes the AirConditioner fields used by `ThinqDeviceConfigurator`.
 */
export class ThinqSnapshot {
	constructor(private readonly data: Record<string, unknown>) {}

	public get raw(): Record<string, unknown> {
		return this.data;
	}

	public has(key: string): boolean {
		const value = this.data[key];
		return value !== undefined && value !== null;
	}

	public get isPowerOn(): boolean {
		return Number(this.data['airState.operation']) === 1;
	}

	public get currentTemperatureCelsius(): number | undefined {
		return this.readNumber('airState.tempState.current');
	}

	public get targetTemperatureCelsius(): number | undefined {
		return this.readNumber('airState.tempState.target');
	}

	public get operationMode(): number | undefined {
		return this.readNumber('airState.opMode');
	}

	public get windStrength(): number | undefined {
		return this.readNumber('airState.windStrength');
	}

	public get online(): boolean | undefined {
		return typeof this.data.online === 'boolean' ? this.data.online : undefined;
	}

	public get isJetModeOn(): boolean {
		return Number(this.data['airState.wMode.jet']) === 1;
	}

	public get isQuietModeOn(): boolean {
		return Number(this.data['airState.miscFuncState.silentAWHP']) === 1;
	}

	public get isEnergySaveModeOn(): boolean {
		return Number(this.data['airState.powerSave.basic']) === 1;
	}

	public get isAirCleanModeOn(): boolean {
		return Number(this.data['airState.wMode.airClean']) === 1;
	}

	public get isLedOn(): boolean {
		return Number(this.data['airState.lightingState.displayControl']) === 1;
	}

	public get isVerticalSwingOn(): boolean {
		return Number(this.data['airState.wDir.vStep']) === 100;
	}

	public get isHorizontalSwingOn(): boolean {
		return Number(this.data['airState.wDir.hStep']) === 100;
	}

	public get humidityPercent(): number | undefined {
		const value = this.readNumber('airState.humidity.current');
		if (value === undefined) {
			return undefined;
		}
		return value > 100 ? value / 10 : value;
	}

	public get airQualityOverall(): number | undefined {
		return this.readNumber('airState.quality.overall');
	}

	public get pm25(): number | undefined {
		return this.readNumber('airState.quality.PM2');
	}

	public get pm10(): number | undefined {
		return this.readNumber('airState.quality.PM10');
	}

	public get powerConsumptionWatts(): number | undefined {
		const value = this.readNumber('airState.energy.onCurrent');
		return value === undefined || Number.isNaN(value) ? undefined : value;
	}

	private get washerDryer(): Record<string, unknown> | undefined {
		const value = this.data['washerDryer'];
		return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
	}

	public get hasWasherDryer(): boolean {
		return this.washerDryer !== undefined;
	}

	public get washerRawState(): string | undefined {
		const value = this.washerDryer?.['state'];
		return typeof value === 'string' ? value : undefined;
	}

	public get isWasherPowerOn(): boolean {
		return this.washerRawState !== undefined && !['POWEROFF', 'POWERFAIL'].includes(this.washerRawState);
	}

	public get isWasherRunning(): boolean {
		return (
			this.isWasherPowerOn &&
			this.washerRawState !== undefined &&
			!WASHER_NOT_RUNNING_STATES.includes(this.washerRawState)
		);
	}

	public get isWasherError(): boolean {
		return this.washerRawState === 'ERROR';
	}

	public get washerRemainingDurationSeconds(): number | undefined {
		const hours = this.readWasherNumber('remainTimeHour');
		const minutes = this.readWasherNumber('remainTimeMinute');
		if (hours === undefined && minutes === undefined) {
			return undefined;
		}
		if (!this.isWasherRunning) {
			return 0;
		}
		return (hours ?? 0) * 3600 + (minutes ?? 0) * 60;
	}

	private readNumber(key: string): number | undefined {
		const value = this.data[key];
		return typeof value === 'number' ? value : undefined;
	}

	private readWasherNumber(key: string): number | undefined {
		const value = this.washerDryer?.[key];
		return typeof value === 'number' ? value : undefined;
	}
}
