const KEY_USE_TIME = 'airState.filterMngStates.useTime';
const KEY_MAX_TIME = 'airState.filterMngStates.maxTime';
const KEY_CHANGE_DATE = 'airState.filterMngStates.changeDate';

/**
 * Parses the `filterMngStateCtrl` `Get` response, which comes back keyed with PLURAL
 * `airState.filterMngStates.*` fields (not the singular `airState.filterMngState.*` request keys — a
 * confirmed LG request/response key-casing mismatch, see `.claude/memory.md`).
 */
export class ThinqFilterState {
	private constructor(
		private readonly useTimeHours: number,
		private readonly maxTimeHours: number,
		private readonly changeDateRaw: number | undefined,
	) {}

	/**
	 * Returns `undefined` (not a zeroed object) when `useTime`/`maxTime` are missing or `maxTime<=0` —
	 * this is the mechanism that keeps AC units with no filter sensor from ever showing fake data.
	 */
	public static fromRaw(data: Record<string, unknown> | undefined): ThinqFilterState | undefined {
		const useTimeHours = readNumber(data, KEY_USE_TIME);
		const maxTimeHours = readNumber(data, KEY_MAX_TIME);

		if (useTimeHours === undefined || maxTimeHours === undefined || maxTimeHours <= 0) {
			return undefined;
		}

		return new ThinqFilterState(useTimeHours, maxTimeHours, readNumber(data, KEY_CHANGE_DATE));
	}

	public get remainingPercent(): number {
		const percent = ((this.maxTimeHours - this.useTimeHours) / this.maxTimeHours) * 100;
		return Math.max(0, Math.min(100, Math.round(percent)));
	}

	public get changeDate(): number | undefined {
		return this.changeDateRaw;
	}

	/** The device's rated total filter life in hours — echoed back unchanged in a reset `Set` payload. */
	public get ratedMaxTimeHours(): number {
		return this.maxTimeHours;
	}
}

function readNumber(data: Record<string, unknown> | undefined, key: string): number | undefined {
	const value = data?.[key];
	return typeof value === 'number' ? value : undefined;
}
