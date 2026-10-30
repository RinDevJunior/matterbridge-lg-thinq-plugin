import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { LaundryWasherControls, LaundryWasherMode, TemperatureControl } from 'matterbridge/matter/clusters';

import type { ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';
import { maskSecret } from '../../utils/mask.js';
import { isRecord } from './thinqWasherFields.js';
import {
	matterRinseToEnum,
	modeToCourseId,
	spinIndexToEnum,
	tempIndexToEnum,
	type WasherMatterPlan,
} from './thinqWasherMatterPlan.js';
import type { WasherVtChange, WasherVtController, WasherVtOutcome } from './thinqWasherVtController.js';

export type WasherVtChangeRunner = Pick<WasherVtController, 'applyChanges'>;

/** One combined send per burst; the window starts at the FIRST change, it is never re-armed. */
export const WASHER_SELECTION_DEBOUNCE_MS = 1_200;

const MSG_BAD_REQUEST = 'Home sent a wash setting the plugin could not read. Try again.';
const MSG_UNKNOWN_MODE = 'That wash course is not on this washer.';
const MSG_OUT_OF_RANGE = 'That setting is not available for the selected wash course.';
const MSG_NO_TEMP_FOR_COURSE = 'The selected wash course has no temperature setting.';
const MSG_NO_SPIN_FOR_COURSE = 'The selected wash course has no spin setting.';
const MSG_NO_RINSE_FOR_COURSE = 'The selected wash course has no rinse setting.';
const MSG_RINSE_NOT_ALLOWED = 'The selected wash course does not allow that number of rinses.';

interface PendingSelection {
	/** Keyed 'course' | 'option:<key>' — the last write per key wins. */
	readonly changes: Map<string, WasherVtChange>;
	/** Best-effort attribute reverts, run only when the batch does not succeed. */
	readonly reverts: (() => void)[];
	readonly waiters: ((outcome: WasherVtOutcome) => void)[];
	timer: NodeJS.Timeout | undefined;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const keyOf = (change: WasherVtChange): string => (change.kind === 'course' ? 'course' : `option:${change.key}`);

/** Fail closed: `undefined` unless the payload is `{ request: { [key]: number } }`. */
function readRequestNumber(data: unknown, key: string): number | undefined {
	if (!isRecord(data) || !isRecord(data.request)) {
		return undefined;
	}
	const value = data.request[key];
	return typeof value === 'number' ? value : undefined;
}

export function registerWasherVtSelectionHandlers(
	washer: MatterbridgeEndpoint,
	device: ThinqWasherDevice,
	runner: WasherVtChangeRunner,
	plan: WasherMatterPlan,
	logger: AnsiLogger,
): void {
	const prefix = `ThinQ Washer ${maskSecret(device.id, 4)}`;
	let pending: PendingSelection | undefined;

	const flush = async (): Promise<void> => {
		const batch = pending;
		pending = undefined;
		if (batch === undefined) {
			return;
		}
		clearTimeout(batch.timer);

		let outcome: WasherVtOutcome;
		try {
			outcome = await runner.applyChanges([...batch.changes.values()]);
		} catch (error) {
			outcome = { status: 'failed', message: errorText(error) };
		}

		if (outcome.status === 'done' || outcome.status === 'noop') {
			logger.info(`${prefix}: selection ${outcome.status}: ${outcome.message}`);
		} else {
			logger.warn(`${prefix}: selection refused (${outcome.status}): ${outcome.message}`);
			for (const revert of batch.reverts) {
				revert();
			}
		}
		for (const resolve of batch.waiters) {
			resolve(outcome);
		}
	};

	const enqueue = (change: WasherVtChange, revert?: () => void): Promise<WasherVtOutcome> => {
		pending ??= { changes: new Map(), reverts: [], waiters: [], timer: undefined };
		const batch = pending;
		batch.changes.set(keyOf(change), change);
		if (revert !== undefined) {
			batch.reverts.push(revert);
		}
		const outcome = new Promise<WasherVtOutcome>((resolve) => {
			batch.waiters.push(resolve);
		});
		batch.timer ??= setTimeout(() => {
			void flush();
		}, WASHER_SELECTION_DEBOUNCE_MS);
		return outcome;
	};

	const flushNow = (change: WasherVtChange): Promise<WasherVtOutcome> => {
		const outcome = enqueue(change);
		void flush();
		return outcome;
	};

	const currentCourseId = (): string =>
		modeToCourseId(plan, washer.getAttribute(LaundryWasherMode.id, 'currentMode') as number) ?? plan.normalCourseId;

	const requireSuccess = (outcome: WasherVtOutcome): void => {
		if (outcome.status !== 'done' && outcome.status !== 'noop') {
			throw new Error(outcome.message);
		}
	};

	const revertSpin = (value: number | null): void => {
		washer.updateAttribute(LaundryWasherControls.id, 'spinSpeedCurrent', value, washer.log).catch(() => undefined);
	};
	const revertRinses = (value: LaundryWasherControls.NumberOfRinses): void => {
		washer.updateAttribute(LaundryWasherControls.id, 'numberOfRinses', value, washer.log).catch(() => undefined);
	};

	washer.addCommandHandler('changeToMode', async (data: unknown) => {
		const newMode = readRequestNumber(data, 'newMode');
		if (newMode === undefined) {
			throw new Error(MSG_BAD_REQUEST);
		}
		const courseId = modeToCourseId(plan, newMode);
		if (courseId === undefined) {
			throw new Error(MSG_UNKNOWN_MODE);
		}
		requireSuccess(await flushNow({ kind: 'course', courseId }));
	});

	washer.addCommandHandler('setTemperature', async (data: unknown) => {
		const index = readRequestNumber(data, 'targetTemperatureLevel');
		if (index === undefined) {
			throw new Error(MSG_BAD_REQUEST);
		}
		const list = plan.optionsOf(currentCourseId())?.temp;
		if (list === undefined) {
			throw new Error(MSG_NO_TEMP_FOR_COURSE);
		}
		const labels = washer.getAttribute(TemperatureControl.id, 'supportedTemperatureLevels') as string[] | undefined;
		if (labels !== undefined && index >= labels.length) {
			throw new Error(MSG_OUT_OF_RANGE);
		}
		const value = tempIndexToEnum(list, index);
		if (value === undefined) {
			throw new Error(MSG_OUT_OF_RANGE);
		}
		requireSuccess(await flushNow({ kind: 'option', key: 'temp', value }));
	});

	washer.subscribeAttribute(
		LaundryWasherControls.id,
		'spinSpeedCurrent',
		(newValue: number | null, oldValue: number | null, context) => {
			if (context.fabric === undefined || typeof newValue !== 'number') {
				return;
			}
			const list = plan.optionsOf(currentCourseId())?.spin;
			const value = list === undefined ? undefined : spinIndexToEnum(list, newValue);
			if (value === undefined) {
				logger.warn(`${prefix}: spin write refused: ${list === undefined ? MSG_NO_SPIN_FOR_COURSE : MSG_OUT_OF_RANGE}`);
				revertSpin(oldValue);
				return;
			}
			void enqueue({ kind: 'option', key: 'spin', value }, () => revertSpin(oldValue));
		},
		washer.log,
	);

	washer.subscribeAttribute(
		LaundryWasherControls.id,
		'numberOfRinses',
		(newValue: LaundryWasherControls.NumberOfRinses, oldValue: LaundryWasherControls.NumberOfRinses, context) => {
			if (context.fabric === undefined || typeof newValue !== 'number') {
				return;
			}
			const list = plan.optionsOf(currentCourseId())?.rinse;
			const value = list === undefined ? undefined : matterRinseToEnum(list, newValue);
			if (value === undefined) {
				logger.warn(
					`${prefix}: rinse write refused: ${list === undefined ? MSG_NO_RINSE_FOR_COURSE : MSG_RINSE_NOT_ALLOWED}`,
				);
				revertRinses(oldValue);
				return;
			}
			void enqueue({ kind: 'option', key: 'rinse', value }, () => revertRinses(oldValue));
		},
		washer.log,
	);
}
