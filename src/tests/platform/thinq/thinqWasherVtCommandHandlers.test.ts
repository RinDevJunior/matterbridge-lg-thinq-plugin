import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import { applyThinqSnapshotToWasher } from '../../../platform/thinq/thinqWasherStateSync.js';
import {
	createWasherVtPorts,
	registerWasherVtCommandHandlers,
	WASHER_VT_DEFERRED_APPLY_DELAY_MS,
	type WasherVtRunner,
} from '../../../platform/thinq/thinqWasherVtCommandHandlers.js';
import type { WasherVtAction, WasherVtOutcome } from '../../../platform/thinq/thinqWasherVtController.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, buildThinqDeviceData, createMockLogger } from '../../helpers/testUtils.js';

vi.mock('../../../platform/thinq/thinqWasherStateSync.js', () => ({
	applyThinqSnapshotToWasher: vi.fn().mockResolvedValue(undefined),
}));

const REGISTERED_COMMANDS = ['on', 'off', 'start', 'pause', 'resume', 'stop', 'changeToMode'];

function createMockDevice(): ThinqWasherDevice {
	return asPartial<ThinqWasherDevice>({ id: 'washer-123', type: 'WASHER', online: true });
}

function createMockEndpoint(): MatterbridgeEndpoint {
	return asPartial<MatterbridgeEndpoint>({
		log: createMockLogger(),
		addCommandHandler: vi.fn(),
		getAttribute: vi.fn((clusterId: unknown, attributeName: unknown) => {
			if (clusterId === OnOff.id && attributeName === 'onOff') {
				return true;
			}
			if (clusterId === OperationalState.id && attributeName === 'operationalState') {
				return OperationalState.OperationalStateEnum.Running;
			}
			return undefined;
		}),
		updateAttribute: vi.fn().mockResolvedValue(true),
	});
}

function outcome(
	status: WasherVtOutcome['status'],
	message = `${status} message`,
	snapshot?: ThinqSnapshot,
): WasherVtOutcome {
	return snapshot === undefined ? { status, message } : { status, message, snapshot };
}

describe('thinqWasherVtCommandHandlers', () => {
	let logger: AnsiLogger;
	let endpoint: MatterbridgeEndpoint;
	let run: ReturnType<typeof vi.fn<(action: WasherVtAction) => Promise<WasherVtOutcome>>>;
	let runner: WasherVtRunner;

	beforeEach(() => {
		vi.useFakeTimers();
		logger = createMockLogger();
		endpoint = createMockEndpoint();
		run = vi.fn<(action: WasherVtAction) => Promise<WasherVtOutcome>>().mockResolvedValue(outcome('done'));
		runner = { run };
		registerWasherVtCommandHandlers(endpoint, createMockDevice(), runner, logger);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	/** Returns the registered handler for a command as a zero-argument call. */
	function getHandler(commandName: string): () => Promise<void> {
		const entry = vi.mocked(endpoint.addCommandHandler).mock.calls.find(([command]) => command === commandName);
		return entry?.[1] as () => Promise<void>;
	}

	describe('registration', () => {
		it('should register each of the seven command handlers exactly once', () => {
			// Arrange / Act
			const names = vi.mocked(endpoint.addCommandHandler).mock.calls.map(([command]) => command);
			// Assert
			expect([...names].sort()).toEqual([...REGISTERED_COMMANDS].sort());
		});
	});

	describe('command mapping', () => {
		it.each([
			['on', 'power-on'],
			['off', 'power-off'],
			['start', 'start'],
			['pause', 'pause'],
			['resume', 'resume'],
			['stop', 'stop'],
		] as const)('should run %s as the %s action', async (commandName, action) => {
			// Arrange
			const handler = getHandler(commandName);
			// Act
			await handler();
			// Assert
			expect(run).toHaveBeenCalledTimes(1);
			expect(run).toHaveBeenCalledWith(action);
		});
	});

	describe('outcome handling', () => {
		it.each(['done', 'noop'] as const)('should resolve without throwing when the outcome is %s', async (status) => {
			// Arrange
			run.mockResolvedValueOnce(outcome(status));
			const handler = getHandler('pause');
			// Act / Assert
			await expect(handler()).resolves.toBeUndefined();
		});

		it.each(['refused', 'failed', 'unconfirmed', 'staged'] as const)(
			'should reject with the exact outcome message when the outcome is %s',
			async (status) => {
				// Arrange
				run.mockResolvedValueOnce(outcome(status, 'Exact Home sentence.'));
				const handler = getHandler('start');
				// Act / Assert
				await expect(handler()).rejects.toThrow(new Error('Exact Home sentence.'));
			},
		);
	});

	describe('deferred state sync', () => {
		it('should apply the snapshot once after the deferred delay and not before', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ washerDryer: { state: 'DETECTING' } });
			run.mockResolvedValueOnce(outcome('done', 'ok', snapshot));
			const handler = getHandler('start');
			// Act
			await handler();
			const beforeDelay = vi.mocked(applyThinqSnapshotToWasher).mock.calls.length;
			await vi.advanceTimersByTimeAsync(WASHER_VT_DEFERRED_APPLY_DELAY_MS - 1);
			const stillBefore = vi.mocked(applyThinqSnapshotToWasher).mock.calls.length;
			await vi.advanceTimersByTimeAsync(1);
			// Assert
			expect(beforeDelay).toBe(0);
			expect(stillBefore).toBe(0);
			expect(applyThinqSnapshotToWasher).toHaveBeenCalledTimes(1);
			expect(applyThinqSnapshotToWasher).toHaveBeenCalledWith(endpoint, snapshot, logger);
		});

		it('should log and swallow an apply error from the deferred sync', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});
			run.mockResolvedValueOnce(outcome('done', 'ok', snapshot));
			vi.mocked(applyThinqSnapshotToWasher).mockRejectedValueOnce(new Error('apply boom'));
			const handler = getHandler('start');
			// Act
			await expect(handler()).resolves.toBeUndefined();
			await vi.advanceTimersByTimeAsync(WASHER_VT_DEFERRED_APPLY_DELAY_MS);
			// Assert
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('apply boom'));
		});

		it('should still sync the snapshot from a refused outcome before rejecting', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});
			run.mockResolvedValueOnce(outcome('refused', 'nope', snapshot));
			const handler = getHandler('start');
			// Act
			await expect(handler()).rejects.toThrow('nope');
			await vi.advanceTimersByTimeAsync(WASHER_VT_DEFERRED_APPLY_DELAY_MS);
			// Assert
			expect(applyThinqSnapshotToWasher).toHaveBeenCalledWith(endpoint, snapshot, logger);
		});
	});

	describe('revert fallback without a snapshot', () => {
		it('should revert OnOff to its previous value when on is refused', async () => {
			// Arrange
			run.mockResolvedValueOnce(outcome('refused', 'no'));
			const handler = getHandler('on');
			// Act
			await expect(handler()).rejects.toThrow('no');
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, endpoint.log);
		});

		it('should revert OnOff when off fails', async () => {
			// Arrange
			run.mockResolvedValueOnce(outcome('failed', 'bad'));
			const handler = getHandler('off');
			// Act
			await expect(handler()).rejects.toThrow('bad');
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, endpoint.log);
		});

		it('should revert operationalState to its previous value when start is refused', async () => {
			// Arrange
			run.mockResolvedValueOnce(outcome('refused', 'no'));
			const handler = getHandler('start');
			// Act
			await expect(handler()).rejects.toThrow('no');
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running,
				endpoint.log,
			);
		});

		it('should not revert when the outcome is done', async () => {
			// Arrange
			const handler = getHandler('pause');
			// Act
			await handler();
			// Assert
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should still reject with the outcome message when the revert write rejects', async () => {
			// Arrange
			run.mockResolvedValueOnce(outcome('unconfirmed', 'still not confirmed'));
			vi.mocked(endpoint.updateAttribute).mockRejectedValueOnce(new Error('websocket closed'));
			const handler = getHandler('stop');
			// Act / Assert
			await expect(handler()).rejects.toThrow(new Error('still not confirmed'));
		});

		it('should resolve the rejection without awaiting a never-resolving revert write', async () => {
			// Arrange
			vi.mocked(endpoint.updateAttribute).mockImplementation(() => new Promise<boolean>(() => undefined));
			run.mockResolvedValueOnce(outcome('refused', 'no await please'));
			const handler = getHandler('pause');
			// Act / Assert
			await expect(handler()).rejects.toThrow('no await please');
		});
	});

	describe('changeToMode', () => {
		it('should reject with the course-in-settings text and never run the runner', async () => {
			// Arrange
			const handler = getHandler('changeToMode');
			// Act / Assert
			await expect(handler()).rejects.toThrow(
				'Wash course is chosen in the plugin settings (Selected Wash Course), not from Home.',
			);
			expect(run).not.toHaveBeenCalled();
		});
	});
});

describe('createWasherVtPorts', () => {
	const DEVICE_ID = 'washer-123';

	function createApiClient(devices: unknown[], reply: unknown = { resultCode: '0000' }): ThinqApiClient {
		return asPartial<ThinqApiClient>({
			getListDevices: vi.fn().mockResolvedValue(devices),
			sendCommandAndGetResponse: vi.fn().mockResolvedValue(reply),
		});
	}

	function washerData(state: string) {
		return buildThinqDeviceData({
			deviceId: DEVICE_ID,
			deviceType: 201,
			online: true,
			snapshot: { washerDryer: { state, doorClose: 'DOORCLOSE_ON' } },
		});
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('should map the listed device to fields, online and snapshot on readReading', async () => {
		// Arrange
		const apiClient = createApiClient([washerData('RUNNING')]);
		const ports = createWasherVtPorts(asPartial<ThinqWasherDevice>({ id: DEVICE_ID }), apiClient);
		// Act
		const reading = await ports.readReading();
		// Assert
		expect(reading?.fields.state).toBe('"RUNNING"');
		expect(reading?.fields.doorClose).toBe('"DOORCLOSE_ON"');
		expect(reading?.online).toBe(true);
		expect(reading?.snapshot).toBeInstanceOf(ThinqSnapshot);
	});

	it('should return undefined from readReading when the device is not in the account', async () => {
		// Arrange
		const apiClient = createApiClient([washerData('RUNNING')]);
		const ports = createWasherVtPorts(asPartial<ThinqWasherDevice>({ id: 'other-device' }), apiClient);
		// Act / Assert
		await expect(ports.readReading()).resolves.toBeUndefined();
	});

	it('should send the body to the device with the default endpoint (two arguments only)', async () => {
		// Arrange
		const apiClient = createApiClient([]);
		const ports = createWasherVtPorts(asPartial<ThinqWasherDevice>({ id: DEVICE_ID }), apiClient);
		const body = { ctrlKey: 'vtCtrl', command: 'Set', dataSetList: {} };
		// Act
		await ports.send(body);
		// Assert
		expect(apiClient.sendCommandAndGetResponse).toHaveBeenCalledWith(DEVICE_ID, body);
	});

	it('should wait for the sleep duration using timers', async () => {
		// Arrange
		const ports = createWasherVtPorts(asPartial<ThinqWasherDevice>({ id: DEVICE_ID }), createApiClient([]));
		let finished = false;
		// Act
		const pending = ports.sleep(500).then(() => {
			finished = true;
		});
		await vi.advanceTimersByTimeAsync(499);
		const beforeEnd = finished;
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		// Assert
		expect(beforeEnd).toBe(false);
		expect(finished).toBe(true);
	});
});
