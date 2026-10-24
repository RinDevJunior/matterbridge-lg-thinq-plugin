import { describe, expect, it } from 'vitest';

import { resolveWasherPhaseIndex, WASHER_PHASE_LIST } from '../../../platform/thinq/thinqWasherPhases.js';
import { WASHER_VT_RUNNING_STATES } from '../../../platform/thinq/thinqWasherVtCtrl.js';

describe('thinqWasherPhases', () => {
	describe('WASHER_PHASE_LIST', () => {
		it('should contain exactly the 8 fixed phases in wash order', () => {
			// Arrange
			const expected = ['Detecting', 'Pre-Wash', 'Washing', 'Rinsing', 'Softening', 'Spinning', 'Drying', 'Cooling'];

			// Act
			const list = [...WASHER_PHASE_LIST];

			// Assert
			expect(list).toEqual(expected);
		});

		it('should keep every entry a non-empty string of at most 64 characters', () => {
			// Arrange
			const entries = [...WASHER_PHASE_LIST];

			// Act
			const invalid = entries.filter((entry) => entry.length === 0 || entry.length > 64);

			// Assert
			expect(invalid).toEqual([]);
		});

		it('should contain at most 32 entries to respect the Matter PhaseList maxCount', () => {
			// Arrange
			const list = WASHER_PHASE_LIST;

			// Act
			const count = list.length;

			// Assert
			expect(count).toBeLessThanOrEqual(32);
		});
	});

	describe('resolveWasherPhaseIndex', () => {
		it('should map every known running state to a phase, so the table stays exhaustive', () => {
			// Arrange
			const runningStates = [...WASHER_VT_RUNNING_STATES];

			// Act
			const unmapped = runningStates.filter((state) => resolveWasherPhaseIndex(state) === undefined);

			// Assert
			expect(unmapped).toEqual([]);
		});

		it('should return an index inside WASHER_PHASE_LIST for every running state', () => {
			// Arrange
			const runningStates = [...WASHER_VT_RUNNING_STATES];

			// Act
			const outOfRange = runningStates
				.map((state) => ({ state, index: resolveWasherPhaseIndex(state) }))
				.filter(({ index }) => index === undefined || index < 0 || index >= WASHER_PHASE_LIST.length);

			// Assert
			expect(outOfRange).toEqual([]);
		});

		it.each([
			['DETECTING', 0],
			['PREWASH', 1],
			['RUNNING', 2],
			['RINSING', 3],
			['SOFTENING', 4],
			['SPINNING', 5],
			['DRYING', 6],
			['COOLING', 7],
		])('should map representative state %s to phase index %i', (state, expectedIndex) => {
			// Arrange
			const rawState = state;

			// Act
			const index = resolveWasherPhaseIndex(rawState);

			// Assert
			expect(index).toBe(expectedIndex);
		});

		it.each([
			['CONFIRM_START_FOR_CONTROL', 0],
			['ADD_DRAIN', 1],
			['TUB_CLEANING', 2],
			['DISPENSING', 3],
			['STEAMSOFTENING', 4],
			['COOLDOWN', 7],
		])('should fold non-obvious state %s into phase index %i', (state, expectedIndex) => {
			// Arrange
			const rawState = state;

			// Act
			const index = resolveWasherPhaseIndex(rawState);

			// Assert
			expect(index).toBe(expectedIndex);
		});

		it.each(['END', 'COMPLETE', 'POWEROFF', 'INITIAL', 'ERROR', 'PAUSE'])(
			'should return undefined when the state %s is not a wash phase',
			(state) => {
				// Arrange
				const rawState = state;

				// Act
				const index = resolveWasherPhaseIndex(rawState);

				// Assert
				expect(index).toBeUndefined();
			},
		);

		it('should return undefined when the state is unknown to the table', () => {
			// Arrange
			const rawState = 'SOMETHING_LG_ADDED_LATER';

			// Act
			const index = resolveWasherPhaseIndex(rawState);

			// Assert
			expect(index).toBeUndefined();
		});

		it('should return undefined when the raw state is undefined', () => {
			// Arrange
			const rawState: string | undefined = undefined;

			// Act
			const index = resolveWasherPhaseIndex(rawState);

			// Assert
			expect(index).toBeUndefined();
		});

		it('should return undefined when the raw state is an empty string', () => {
			// Arrange
			const rawState = '';

			// Act
			const index = resolveWasherPhaseIndex(rawState);

			// Assert
			expect(index).toBeUndefined();
		});

		it.each(['constructor', 'toString'])(
			'should return undefined when the raw state is the Object.prototype member %s',
			(state) => {
				// Arrange
				const rawState = state;

				// Act
				const index = resolveWasherPhaseIndex(rawState);

				// Assert
				expect(index).toBeUndefined();
			},
		);
	});
});
