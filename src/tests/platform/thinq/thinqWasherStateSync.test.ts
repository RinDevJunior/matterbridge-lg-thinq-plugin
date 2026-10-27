import {
	LaundryWasherControls,
	LaundryWasherMode,
	OnOff,
	OperationalState,
	TemperatureControl,
} from 'matterbridge/matter/clusters';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import { type WasherCycleCompletion, WasherCycleTracker } from '../../../platform/thinq/thinqWasherCycleTracker.js';
import { resolveWasherMatterPlan, type WasherMatterPlan } from '../../../platform/thinq/thinqWasherMatterPlan.js';
import { WASHER_PHASE_LIST } from '../../../platform/thinq/thinqWasherPhases.js';
import {
	applyThinqSnapshotToWasher,
	mapWasherStateToOperationalState,
	resolveWasherRunStatus,
} from '../../../platform/thinq/thinqWasherStateSync.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';
import { createFakeWasherModel } from '../../helpers/washerFixtures.js';

function createMockWasherEndpoint(): any {
	return asPartial<any>({
		serialNumber: 'washer-123',
		uniqueId: undefined,
		log: createMockLogger(),
		updateAttribute: vi.fn().mockResolvedValue(false),
		getAttribute: vi.fn().mockReturnValue(OperationalState.OperationalStateEnum.Stopped),
		triggerEvent: vi.fn().mockResolvedValue(true),
	});
}

function createTrackerStub(result?: WasherCycleCompletion): WasherCycleTracker {
	return asPartial<WasherCycleTracker>({
		observe: vi.fn().mockReturnValue(result),
		forget: vi.fn(),
	});
}

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

function findUpdateCall(updateAttribute: Mock, attribute: string): unknown[] | undefined {
	return updateAttribute.mock.calls.find((call: unknown[]) => call[1] === attribute);
}

const DISPLAY_CLUSTER_IDS: readonly unknown[] = [LaundryWasherMode.id, LaundryWasherControls.id, TemperatureControl.id];

function displayPlan(): WasherMatterPlan {
	const plan = resolveWasherMatterPlan(createFakeWasherModel());
	if (plan === undefined) {
		throw new Error('fixture model must produce a plan');
	}
	return plan;
}

describe('applyThinqSnapshotToWasher display argument (slice 1)', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockWasher: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockWasher = createMockWasherEndpoint();
	});

	it('should write exactly the W2 attributes in order when the 5th argument is omitted', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING', course: 'NORMAL', temp: 'TEMP_40' } });

		// Act
		await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

		// Assert
		const attributes = vi.mocked(mockWasher.updateAttribute).mock.calls.map((call: unknown[]) => call[1]);
		expect(attributes).toEqual(['onOff', 'operationalState', 'operationalError', 'phaseList', 'currentPhase']);
	});

	it('should not write any LaundryWasherMode, LaundryWasherControls or TemperatureControl attribute without display', async () => {
		// Arrange
		const running = new ThinqSnapshot({ washerDryer: { state: 'RUNNING', course: 'NORMAL' } });
		const ended = new ThinqSnapshot({ washerDryer: { state: 'END', course: 'NORMAL' } });

		// Act
		await applyThinqSnapshotToWasher(mockWasher, running, mockLogger);
		await applyThinqSnapshotToWasher(mockWasher, ended, mockLogger);

		// Assert
		const clusterIds = vi.mocked(mockWasher.updateAttribute).mock.calls.map((call: unknown[]) => call[0]);
		expect(clusterIds.filter((id: unknown) => DISPLAY_CLUSTER_IDS.includes(id))).toEqual([]);
	});

	it('should write the mode, controls and temperature attributes after phaseList and currentPhase when display is supplied', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({
			washerDryer: { state: 'RUNNING', course: 'NORMAL', temp: 'TEMP_40', spin: 'SPIN_1400', rinse: 'RINSE_2' },
		});

		// Act
		await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, undefined, { plan: displayPlan() });

		// Assert
		const calls = vi.mocked(mockWasher.updateAttribute).mock.calls;
		const currentPhaseIndex = calls.findIndex((call: unknown[]) => call[1] === 'currentPhase');
		const firstDisplayIndex = calls.findIndex((call: unknown[]) => DISPLAY_CLUSTER_IDS.includes(call[0]));
		expect(currentPhaseIndex).toBeGreaterThanOrEqual(0);
		expect(firstDisplayIndex).toBeGreaterThan(currentPhaseIndex);
		expect(calls.some((call: unknown[]) => call[0] === LaundryWasherMode.id && call[1] === 'currentMode')).toBe(true);
	});

	it('should still emit operationCompletion exactly once across END polls when display is supplied', async () => {
		// Arrange
		const clock = createFakeClock();
		const tracker = new WasherCycleTracker(clock.now);
		const running = new ThinqSnapshot({ washerDryer: { state: 'RUNNING', course: 'NORMAL' } });
		const ended = new ThinqSnapshot({ washerDryer: { state: 'END', course: 'NORMAL' } });
		const display = { plan: displayPlan() };

		// Act
		await applyThinqSnapshotToWasher(mockWasher, running, mockLogger, tracker, display);
		clock.advance(600_000);
		await applyThinqSnapshotToWasher(mockWasher, ended, mockLogger, tracker, display);
		await applyThinqSnapshotToWasher(mockWasher, ended, mockLogger, tracker, display);

		// Assert
		const completionCalls = vi
			.mocked(mockWasher.triggerEvent)
			.mock.calls.filter((call: unknown[]) => call[1] === 'operationCompletion');
		expect(completionCalls).toHaveLength(1);
	});

	it('should skip all display writes when washerDryer.state is absent', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({ washerDryer: { course: 'NORMAL' } });

		// Act
		await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, undefined, { plan: displayPlan() });

		// Assert
		expect(mockWasher.updateAttribute).not.toHaveBeenCalled();
	});

	it('should keep the W2 writes that already happened and propagate a rejected display write', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING', course: 'NORMAL' } });
		mockWasher.updateAttribute.mockImplementation((_clusterId: unknown, attribute: string) =>
			attribute === 'currentMode' ? Promise.reject(new Error('mode write failed')) : Promise.resolve(false),
		);

		// Act
		const act = applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, undefined, { plan: displayPlan() });

		// Assert
		await expect(act).rejects.toThrow('mode write failed');
		const attributes = vi.mocked(mockWasher.updateAttribute).mock.calls.map((call: unknown[]) => call[1]);
		expect(attributes).toEqual(expect.arrayContaining(['onOff', 'operationalState', 'phaseList', 'currentPhase']));
	});
});

describe('thinqWasherStateSync', () => {
	describe('mapWasherStateToOperationalState', () => {
		it('should return Error when isWasherError is true', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'ERROR' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Error);
		});

		it('should return Running when isWasherRunning is true', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Running);
		});

		it('should return Paused when washerRawState is PAUSE', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'PAUSE' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Paused);
		});

		it('should return Stopped when powered off (POWEROFF)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWEROFF' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Stopped);
		});

		it('should return Stopped for END state', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'END' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Stopped);
		});

		it('should return Running for unknown state (not in NOT_RUNNING_STATES)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'UNKNOWN_STATE' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			// Unknown states not in WASHER_NOT_RUNNING_STATES are treated as running
			expect(result).toBe(OperationalState.OperationalStateEnum.Running);
		});

		it('should return Stopped when washerDryer.state is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Stopped);
		});

		it('should prioritize error over running state', () => {
			// Arrange (ERROR state takes priority over running logic)
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'ERROR' },
			});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Error);
		});
	});

	describe('applyThinqSnapshotToWasher', () => {
		let mockLogger: ReturnType<typeof createMockLogger>;
		let mockWasher: any;

		beforeEach(() => {
			vi.clearAllMocks();
			mockLogger = createMockLogger();
			mockWasher = createMockWasherEndpoint();
		});

		it('should skip update when washerDryer.state is absent', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { remainTimeHour: 1 },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('skipped (source key absent): washerDryer.state'),
			);
		});

		it('should update onOff, operationalState, and operationalError when state is present and running', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running,
				mockLogger,
			);
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalError',
				{ errorStateId: OperationalState.ErrorState.NoError },
				mockLogger,
			);
		});

		it('should set onOff to false when powered off (POWEROFF)', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWEROFF' },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, mockLogger);
		});

		it('should set operationalState to Stopped when powered off', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWEROFF' },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Stopped,
				mockLogger,
			);
		});

		it('should set operationalError to UnableToCompleteOperation when ERROR state', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'ERROR' },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalError',
				{ errorStateId: OperationalState.ErrorState.UnableToCompleteOperation },
				mockLogger,
			);
		});

		it('should update countdownTime when both remainTimeHour and remainTimeMinute are present', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 1, remainTimeMinute: 30 },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const calls = vi.mocked(mockWasher.updateAttribute).mock.calls;
			const countdownCall = calls.find((call: any[]) => call[0] === OperationalState.id && call[1] === 'countdownTime');
			expect(countdownCall).toBeDefined();
			expect(countdownCall?.at(2)).toBe(5400); // 1 hour (3600s) + 30 minutes (1800s)
		});

		it('should update countdownTime when only remainTimeHour is present', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 2 },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const calls = vi.mocked(mockWasher.updateAttribute).mock.calls;
			const countdownCall = calls.find((call: any[]) => call[0] === OperationalState.id && call[1] === 'countdownTime');
			expect(countdownCall).toBeDefined();
			expect(countdownCall?.at(2)).toBe(7200); // 2 hours
		});

		it('should update countdownTime when only remainTimeMinute is present', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeMinute: 45 },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const calls = vi.mocked(mockWasher.updateAttribute).mock.calls;
			const countdownCall = calls.find((call: any[]) => call[0] === OperationalState.id && call[1] === 'countdownTime');
			expect(countdownCall).toBeDefined();
			expect(countdownCall?.at(2)).toBe(2700); // 45 minutes
		});

		it('should NOT update countdownTime when remain time keys are absent', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const calls = vi.mocked(mockWasher.updateAttribute).mock.calls;
			const countdownCall = calls.find((call: any[]) => call[0] === OperationalState.id && call[1] === 'countdownTime');
			expect(countdownCall).toBeUndefined();
		});

		it('should set countdownTime to 0 when washer not running but remain time keys present', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'END', remainTimeHour: 1 },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const calls = vi.mocked(mockWasher.updateAttribute).mock.calls;
			const countdownCall = calls.find((call: any[]) => call[0] === OperationalState.id && call[1] === 'countdownTime');
			expect(countdownCall).toBeDefined();
			expect(countdownCall?.at(2)).toBe(0); // Zeroed when not running
		});

		it('should update attribute when updateAttribute succeeds', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});
			mockWasher.updateAttribute.mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalled();
		});

		it('should use serialNumber when available for logging', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});
			mockWasher.serialNumber = 'serial-123';

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const debugCalls = vi.mocked(mockLogger.debug).mock.calls;
			const entryLog = debugCalls.find((call: any[]) => call[0]?.includes('entry for deviceId'));
			expect(entryLog).toBeDefined();
			expect(entryLog?.at(0)).toContain('serial-123');
		});

		it('should fall back to uniqueId when serialNumber is not available', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});
			mockWasher.serialNumber = undefined;
			mockWasher.uniqueId = 'unique-456';

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const debugCalls = vi.mocked(mockLogger.debug).mock.calls;
			const entryLog = debugCalls.find((call: any[]) => call[0]?.includes('entry for deviceId'));
			expect(entryLog).toBeDefined();
			expect(entryLog?.at(0)).toContain('unique-456');
		});

		it('should use "unknown" when neither serialNumber nor uniqueId available', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});
			mockWasher.serialNumber = undefined;
			mockWasher.uniqueId = undefined;

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const debugCalls = vi.mocked(mockLogger.debug).mock.calls;
			const entryLog = debugCalls.find((call: any[]) => call[0]?.includes('entry for deviceId'));
			expect(entryLog).toBeDefined();
			expect(entryLog?.at(0)).toContain('unknown');
		});

		it('should not look up any child endpoint while still updating onOff, operationalState and operationalError', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.getChildEndpointById).toBeUndefined();
			const attributeNames = vi.mocked(mockWasher.updateAttribute).mock.calls.map((call: any[]) => call[1]);
			expect(attributeNames).toEqual(expect.arrayContaining(['onOff', 'operationalState', 'operationalError']));
		});
	});

	describe('resolveWasherRunStatus', () => {
		it.each([
			['ERROR', 'error'],
			['RUNNING', 'running'],
			['PAUSE', 'paused'],
			['POWEROFF', 'stopped'],
			['END', 'stopped'],
			['UNKNOWN_STATE', 'running'],
		])('should resolve washerDryer.state %s to run status %s', (state, expected) => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state } });

			// Act
			const status = resolveWasherRunStatus(snapshot);

			// Assert
			expect(status).toBe(expected);
		});

		it('should resolve to stopped when washerDryer.state is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act
			const status = resolveWasherRunStatus(snapshot);

			// Assert
			expect(status).toBe('stopped');
		});

		it('should resolve ERROR to error rather than running', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'ERROR' } });

			// Act
			const status = resolveWasherRunStatus(snapshot);

			// Assert
			expect(status).toBe('error');
		});
	});

	describe('mapWasherStateToOperationalState regression table', () => {
		it.each([
			['ERROR', OperationalState.OperationalStateEnum.Error],
			['RUNNING', OperationalState.OperationalStateEnum.Running],
			['PAUSE', OperationalState.OperationalStateEnum.Paused],
			['POWEROFF', OperationalState.OperationalStateEnum.Stopped],
			['END', OperationalState.OperationalStateEnum.Stopped],
			['UNKNOWN_STATE', OperationalState.OperationalStateEnum.Running],
		])('should map washerDryer.state %s to the same Matter state as before the refactor', (state, expected) => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state } });

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(expected);
		});

		it('should map an absent washerDryer.state to Stopped', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act
			const result = mapWasherStateToOperationalState(snapshot);

			// Assert
			expect(result).toBe(OperationalState.OperationalStateEnum.Stopped);
		});
	});

	describe('applyThinqSnapshotToWasher phaseList and currentPhase', () => {
		let mockLogger: ReturnType<typeof createMockLogger>;
		let mockWasher: any;

		beforeEach(() => {
			vi.clearAllMocks();
			mockLogger = createMockLogger();
			mockWasher = createMockWasherEndpoint();
		});

		it('should write the fixed phaseList when the washer is running', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'phaseList',
				[...WASHER_PHASE_LIST],
				mockLogger,
			);
		});

		it('should write the fixed phaseList when the washer is powered off', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'POWEROFF' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'phaseList',
				[...WASHER_PHASE_LIST],
				mockLogger,
			);
		});

		it('should pass a phaseList array that is a copy, not the exported constant reference', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const value = findUpdateCall(mockWasher.updateAttribute, 'phaseList')?.at(2);
			expect(value).toEqual(WASHER_PHASE_LIST);
			expect(value).not.toBe(WASHER_PHASE_LIST);
		});

		it('should not write phaseList when washerDryer.state is absent', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(findUpdateCall(mockWasher.updateAttribute, 'phaseList')).toBeUndefined();
		});

		it.each([
			['RUNNING', 2],
			['RINSING', 3],
			['SPINNING', 5],
		])('should write currentPhase for running state %s as index %i', async (state, expectedIndex) => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(findUpdateCall(mockWasher.updateAttribute, 'currentPhase')?.at(2)).toBe(expectedIndex);
		});

		it.each(['PAUSE', 'POWEROFF', 'END', 'ERROR'])(
			'should write currentPhase null when washerDryer.state is %s',
			async (state) => {
				// Arrange
				const snapshot = new ThinqSnapshot({ washerDryer: { state } });

				// Act
				await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

				// Assert
				expect(findUpdateCall(mockWasher.updateAttribute, 'currentPhase')?.at(2)).toBeNull();
			},
		);

		it('should write currentPhase null and log the raw state when a running state has no phase mapping', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'UNKNOWN_STATE' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(findUpdateCall(mockWasher.updateAttribute, 'currentPhase')?.at(2)).toBeNull();
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_STATE'));
		});

		it('should not log an unmapped-state line when the running phase resolves', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const debugCalls = vi.mocked(mockLogger.debug).mock.calls.map((call: unknown[]) => call[0]);
			expect(debugCalls.filter((line) => String(line).includes('unmapped washer phase state'))).toEqual([]);
		});

		it('should not log an unmapped-state line when the washer is simply not running', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'POWEROFF' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			const debugCalls = vi.mocked(mockLogger.debug).mock.calls.map((call: unknown[]) => call[0]);
			expect(debugCalls.filter((line) => String(line).includes('unmapped washer phase state'))).toEqual([]);
		});

		it('should reject when the phaseList updateAttribute rejects', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });
			mockWasher.updateAttribute.mockImplementation((_clusterId: unknown, attribute: string) =>
				attribute === 'phaseList' ? Promise.reject(new Error('phaseList write failed')) : Promise.resolve(false),
			);

			// Act
			const act = applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			await expect(act).rejects.toThrow('phaseList write failed');
		});
	});

	describe('applyThinqSnapshotToWasher OperationCompletion', () => {
		let mockLogger: ReturnType<typeof createMockLogger>;
		let mockWasher: any;

		beforeEach(() => {
			vi.clearAllMocks();
			mockLogger = createMockLogger();
			mockWasher = createMockWasherEndpoint();
		});

		it('should not call triggerEvent when no cycleTracker is passed (back-compat)', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(mockWasher.triggerEvent).not.toHaveBeenCalled();
		});

		it('should still write phaseList and currentPhase when no cycleTracker is passed', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger);

			// Assert
			expect(findUpdateCall(mockWasher.updateAttribute, 'phaseList')).toBeDefined();
			expect(findUpdateCall(mockWasher.updateAttribute, 'currentPhase')).toBeDefined();
		});

		it('should not call triggerEvent when the tracker reports no completion', async () => {
			// Arrange
			const tracker = createTrackerStub(undefined);
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			expect(mockWasher.triggerEvent).not.toHaveBeenCalled();
		});

		it('should trigger operationCompletion once with the tracker payload when a completion is reported', async () => {
			// Arrange
			const completion: WasherCycleCompletion = { completionErrorCode: 0, totalOperationalTime: 600, pausedTime: 60 };
			const tracker = createTrackerStub(completion);
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			expect(mockWasher.triggerEvent).toHaveBeenCalledTimes(1);
			expect(mockWasher.triggerEvent).toHaveBeenCalledWith(
				OperationalState.id,
				'operationCompletion',
				{ completionErrorCode: 0, totalOperationalTime: 600, pausedTime: 60 },
				mockLogger,
			);
		});

		it('should log an info line naming OperationCompletion when a completion is emitted', async () => {
			// Arrange
			const tracker = createTrackerStub({ completionErrorCode: 0, totalOperationalTime: 600, pausedTime: 0 });
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('OperationCompletion'));
		});

		it('should pin completionErrorCode 0 to OperationalState NoError', async () => {
			// Arrange
			const tracker = createTrackerStub({ completionErrorCode: 0, totalOperationalTime: 1, pausedTime: 0 });
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			const payload = vi.mocked(mockWasher.triggerEvent).mock.calls[0]?.at(2) as WasherCycleCompletion;
			expect(payload.completionErrorCode).toBe(OperationalState.ErrorState.NoError);
		});

		it('should feed the tracker with the resolved device id, run status and raw state', async () => {
			// Arrange
			const tracker = createTrackerStub(undefined);
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			expect(tracker.observe).toHaveBeenCalledWith('washer-123', 'running', 'RUNNING');
		});

		it('should feed the tracker on a non-running END snapshot so completion can be detected', async () => {
			// Arrange
			const tracker = createTrackerStub(undefined);
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			expect(tracker.observe).toHaveBeenCalledWith('washer-123', 'stopped', 'END');
		});

		it('should not feed the tracker when washerDryer.state is absent', async () => {
			// Arrange
			const tracker = createTrackerStub(undefined);
			const snapshot = new ThinqSnapshot({});

			// Act
			await applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			expect(tracker.observe).not.toHaveBeenCalled();
		});

		it('should emit exactly one completion across repeated END polls with a real tracker', async () => {
			// Arrange
			const clock = createFakeClock();
			const tracker = new WasherCycleTracker(clock.now);
			const running = new ThinqSnapshot({ washerDryer: { state: 'RUNNING' } });
			const ended = new ThinqSnapshot({ washerDryer: { state: 'END' } });

			// Act
			await applyThinqSnapshotToWasher(mockWasher, running, mockLogger, tracker);
			clock.advance(600_000);
			await applyThinqSnapshotToWasher(mockWasher, ended, mockLogger, tracker);
			await applyThinqSnapshotToWasher(mockWasher, ended, mockLogger, tracker);
			await applyThinqSnapshotToWasher(mockWasher, ended, mockLogger, tracker);

			// Assert
			expect(mockWasher.triggerEvent).toHaveBeenCalledTimes(1);
			expect(mockWasher.triggerEvent).toHaveBeenCalledWith(
				OperationalState.id,
				'operationCompletion',
				{ completionErrorCode: 0, totalOperationalTime: 600, pausedTime: 0 },
				mockLogger,
			);
		});

		it('should reject when triggerEvent rejects so the caller catch handles it', async () => {
			// Arrange
			const tracker = createTrackerStub({ completionErrorCode: 0, totalOperationalTime: 1, pausedTime: 0 });
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'END' } });
			mockWasher.triggerEvent.mockRejectedValueOnce(new Error('event failed'));

			// Act
			const act = applyThinqSnapshotToWasher(mockWasher, snapshot, mockLogger, tracker);

			// Assert
			await expect(act).rejects.toThrow('event failed');
		});
	});
});
