import { LaundryWasherMode, OnOff, OperationalState } from 'matterbridge/matter/clusters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import {
	registerWasherCommandHandlers,
	type WasherCommandPayloads,
} from '../../../platform/thinq/thinqWasherCommandHandlers.js';
import type { WasherStartCommandPayload } from '../../../platform/thinq/thinqWasherStartCommandResolver.js';
import type {
	WasherPauseCommandPayload,
	WasherStopCommandPayload,
} from '../../../platform/thinq/thinqWasherStopCommandResolver.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

const PAUSE_PAYLOAD: WasherPauseCommandPayload = {
	command: 'Set',
	dataSetList: {
		washerDryer: { controlDataType: 'PAUSE', controlDataValueLength: 1, controlDataValue: 0 },
	},
};

const POWEROFF_PAYLOAD: WasherStopCommandPayload = {
	command: 'Set',
	dataSetList: {
		washerDryer: { controlDataType: 'POWEROFF', controlDataValueLength: 1, controlDataValue: 0 },
	},
};

const START_PAYLOAD: WasherStartCommandPayload = {
	command: 'Set',
	dataSetList: { washerDryer: { course: 'express' } },
};

const NO_PAYLOADS: WasherCommandPayloads = { pause: undefined, stop: undefined, start: undefined };

function createMockWasherDevice(): ThinqWasherDevice {
	return asPartial<ThinqWasherDevice>({
		id: 'washer-123',
		name: 'Living Room Washer',
		type: 'WASHER',
		modelName: 'VCDWL_QEUK',
		platformType: 'THINQ',
		online: true,
		snapshot: new ThinqSnapshot({
			'washerDryer.state': 'RUNNING',
		}),
	});
}

function createMockApiClient(): ThinqApiClient {
	return asPartial<ThinqApiClient>({
		sendCommand: vi.fn().mockResolvedValue(undefined),
	});
}

function createMockEndpoint(): any {
	const endpoint = asPartial<any>({
		log: createMockLogger(),
		addCommandHandler: vi.fn().mockReturnValue(undefined),
		getAttribute: vi.fn().mockImplementation((clusterId: unknown, attrName: unknown) => {
			if (clusterId === OnOff.id && attrName === 'onOff') {
				return true;
			}
			if (clusterId === OperationalState.id && attrName === 'operationalState') {
				return OperationalState.OperationalStateEnum.Running;
			}
			if (clusterId === LaundryWasherMode.id && attrName === 'currentMode') {
				return 0;
			}
			return undefined;
		}),
		updateAttribute: vi.fn().mockResolvedValue(false),
	});
	return endpoint;
}

describe('registerWasherCommandHandlers', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockApiClient: ThinqApiClient;
	let mockDevice: ThinqWasherDevice;
	let mockEndpoint: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockApiClient = createMockApiClient();
		mockDevice = createMockWasherDevice();
		mockEndpoint = createMockEndpoint();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	function register(payloads: WasherCommandPayloads = NO_PAYLOADS): void {
		registerWasherCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, payloads);
	}

	function getHandler(commandName: string): () => Promise<void> {
		const call = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((c: any[]) => c[0] === commandName);
		return call?.[1] as () => Promise<void>;
	}

	function setOperationalState(state: number | undefined): void {
		mockEndpoint.getAttribute.mockReturnValue(state);
	}

	describe('read-only command rejection', () => {
		it('should register exactly 4 read-only command handlers (on, off, resume, changeToMode)', () => {
			// Arrange
			const readOnlyNames = ['on', 'off', 'pause', 'resume', 'changeToMode', 'stop', 'start'];

			// Act
			register();

			// Assert
			const calls = vi.mocked(mockEndpoint.addCommandHandler).mock.calls;
			const readOnlyCommandCalls = calls.filter((call: any[]) =>
				['on', 'off', 'resume', 'changeToMode'].includes(call[0] as string),
			);
			expect(readOnlyCommandCalls).toHaveLength(4);
			expect(calls.map((call: any[]) => call[0])).toEqual(expect.arrayContaining(readOnlyNames));
		});

		it('should register pause, stop and start command handlers exactly once each', () => {
			// Arrange
			const names = ['pause', 'stop', 'start'];

			// Act
			register();

			// Assert
			const registeredNames = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.map((call: any[]) => call[0]);
			expect(registeredNames).toHaveLength(7);
			for (const name of names) {
				expect(registeredNames.filter((registered: string) => registered === name)).toHaveLength(1);
			}
		});

		it.each(['on', 'off', 'resume', 'changeToMode'])('should register %s command handler', (commandName) => {
			// Arrange
			// (no setup needed)

			// Act
			register();

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith(commandName, expect.any(Function));
		});

		it('on command should throw with unsupported error', async () => {
			// Arrange
			register();
			const onHandler = getHandler('on');

			// Act & Assert
			await expect(onHandler()).rejects.toThrow('not supported yet');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("'on') is not supported yet"));
		});

		it('off command should throw with unsupported error', async () => {
			// Arrange
			register();
			const offHandler = getHandler('off');

			// Act & Assert
			await expect(offHandler()).rejects.toThrow('not supported yet');
		});

		it('resume command should throw with unsupported error', async () => {
			// Arrange
			register();
			const resumeHandler = getHandler('resume');

			// Act & Assert
			await expect(resumeHandler()).rejects.toThrow('not supported yet');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('on/off commands should revert OnOff.onOff to prior value on failure', async () => {
			// Arrange
			register();
			const offHandler = getHandler('off');

			// Act
			await expect(offHandler()).rejects.toThrow();

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockEndpoint.log);
		});

		it('resume should revert OperationalState.operationalState on failure', async () => {
			// Arrange
			register();
			const resumeHandler = getHandler('resume');

			// Act
			await expect(resumeHandler()).rejects.toThrow();

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running,
				mockEndpoint.log,
			);
		});

		it('changeToMode should revert both operationalState and currentMode on failure', async () => {
			// Arrange
			register();
			const changeModeHandler = getHandler('changeToMode');

			// Act
			await expect(changeModeHandler()).rejects.toThrow();

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				expect.any(Number),
				mockEndpoint.log,
			);
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherMode.id,
				'currentMode',
				0,
				mockEndpoint.log,
			);
		});
	});

	describe('pause command', () => {
		it('should send WMControl with the pause payload once and not revert when Running', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const pauseHandler = getHandler('pause');

			// Act
			await pauseHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledTimes(1);
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', { ctrlKey: 'WMControl', ...PAUSE_PAYLOAD });
			expect(mockEndpoint.updateAttribute).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('pause-command payload'));
		});

		it('should read operationalState before awaiting sendCommand', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const pauseHandler = getHandler('pause');

			// Act
			await pauseHandler();

			// Assert
			const readOrder = mockEndpoint.getAttribute.mock.invocationCallOrder[0];
			const sendOrder = vi.mocked(mockApiClient.sendCommand).mock.invocationCallOrder[0];
			expect(readOrder).toBeLessThan(sendOrder ?? 0);
		});

		it('should resolve without sendCommand and log debug when already Paused', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Paused);
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const pauseHandler = getHandler('pause');

			// Act & Assert
			await expect(pauseHandler()).resolves.toBeUndefined();
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('already paused'));
		});

		it.each([
			['Stopped', OperationalState.OperationalStateEnum.Stopped],
			['Error', OperationalState.OperationalStateEnum.Error],
			['undefined', undefined],
		])('should resolve without sendCommand and warn when state is %s', async (_label, state) => {
			// Arrange
			setOperationalState(state);
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const pauseHandler = getHandler('pause');

			// Act & Assert
			await expect(pauseHandler()).resolves.toBeUndefined();
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not running'));
		});

		it('should reject, warn and revert to Running when pause payload is undefined', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			register(NO_PAYLOADS);
			const pauseHandler = getHandler('pause');

			// Act & Assert
			await expect(pauseHandler()).rejects.toThrow('not available for this device model yet');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not available for this device model yet'));
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running,
				mockEndpoint.log,
			);
		});

		it('should rethrow, log with deviceId and revert to Running when sendCommand rejects', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const pauseHandler = getHandler('pause');

			// Act & Assert
			await expect(pauseHandler()).rejects.toThrow('Network error');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("'pause' failed"));
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('washer-123'));
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running,
				mockEndpoint.log,
			);
		});

		it('should not throw a second error when the revert updateAttribute fails', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			mockEndpoint.updateAttribute.mockRejectedValueOnce(new Error('Revert failed'));
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const pauseHandler = getHandler('pause');

			// Act & Assert
			await expect(pauseHandler()).rejects.toThrow('Network error');
		});
	});

	describe('stop command', () => {
		it.each([
			['Running', OperationalState.OperationalStateEnum.Running],
			['Paused', OperationalState.OperationalStateEnum.Paused],
			['Error', OperationalState.OperationalStateEnum.Error],
		])('should send WMControl with the POWEROFF payload once when state is %s', async (_label, state) => {
			// Arrange
			setOperationalState(state);
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD, stop: POWEROFF_PAYLOAD });
			const stopHandler = getHandler('stop');

			// Act
			await stopHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledTimes(1);
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', {
				ctrlKey: 'WMControl',
				...POWEROFF_PAYLOAD,
			});
			expect(mockApiClient.sendCommand).not.toHaveBeenCalledWith('washer-123', expect.objectContaining(PAUSE_PAYLOAD));
		});

		it.each([
			['Stopped', OperationalState.OperationalStateEnum.Stopped],
			['undefined', undefined],
		])('should resolve without sendCommand and log debug when state is %s', async (_label, state) => {
			// Arrange
			setOperationalState(state);
			register({ ...NO_PAYLOADS, stop: POWEROFF_PAYLOAD });
			const stopHandler = getHandler('stop');

			// Act & Assert
			await expect(stopHandler()).resolves.toBeUndefined();
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('already stopped'));
		});

		it('should reject, warn and revert when stop payload is undefined while Running', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			register({ ...NO_PAYLOADS, pause: PAUSE_PAYLOAD });
			const stopHandler = getHandler('stop');

			// Act & Assert
			await expect(stopHandler()).rejects.toThrow("('stop') is not available");
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("('stop') is not available"));
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running,
				mockEndpoint.log,
			);
		});

		it('should rethrow, log and revert to the previous state when sendCommand rejects', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Paused);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			register({ ...NO_PAYLOADS, stop: POWEROFF_PAYLOAD });
			const stopHandler = getHandler('stop');

			// Act & Assert
			await expect(stopHandler()).rejects.toThrow('Network error');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("'stop' failed"));
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Paused,
				mockEndpoint.log,
			);
		});

		it('should not throw a second error when the revert updateAttribute fails', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			mockEndpoint.updateAttribute.mockRejectedValueOnce(new Error('Revert failed'));
			register({ ...NO_PAYLOADS, stop: POWEROFF_PAYLOAD });
			const stopHandler = getHandler('stop');

			// Act & Assert
			await expect(stopHandler()).rejects.toThrow('Network error');
		});
	});

	describe('OperationalState start (direct wiring)', () => {
		it('should register a start command handler on the washer', () => {
			// Arrange
			// (no setup needed)

			// Act
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('start', expect.any(Function));
		});

		it('should send WMStart and not revert when state is Stopped and payload resolves', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Stopped);
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act
			await startHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledTimes(1);
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', {
				ctrlKey: 'WMStart',
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			});
			expect(mockEndpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should resolve without calling sendCommand when state is Running', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act & Assert
			await expect(startHandler()).resolves.toBeUndefined();
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('should reject and not call sendCommand when state is Paused', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Paused);
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act & Assert
			await expect(startHandler()).rejects.toThrow('while paused is not supported');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("'start' while paused"));
		});

		it('should reject and not call sendCommand when state is Error', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Error);
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act & Assert
			await expect(startHandler()).rejects.toThrow('error state');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("'start' rejected"));
		});

		it('should reject, warn and revert state when start payload is undefined', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Stopped);
			register(NO_PAYLOADS);
			const startHandler = getHandler('start');

			// Act & Assert
			await expect(startHandler()).rejects.toThrow('not available for this device model yet');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not available for this device model yet'));
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Stopped,
				mockEndpoint.log,
			);
		});

		it('should rethrow the same error and log when sendCommand rejects', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Stopped);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act & Assert
			await expect(startHandler()).rejects.toThrow('Network error');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("ThinQ Washer command 'start' failed"));
		});

		it('should revert operationalState to Stopped when sendCommand rejects', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Stopped);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act
			await expect(startHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Stopped,
				mockEndpoint.log,
			);
		});

		it('should not throw a second error when the revert updateAttribute fails', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Stopped);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			mockEndpoint.updateAttribute.mockRejectedValueOnce(new Error('Revert failed'));
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act & Assert
			await expect(startHandler()).rejects.toThrow('Network error');
		});

		it('should treat undefined operationalState as not running and revert to Stopped on failure', async () => {
			// Arrange
			setOperationalState(undefined);
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(new Error('Network error'));
			register({ ...NO_PAYLOADS, start: START_PAYLOAD });
			const startHandler = getHandler('start');

			// Act
			await expect(startHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledTimes(1);
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Stopped,
				mockEndpoint.log,
			);
		});

		it('should send WMStart and WMControl stop without any washer config present', async () => {
			// Arrange
			setOperationalState(OperationalState.OperationalStateEnum.Stopped);
			register({ ...NO_PAYLOADS, start: START_PAYLOAD, stop: POWEROFF_PAYLOAD });
			const startHandler = getHandler('start');
			const stopHandler = getHandler('stop');

			// Act
			await startHandler();
			setOperationalState(OperationalState.OperationalStateEnum.Running);
			await stopHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenNthCalledWith(
				1,
				'washer-123',
				expect.objectContaining({ ctrlKey: 'WMStart' }),
			);
			expect(mockApiClient.sendCommand).toHaveBeenNthCalledWith(
				2,
				'washer-123',
				expect.objectContaining({ ctrlKey: 'WMControl' }),
			);
		});
	});
});
