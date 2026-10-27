export type WasherRunStatus = 'running' | 'paused' | 'stopped' | 'error';

/** Payload for Matter `OperationalState.OperationCompletion`. `completionErrorCode` 0 = NoError. */
export interface WasherCycleCompletion {
	readonly completionErrorCode: number;
	readonly totalOperationalTime: number | null;
	readonly pausedTime: number | null;
}

/** LG raw states that mean "the cycle finished" — the only trigger for OperationCompletion. */
export const WASHER_CYCLE_COMPLETED_STATES: readonly string[] = ['END', 'COMPLETE'];

/** LG raw states that abandon a cycle without completing it (no event, tracker forgets the cycle). */
export const WASHER_CYCLE_ABORT_STATES: readonly string[] = ['POWEROFF', 'POWERFAIL', 'INITIAL', 'ERROR'];

interface WasherCycleEntry {
	sawRunning: boolean;
	startedAtMs?: number;
	pausedSinceMs?: number;
	pausedAccumulatedMs: number;
}

const MS_PER_SECOND = 1000;

/**
 * Per-device wash cycle tracker. Emits a completion once per observed cycle, never on startup or after a restart
 * (a cycle must be seen running by this instance first). Framework-free; the clock is injected for tests.
 */
export class WasherCycleTracker {
	private readonly cycles = new Map<string, WasherCycleEntry>();

	constructor(private readonly now: () => number = Date.now) {}

	/**
	 * Feeds one observation. Returns a completion payload exactly once, on the first observation whose `rawState` is
	 * a completed state AND whose cycle was seen running by this tracker; `undefined` otherwise.
	 */
	public observe(
		deviceId: string,
		runStatus: WasherRunStatus,
		rawState: string | undefined,
	): WasherCycleCompletion | undefined {
		const now = this.now();
		const cycle = this.cycles.get(deviceId);

		if (rawState !== undefined && WASHER_CYCLE_COMPLETED_STATES.includes(rawState)) {
			if (cycle?.sawRunning !== true || cycle.startedAtMs === undefined) {
				this.cycles.delete(deviceId);
				return undefined;
			}
			if (cycle.pausedSinceMs !== undefined) {
				cycle.pausedAccumulatedMs += now - cycle.pausedSinceMs;
			}
			const completion: WasherCycleCompletion = {
				completionErrorCode: 0,
				totalOperationalTime: Math.round((now - cycle.startedAtMs) / MS_PER_SECOND),
				pausedTime: Math.round(cycle.pausedAccumulatedMs / MS_PER_SECOND),
			};
			this.cycles.delete(deviceId);
			return completion;
		}

		if (rawState !== undefined && WASHER_CYCLE_ABORT_STATES.includes(rawState)) {
			this.cycles.delete(deviceId);
			return undefined;
		}

		if (runStatus === 'running') {
			if (cycle?.sawRunning !== true) {
				this.cycles.set(deviceId, { sawRunning: true, startedAtMs: now, pausedAccumulatedMs: 0 });
				return undefined;
			}
			if (cycle.pausedSinceMs !== undefined) {
				cycle.pausedAccumulatedMs += now - cycle.pausedSinceMs;
				cycle.pausedSinceMs = undefined;
			}
			return undefined;
		}

		if (runStatus === 'paused' && cycle?.sawRunning === true && cycle.pausedSinceMs === undefined) {
			cycle.pausedSinceMs = now;
		}
		return undefined;
	}

	/** Drops a device's tracked cycle (e.g. on unregister). */
	public forget(deviceId: string): void {
		this.cycles.delete(deviceId);
	}
}
