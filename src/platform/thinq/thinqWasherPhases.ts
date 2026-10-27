/** Fixed, stable Matter `OperationalState.phaseList` for the LG washer. Order = wash order. */
export const WASHER_PHASE_LIST: readonly string[] = [
	'Detecting',
	'Pre-Wash',
	'Washing',
	'Rinsing',
	'Softening',
	'Spinning',
	'Drying',
	'Cooling',
];

/**
 * Every LG `washerDryer.state` that means "a wash phase is in progress", folded into `WASHER_PHASE_LIST` indexes.
 * Covers all 26 `WASHER_VT_RUNNING_STATES`. Deliberately NOT derived from that list: the two serve different
 * purposes and must be free to diverge.
 */
const WASHER_PHASE_BY_STATE: ReadonlyMap<string, number> = new Map<string, number>([
	['DETECTING', 0],
	['CLOTHING_RECOGNITION', 0],
	['POLLUTION_DETECTING', 0],
	['CHECKING_TURBIDITY', 0],
	['DISPLAY_LOADSIZE', 0],
	['DETERGENT_AMOUNT', 0],
	['CONFIRM_START_FOR_CONTROL', 0],
	['PREWASH', 1],
	['SOAK', 1],
	['SOAKING', 1],
	['DETERGENT_INPUT', 1],
	['ADD_DRAIN', 1],
	['RUNNING', 2],
	['TUB_CLEANING', 2],
	['WASH_REFRESHING', 2],
	['REFRESHING', 2],
	['RINSING', 3],
	['RINSEHOLD', 3],
	['DISPENSING', 3],
	['SOFTENING', 4],
	['STEAMSOFTENING', 4],
	['SOFTENER_INPUT', 4],
	['SPINNING', 5],
	['DRYING', 6],
	['COOLING', 7],
	['COOLDOWN', 7],
]);

/**
 * Index into `WASHER_PHASE_LIST` for an LG `washerDryer.state`, or `undefined` for any state that is not a wash
 * phase (idle/paused/error) or is unknown to this table. Callers treat `undefined` as fail-safe `currentPhase = null`.
 */
export function resolveWasherPhaseIndex(rawState: string | undefined): number | undefined {
	return rawState === undefined ? undefined : WASHER_PHASE_BY_STATE.get(rawState);
}
