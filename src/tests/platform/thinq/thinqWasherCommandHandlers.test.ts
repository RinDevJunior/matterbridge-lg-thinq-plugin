import { LaundryWasherMode, OnOff, OperationalState } from 'matterbridge/matter/clusters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import {
	registerWasherCommandHandlers,
	registerWasherRemoteStartStopSwitchCommandHandlers,
} from '../../../platform/thinq/thinqWasherCommandHandlers.js';
import type { WasherStartCommandPayload } from '../../../platform/thinq/thinqWasherStartCommandResolver.js';
import type { WasherStopCommandPayload } from '../../../platform/thinq/thinqWasherStopCommandResolver.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

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

	describe('v1 read-only commands rejection', () => {
		it('should register exactly 5 read-only command handlers (v1)', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			const calls = vi.mocked(mockEndpoint.addCommandHandler).mock.calls;
			const readOnlyCommandCalls = calls.filter((call: any[]) =>
				['on', 'off', 'pause', 'resume', 'changeToMode'].includes(call[0] as string),
			);
			expect(readOnlyCommandCalls).toHaveLength(5);
		});

		it('should register on command handler', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('on', expect.any(Function));
		});

		it('should register off command handler', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('off', expect.any(Function));
		});

		it('should register pause command handler', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('pause', expect.any(Function));
		});

		it('should register resume command handler', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('resume', expect.any(Function));
		});

		it('should register changeToMode command handler', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('changeToMode', expect.any(Function));
		});

		it('on command should throw with unsupported error', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(onHandler()).rejects.toThrow('not supported yet');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("'on') is not supported yet"));
		});

		it('off command should throw with unsupported error', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const offCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'off');
			const offHandler = offCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(offHandler()).rejects.toThrow('not supported yet');
		});

		it('pause command should throw with unsupported error', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const pauseCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'pause');
			const pauseHandler = pauseCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(pauseHandler()).rejects.toThrow('not supported yet');
		});

		it('on/off commands should revert OnOff.onOff to prior value on failure', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const offCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'off');
			const offHandler = offCall?.[1] as () => Promise<void>;

			// Act
			await expect(offHandler()).rejects.toThrow();

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OnOff.id,
				'onOff',
				true, // Should revert to prior value (true)
				mockEndpoint.log,
			);
		});

		it('non-on/off commands should revert OperationalState.operationalState on failure', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const pauseCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'pause');
			const pauseHandler = pauseCall?.[1] as () => Promise<void>;

			// Act
			await expect(pauseHandler()).rejects.toThrow();

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running, // Should revert to prior value
				mockEndpoint.log,
			);
		});

		it('changeToMode should revert both operationalState and currentMode on failure', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const changeModeCall = vi
				.mocked(mockEndpoint.addCommandHandler)
				.mock.calls.find((call: any[]) => call[0] === 'changeToMode');
			const changeModeHandler = changeModeCall?.[1] as () => Promise<void>;

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
				0, // Should revert to prior value
				mockEndpoint.log,
			);
		});
	});

	describe('v2 real stop command', () => {
		it('should register stop command handler', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};

			// Act
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('stop', expect.any(Function));
		});

		it('stop command should throw when allowRemoteStop is false', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: false };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall1 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall1?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(stopHandler()).rejects.toThrow('disabled by configuration');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("'stop') is disabled by configuration"));
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('stop command should throw when allowRemoteStop is undefined (falsy)', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: undefined };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall3 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall3?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(stopHandler()).rejects.toThrow('disabled by configuration');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('stop command should throw when stopCommandPayload is undefined', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload | undefined = undefined;
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall4 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall4?.[1] as () => Promise<void>;

			// Act & Assert
			if (!stopHandler) throw new Error('stop handler not found');
			await expect(stopHandler()).rejects.toThrow('not available for this device model yet');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('stop command should send command when both gates are open and payload resolves', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall5 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall5?.[1] as () => Promise<void>;

			// Act
			await stopHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', {
				ctrlKey: 'WMControl',
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			});
		});

		it('stop command should include full payload in sendCommand call', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload = {
				command: 'Set',
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall6 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall6?.[1] as () => Promise<void>;

			// Act
			if (!stopHandler) throw new Error('stop handler not found');
			await stopHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', {
				ctrlKey: 'WMControl',
				command: 'Set',
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			});
		});

		it('stop command should revert operationalState if sendCommand fails', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall7 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall7?.[1] as () => Promise<void>;

			// Act
			if (!stopHandler) throw new Error('stop handler not found');
			await expect(stopHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockEndpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				OperationalState.OperationalStateEnum.Running, // Should revert to prior value
				mockEndpoint.log,
			);
		});

		it('stop command should log error when sendCommand fails', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall8 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall8?.[1] as () => Promise<void>;

			// Act
			if (!stopHandler) throw new Error('stop handler not found');
			await expect(stopHandler()).rejects.toThrow();

			// Assert
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("ThinQ Washer command 'stop' failed"));
		});

		it('stop command should not crash if updateAttribute revert fails', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStop: true };
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			mockEndpoint.updateAttribute.mockRejectedValueOnce(new Error('Revert failed'));
			registerWasherCommandHandlers(
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				stopCommandPayload,
			);
			const stopCall9 = vi.mocked(mockEndpoint.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'stop');
			const stopHandler = stopCall9?.[1] as () => Promise<void>;

			// Act & Assert
			if (!stopHandler) throw new Error('stop handler not found');
			await expect(stopHandler()).rejects.toThrow('Network error');
			// Should still throw the original error, not the revert error
		});
	});

	describe('registerWasherRemoteStartStopSwitchCommandHandlers', () => {
		let mockWasherSwitch: any;

		beforeEach(() => {
			vi.clearAllMocks();
			mockLogger = createMockLogger();
			mockApiClient = createMockApiClient();
			mockDevice = createMockWasherDevice();
			mockEndpoint = createMockEndpoint();
			// Create a separate mock for the switch endpoint
			mockWasherSwitch = asPartial<any>({
				log: createMockLogger(),
				addCommandHandler: vi.fn().mockReturnValue(undefined),
				getAttribute: vi.fn().mockImplementation((clusterId: unknown, attrName: unknown) => {
					if (clusterId === OnOff.id && attrName === 'onOff') {
						return true;
					}
					return undefined;
				}),
				updateAttribute: vi.fn().mockResolvedValue(false),
			});
		});

		it('should register on and off command handlers on the switch', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};

			// Act
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);

			// Assert
			expect(mockWasherSwitch.addCommandHandler).toHaveBeenCalledWith('on', expect.any(Function));
			expect(mockWasherSwitch.addCommandHandler).toHaveBeenCalledWith('off', expect.any(Function));
		});

		it('on handler should send start command when allowed and payload resolves', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act
			await onHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', {
				ctrlKey: 'WMStart',
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			});
		});

		it('on handler should throw when allowRemoteStart is false', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: false, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(onHandler()).rejects.toThrow('disabled by configuration');
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("'start') is disabled by configuration"));
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('on handler should throw when allowRemoteStart is undefined', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: undefined, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(onHandler()).rejects.toThrow('disabled by configuration');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('on handler should throw when startCommandPayload is undefined', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload | undefined = undefined;
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(onHandler()).rejects.toThrow('not available for this device model yet');
			expect(mockApiClient.sendCommand).not.toHaveBeenCalled();
		});

		it('on handler should revert switch onOff to prior value on start command failure', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			mockWasherSwitch.getAttribute.mockReturnValue(false); // Prior value was false
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act
			await expect(onHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockWasherSwitch.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, mockWasherSwitch.log);
		});

		it('on handler should revert switch onOff to correct prior value on failure', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			mockWasherSwitch.getAttribute.mockReturnValue(true); // Prior value was true
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act
			await expect(onHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockWasherSwitch.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockWasherSwitch.log);
		});

		it('on handler should not crash if updateAttribute revert fails', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			mockWasherSwitch.updateAttribute.mockRejectedValueOnce(new Error('Revert failed'));
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const onCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'on');
			const onHandler = onCall?.[1] as () => Promise<void>;

			// Act & Assert
			await expect(onHandler()).rejects.toThrow('Network error');
			// Should still throw the original error, not the revert error
		});

		it('off handler should send stop command via performWasherStop', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const offCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'off');
			const offHandler = offCall?.[1] as () => Promise<void>;

			// Act
			await offHandler();

			// Assert
			expect(mockApiClient.sendCommand).toHaveBeenCalledWith('washer-123', {
				ctrlKey: 'WMControl',
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			});
		});

		it('off handler should revert switch onOff to prior value on stop command failure', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			mockWasherSwitch.getAttribute.mockReturnValue(true); // Prior value was true
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const offCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'off');
			const offHandler = offCall?.[1] as () => Promise<void>;

			// Act
			await expect(offHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockWasherSwitch.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockWasherSwitch.log);
		});

		it('off handler should use true as default prior value when getAttribute returns undefined', async () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = { allowRemoteStart: true, allowRemoteStop: true };
			const startCommandPayload: WasherStartCommandPayload = {
				command: 'Set',
				dataSetList: { washerDryer: { course: 'express' } },
			};
			const stopCommandPayload: WasherStopCommandPayload = {
				dataKey: 'washerDryer.state',
				dataValue: 'STOP',
			};
			mockApiClient.sendCommand = vi.fn().mockRejectedValueOnce(new Error('Network error'));
			mockWasherSwitch.getAttribute.mockReturnValue(undefined); // Returns undefined
			registerWasherRemoteStartStopSwitchCommandHandlers(
				mockWasherSwitch,
				mockEndpoint,
				mockDevice,
				mockApiClient,
				mockLogger,
				washerControl,
				startCommandPayload,
				stopCommandPayload,
			);
			const offCall = vi.mocked(mockWasherSwitch.addCommandHandler).mock.calls.find((call: any[]) => call[0] === 'off');
			const offHandler = offCall?.[1] as () => Promise<void>;

			// Act
			await expect(offHandler()).rejects.toThrow('Network error');

			// Assert
			expect(mockWasherSwitch.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockWasherSwitch.log);
		});
	});
});
