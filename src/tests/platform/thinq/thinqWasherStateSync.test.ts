import { OnOff, OperationalState } from 'matterbridge/matter/clusters';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import {
	applyThinqSnapshotToWasher,
	mapWasherStateToOperationalState,
} from '../../../platform/thinq/thinqWasherStateSync.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

function createMockWasherEndpoint(): any {
	return asPartial<any>({
		serialNumber: 'washer-123',
		uniqueId: undefined,
		log: createMockLogger(),
		updateAttribute: vi.fn().mockResolvedValue(false),
		getAttribute: vi.fn().mockReturnValue(OperationalState.OperationalStateEnum.Stopped),
	});
}

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
	});
});
