import { beforeEach, describe, expect, it } from 'vitest';

import {
	WASHER_CYCLE_ABORT_STATES,
	WASHER_CYCLE_COMPLETED_STATES,
	WasherCycleTracker,
} from '../../../platform/thinq/thinqWasherCycleTracker.js';
import { WASHER_VT_RUNNING_STATES } from '../../../platform/thinq/thinqWasherVtCtrl.js';

interface FakeClock {
	now: () => number;
	advance: (ms: number) => void;
}

function createFakeClock(startMs = 1_000_000): FakeClock {
	let current = startMs;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

const IDLE_STATES = ['INITIAL', 'END', 'COMPLETE', 'POWEROFF', 'ERROR'];

describe('WasherCycleTracker', () => {
	let clock: FakeClock;
	let tracker: WasherCycleTracker;

	beforeEach(() => {
		clock = createFakeClock();
		tracker = new WasherCycleTracker(clock.now);
	});

	describe('completion firing', () => {
		it('should emit a completion with measured times when a running cycle ends with END', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(600_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 600, pausedTime: 0 });
		});

		it('should emit a completion when a running cycle ends with COMPLETE', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(600_000);

			// Act
			const completion = tracker.observe('d1', 'running', 'COMPLETE');

			// Assert
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 600, pausedTime: 0 });
		});

		it('should not emit again when END persists across further observations', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(60_000);
			tracker.observe('d1', 'stopped', 'END');

			// Act
			const results = [
				tracker.observe('d1', 'stopped', 'END'),
				tracker.observe('d1', 'stopped', 'END'),
				tracker.observe('d1', 'stopped', 'END'),
			];

			// Assert
			expect(results).toEqual([undefined, undefined, undefined]);
		});

		it('should round totalOperationalTime up when 1500 ms elapsed', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(1500);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion?.totalOperationalTime).toBe(2);
		});

		it('should round totalOperationalTime down when 1400 ms elapsed', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(1400);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion?.totalOperationalTime).toBe(1);
		});
	});

	describe('never-fire rules', () => {
		it('should not emit on the first observation when the washer never ran', () => {
			// Arrange
			const rawState = 'END';

			// Act
			const completion = tracker.observe('d1', 'stopped', rawState);

			// Assert
			expect(completion).toBeUndefined();
		});

		it('should not emit after a restart when END is seen again without a running cycle', () => {
			// Arrange
			tracker.observe('d1', 'stopped', 'END');

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toBeUndefined();
		});

		it('should not emit when the first observation is COMPLETE', () => {
			// Arrange
			const rawState = 'COMPLETE';

			// Act
			const completion = tracker.observe('d1', 'running', rawState);

			// Assert
			expect(completion).toBeUndefined();
		});

		it('should forget the cycle when powered off so a later END does not fire', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			tracker.observe('d1', 'stopped', 'POWEROFF');

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toBeUndefined();
		});

		it.each(['POWEROFF', 'POWERFAIL', 'INITIAL', 'ERROR'])(
			'should forget the cycle when the abort state %s is observed',
			(abortState) => {
				// Arrange
				tracker.observe('d1', 'running', 'RUNNING');
				tracker.observe('d1', 'stopped', abortState);

				// Act
				const completion = tracker.observe('d1', 'stopped', 'END');

				// Assert
				expect(completion).toBeUndefined();
			},
		);

		it('should not start a cycle when runStatus is error alone', () => {
			// Arrange
			tracker.observe('d1', 'error', undefined);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toBeUndefined();
		});
	});

	describe('pausedTime', () => {
		it('should report the pause excluded from totalOperationalTime when paused mid-cycle', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(100_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(60_000);
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(100_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 260, pausedTime: 60 });
		});

		it('should count an open pause segment when the cycle completes while paused', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(100_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(40_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 140, pausedTime: 40 });
		});

		it('should accumulate pausedTime across two separate pauses', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(10_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(30_000);
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(10_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(20_000);
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(10_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion?.pausedTime).toBe(50);
		});

		it('should not double-count repeated paused observations within one pause', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(10_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(10_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(10_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(10_000);
			tracker.observe('d1', 'paused', 'PAUSE');
			clock.advance(10_000);
			tracker.observe('d1', 'running', 'RUNNING');

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion?.pausedTime).toBe(50);
		});

		it('should report zero pausedTime when paused before any running observation', () => {
			// Arrange
			tracker.observe('d1', 'paused', 'PAUSE');
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(10_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion?.pausedTime).toBe(0);
		});
	});

	describe('cycle is not reset by unmapped or stopped mid-cycle states', () => {
		it('should still emit with full duration when COOLDOWN appears mid-cycle', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(100_000);
			tracker.observe('d1', 'stopped', 'COOLDOWN');
			clock.advance(50_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 150, pausedTime: 0 });
		});

		it('should still emit with full duration when an unknown stopped state appears mid-cycle', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(100_000);
			tracker.observe('d1', 'stopped', 'SOMETHING_NEW');
			clock.advance(50_000);

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 150, pausedTime: 0 });
		});

		it('should not reset or throw when rawState is undefined mid-cycle', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(100_000);

			// Act
			const midCycle = tracker.observe('d1', 'running', undefined);
			clock.advance(50_000);
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(midCycle).toBeUndefined();
			expect(completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 150, pausedTime: 0 });
		});
	});

	describe('per-device isolation and forget', () => {
		it('should keep d2 cycle intact and emit it independently when d1 completes first', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			clock.advance(60_000);
			tracker.observe('d2', 'running', 'RUNNING');
			clock.advance(60_000);
			const d1Completion = tracker.observe('d1', 'stopped', 'END');
			clock.advance(30_000);

			// Act
			const d2Completion = tracker.observe('d2', 'stopped', 'END');

			// Assert
			expect(d1Completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 120, pausedTime: 0 });
			expect(d2Completion).toEqual({ completionErrorCode: 0, totalOperationalTime: 90, pausedTime: 0 });
		});

		it('should not emit when forget was called after running', () => {
			// Arrange
			tracker.observe('d1', 'running', 'RUNNING');
			tracker.forget('d1');

			// Act
			const completion = tracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toBeUndefined();
		});

		it('should not throw when forget is called for an unknown device', () => {
			// Arrange
			const unknownId = 'never-seen';

			// Act
			const act = () => tracker.forget(unknownId);

			// Assert
			expect(act).not.toThrow();
		});
	});

	describe('constants and robustness', () => {
		it('should list END and COMPLETE as the completed states', () => {
			// Arrange
			const expected = ['END', 'COMPLETE'];

			// Act
			const completed = [...WASHER_CYCLE_COMPLETED_STATES];

			// Assert
			expect(completed).toEqual(expected);
		});

		it('should list POWEROFF, POWERFAIL, INITIAL and ERROR as the abort states', () => {
			// Arrange
			const expected = ['POWEROFF', 'POWERFAIL', 'INITIAL', 'ERROR'];

			// Act
			const aborts = [...WASHER_CYCLE_ABORT_STATES];

			// Assert
			expect(aborts).toEqual(expect.arrayContaining(expected));
		});

		it('should have no overlap between completed and abort states', () => {
			// Arrange
			const completed = [...WASHER_CYCLE_COMPLETED_STATES];

			// Act
			const overlap = completed.filter((state) => WASHER_CYCLE_ABORT_STATES.includes(state));

			// Assert
			expect(overlap).toEqual([]);
		});

		it.each([
			...WASHER_VT_RUNNING_STATES.map((state) => ['running', state] as const),
			...IDLE_STATES.map((state) => ['stopped', state] as const),
			['stopped', undefined] as const,
			['stopped', ''] as const,
			['stopped', 'constructor'] as const,
		])('should not throw when observing runStatus %s with rawState %s', (runStatus, rawState) => {
			// Arrange
			const status = runStatus;

			// Act
			const act = () => tracker.observe('d1', status, rawState);

			// Assert
			expect(act).not.toThrow();
		});

		it('should use Date.now as the default clock when no clock is injected', () => {
			// Arrange
			const defaultTracker = new WasherCycleTracker();
			defaultTracker.observe('d1', 'running', 'RUNNING');

			// Act
			const completion = defaultTracker.observe('d1', 'stopped', 'END');

			// Assert
			expect(completion).toBeDefined();
			expect(completion?.totalOperationalTime).toBeGreaterThanOrEqual(0);
		});
	});
});
