import { MatterbridgeEndpoint } from 'matterbridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqAirConditionerDevice } from '../../../core/domain/entities/ThinqDevice.js';
import type { AirConditionerCapabilities } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { DEFAULT_AIR_CONDITIONER_CAPABILITIES } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import {
	registerAirConditionerCommandHandlers,
	THINQ_FAN_SPEED_AUTO,
	THINQ_FAN_SPEED_HIGH,
	THINQ_FAN_SPEED_LOW,
	THINQ_FAN_SPEED_MEDIUM,
} from '../../../platform/thinq/thinqAirConditionerCommandHandlers.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

function createMockThinqAirConditionerDevice(): ThinqAirConditionerDevice {
	return asPartial<ThinqAirConditionerDevice>({
		id: 'device-123',
		name: 'Living Room AC',
		type: 'AC',
		modelName: 'ModelXYZ',
		platformType: 'THINQ',
		online: true,
		snapshot: new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
		}),
	});
}

function createMockApiClient(): ThinqApiClient {
	return asPartial<ThinqApiClient>({
		sendCommand: vi.fn().mockResolvedValue(undefined),
	});
}

describe('registerAirConditionerCommandHandlers', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockApiClient: ThinqApiClient;
	let mockDevice: ThinqAirConditionerDevice;
	let capabilities: AirConditionerCapabilities;
	let mockEndpoint: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockApiClient = createMockApiClient();
		mockDevice = createMockThinqAirConditionerDevice();
		capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES;

		mockEndpoint = {
			log: mockLogger,
			addCommandHandler: vi.fn().mockReturnValue(mockEndpoint),
			subscribeAttribute: vi.fn().mockReturnValue(mockEndpoint),
			updateAttribute: vi.fn().mockResolvedValue(false),
		} as unknown as MatterbridgeEndpoint;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('command handler registration', () => {
		it('should call addCommandHandler for on command', () => {
			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('on', expect.any(Function));
		});

		it('should call addCommandHandler for off command', () => {
			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);

			// Assert
			expect(mockEndpoint.addCommandHandler).toHaveBeenCalledWith('off', expect.any(Function));
		});

		it('should call subscribeAttribute for occupiedCoolingSetpoint', () => {
			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasCoolingSetpoint = calls.some((call: any[]) => call[1] === 'occupiedCoolingSetpoint');
			expect(hasCoolingSetpoint).toBe(true);
		});

		it('should call subscribeAttribute for occupiedHeatingSetpoint when supportsHeat is true', () => {
			// Arrange
			const heatCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsHeat: true,
			};

			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, heatCapabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasHeatingSetpoint = calls.some((call: any[]) => call[1] === 'occupiedHeatingSetpoint');
			expect(hasHeatingSetpoint).toBe(true);
		});

		it('should not call subscribeAttribute for occupiedHeatingSetpoint when supportsHeat is false', () => {
			// Arrange
			const noHeatCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsHeat: false,
			};

			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, noHeatCapabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasHeatingSetpoint = calls.some((call: any[]) => call[1] === 'occupiedHeatingSetpoint');
			expect(hasHeatingSetpoint).toBe(false);
		});

		it('should call subscribeAttribute for percentSetting', () => {
			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasPercentSetting = calls.some((call: any[]) => call[1] === 'percentSetting');
			expect(hasPercentSetting).toBe(true);
		});

		it('should call subscribeAttribute for fanMode', () => {
			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasFanMode = calls.some((call: any[]) => call[1] === 'fanMode');
			expect(hasFanMode).toBe(true);
		});
	});

	describe('on command handler execution', () => {
		it('should send Operation command with value 1', async () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const onHandler = vi
				.mocked(mockEndpoint.addCommandHandler)
				.mock.calls.find((call: any[]) => call[0] === 'on')?.[1] as ((...args: any[]) => any) | undefined;

			// Act
			if (onHandler) {
				await onHandler({} as never, {} as never);
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				command: 'Operation',
				dataKey: 'airState.operation',
				dataValue: 1,
			});
		});

		it('should rethrow error when sendCommand fails', async () => {
			// Arrange
			const testError = new Error('API request failed');
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(testError);
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const onHandler = vi
				.mocked(mockEndpoint.addCommandHandler)
				.mock.calls.find((call: any[]) => call[0] === 'on')?.[1] as ((...args: any[]) => any) | undefined;

			// Act & Assert
			expect(onHandler).toBeDefined();
			const handler = onHandler as (...args: any[]) => Promise<void>;
			await expect(handler({} as never, {} as never)).rejects.toThrow('API request failed');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("'on' failed"));
		});
	});

	describe('off command handler execution', () => {
		it('should send Operation command with value 0', async () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const offHandler = vi
				.mocked(mockEndpoint.addCommandHandler)
				.mock.calls.find((call: any[]) => call[0] === 'off')?.[1] as ((...args: any[]) => any) | undefined;

			// Act
			if (offHandler) {
				await offHandler({} as never, {} as never);
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				command: 'Operation',
				dataKey: 'airState.operation',
				dataValue: 0,
			});
		});

		it('should rethrow error when sendCommand fails', async () => {
			// Arrange
			const testError = new Error('API request failed');
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(testError);
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const offHandler = vi
				.mocked(mockEndpoint.addCommandHandler)
				.mock.calls.find((call: any[]) => call[0] === 'off')?.[1] as ((...args: any[]) => any) | undefined;

			// Act & Assert
			expect(offHandler).toBeDefined();
			const handler = offHandler as (...args: any[]) => Promise<void>;
			await expect(handler({} as never, {} as never)).rejects.toThrow('API request failed');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("'off' failed"));
		});
	});

	describe('occupiedCoolingSetpoint subscribeAttribute handler', () => {
		it('should ignore update when context.fabric is undefined', async () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setCoolingHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'occupiedCoolingSetpoint')?.[2] as
				((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setCoolingHandler) {
				setCoolingHandler(2200, 2100, { fabric: undefined });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should send temperature command with rounded value', async () => {
			// Arrange
			vi.clearAllMocks();
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setCoolingHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'occupiedCoolingSetpoint')?.[2] as
				((...args: any[]) => any) | undefined;

			// Act: 2200 centidegrees = 22 degrees (already on 0.5 step)
			if (setCoolingHandler) {
				setCoolingHandler(2200, 2100, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.tempState.target',
				dataValue: 22,
			});
		});

		it('should round setpoint to nearest 0.5°C step', async () => {
			// Arrange
			vi.clearAllMocks();
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setCoolingHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'occupiedCoolingSetpoint')?.[2] as
				((...args: any[]) => any) | undefined;

			// Act: 2253 centidegrees = 22.53 degrees → rounds to 22.5
			if (setCoolingHandler) {
				setCoolingHandler(2253, 2200, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.tempState.target',
				dataValue: 22.5,
			});
		});

		it('should revert setpoint on sendCommand failure', async () => {
			// Arrange
			const testError = new Error('API failed');
			mockApiClient = createMockApiClient();
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(testError);
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setCoolingHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'occupiedCoolingSetpoint')?.[2] as
				((...args: any[]) => any) | undefined;
			const updateAttributeSpy = vi.mocked(mockEndpoint.updateAttribute);

			// Act
			if (setCoolingHandler) {
				setCoolingHandler(2200, 2100, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// Assert - should attempt to revert to oldValue
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				0x0201, // Thermostat.id
				'occupiedCoolingSetpoint',
				2100,
				expect.anything(),
			);
		});
	});

	describe('occupiedHeatingSetpoint subscribeAttribute handler', () => {
		it('should send temperature command when capability.supportsHeat is true', async () => {
			// Arrange
			const heatCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsHeat: true,
			};
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, heatCapabilities);
			const setHeatingHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'occupiedHeatingSetpoint')?.[2] as
				((...args: any[]) => any) | undefined;

			// Act
			if (setHeatingHandler) {
				setHeatingHandler(2600, 2400, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.tempState.target',
				dataValue: 26,
			});
		});

		it('should revert setpoint on sendCommand failure', async () => {
			// Arrange
			const heatCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsHeat: true,
			};
			const testError = new Error('API failed');
			mockApiClient = createMockApiClient();
			vi.mocked(mockApiClient.sendCommand).mockRejectedValueOnce(testError);
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, heatCapabilities);
			const setHeatingHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'occupiedHeatingSetpoint')?.[2] as
				((...args: any[]) => any) | undefined;
			const updateAttributeSpy = vi.mocked(mockEndpoint.updateAttribute);

			// Act
			if (setHeatingHandler) {
				setHeatingHandler(2600, 2400, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(0x0201, 'occupiedHeatingSetpoint', 2400, expect.anything());
		});
	});

	describe('FanControl percentSetting subscribeAttribute handler', () => {
		it('should ignore update when context.fabric is undefined', () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setPercentHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'percentSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setPercentHandler) {
				setPercentHandler(50, 20, { fabric: undefined });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should ignore null newValue', () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setPercentHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'percentSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setPercentHandler) {
				setPercentHandler(null, 20, { fabric: { index: 1 } });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should ignore percentSetting=0', () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setPercentHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'percentSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setPercentHandler) {
				setPercentHandler(0, 50, { fabric: { index: 1 } });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('ignoring percentSetting=0'));
		});

		it('should map percent boundaries correctly', async () => {
			// Arrange
			const testCases = [
				{ percent: 1, expected: THINQ_FAN_SPEED_LOW },
				{ percent: 33, expected: THINQ_FAN_SPEED_LOW },
				{ percent: 34, expected: THINQ_FAN_SPEED_MEDIUM },
				{ percent: 66, expected: THINQ_FAN_SPEED_MEDIUM },
				{ percent: 67, expected: THINQ_FAN_SPEED_HIGH },
				{ percent: 100, expected: THINQ_FAN_SPEED_HIGH },
			];

			for (const testCase of testCases) {
				vi.clearAllMocks();
				mockApiClient = createMockApiClient();
				registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
				const setPercentHandler = vi
					.mocked(mockEndpoint.subscribeAttribute)
					.mock.calls.find((call: any[]) => call[1] === 'percentSetting')?.[2] as ((...args: any[]) => any) | undefined;

				// Act
				if (setPercentHandler) {
					setPercentHandler(testCase.percent, 50, { fabric: { index: 1 } });
					await new Promise((resolve) => setTimeout(resolve, 50));
				}

				// Assert
				expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
					dataKey: 'airState.windStrength',
					dataValue: testCase.expected,
				});
			}
		});

		it('should ignore out-of-range percentSetting values', () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setPercentHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'percentSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setPercentHandler) {
				setPercentHandler(150, 50, { fabric: { index: 1 } });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should not send when supportsFanSpeedControl is false', () => {
			// Arrange
			const noFanCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsFanSpeedControl: false,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, noFanCapabilities);
			const setPercentHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'percentSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setPercentHandler) {
				setPercentHandler(50, 20, { fabric: { index: 1 } });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});
	});

	describe('FanControl fanMode subscribeAttribute handler', () => {
		it('should ignore update when context.fabric is undefined', () => {
			// Arrange
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setFanModeHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'fanMode')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setFanModeHandler) {
				setFanModeHandler(2, 1, { fabric: undefined }); // 2=Medium
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should map Low mode to windStrength 2', async () => {
			// Arrange
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setFanModeHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'fanMode')?.[2] as ((...args: any[]) => any) | undefined;

			// Act - FanControl.FanMode.Low = 1
			if (setFanModeHandler) {
				setFanModeHandler(1, 0, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.windStrength',
				dataValue: THINQ_FAN_SPEED_LOW,
			});
		});

		it('should map Medium mode to windStrength 4', async () => {
			// Arrange
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setFanModeHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'fanMode')?.[2] as ((...args: any[]) => any) | undefined;

			// Act - FanControl.FanMode.Medium = 2
			if (setFanModeHandler) {
				setFanModeHandler(2, 0, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.windStrength',
				dataValue: THINQ_FAN_SPEED_MEDIUM,
			});
		});

		it('should map High mode to windStrength 6', async () => {
			// Arrange
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, capabilities);
			const setFanModeHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'fanMode')?.[2] as ((...args: any[]) => any) | undefined;

			// Act - FanControl.FanMode.High = 3
			if (setFanModeHandler) {
				setFanModeHandler(3, 0, { fabric: { index: 1 } });
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.windStrength',
				dataValue: THINQ_FAN_SPEED_HIGH,
			});
		});

		it('should not send when supportsFanSpeedControl is false', () => {
			// Arrange
			const noFanCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsFanSpeedControl: false,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, noFanCapabilities);
			const setFanModeHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'fanMode')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setFanModeHandler) {
				setFanModeHandler(0, 1, { fabric: { index: 1 } });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});
	});

	describe('FanControl rockSetting subscribeAttribute handler (Phase B)', () => {
		it('should register rockSetting subscribeAttribute when supportsSwingMode is true', () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};

			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasRockSetting = calls.some((call: any[]) => call[1] === 'rockSetting');
			expect(hasRockSetting).toBe(true);
		});

		it('should not register rockSetting subscribeAttribute when supportsSwingMode is false', () => {
			// Arrange
			const noSwingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: false,
			};

			// Act
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, noSwingCapabilities);

			// Assert
			const calls = vi.mocked(mockEndpoint.subscribeAttribute).mock.calls;
			const hasRockSetting = calls.some((call: any[]) => call[1] === 'rockSetting');
			expect(hasRockSetting).toBe(false);
		});

		it('should ignore update when context.fabric is undefined', () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setRockHandler) {
				setRockHandler({ rockUpDown: true }, { rockUpDown: false }, { fabric: undefined });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should send vertical swing command when rockUpDown flips true', async () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: true, rockLeftRight: false, rockRound: false },
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					{ fabric: { index: 1 } },
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.wDir.vStep',
				dataValue: '100',
			});
		});

		it('should send vertical swing off command when rockUpDown flips false', async () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					{ rockUpDown: true, rockLeftRight: false, rockRound: false },
					{ fabric: { index: 1 } },
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.wDir.vStep',
				dataValue: '0',
			});
		});

		it('should send horizontal swing command when rockLeftRight flips true', async () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: false, rockLeftRight: true, rockRound: false },
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					{ fabric: { index: 1 } },
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.wDir.hStep',
				dataValue: '100',
			});
		});

		it('should send horizontal swing off command when rockLeftRight flips false', async () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					{ rockUpDown: false, rockLeftRight: true, rockRound: false },
					{ fabric: { index: 1 } },
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.wDir.hStep',
				dataValue: '0',
			});
		});

		it('should send compound favoriteCtrl command when both axes flip to true simultaneously', async () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: true, rockLeftRight: true, rockRound: false },
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					{ fabric: { index: 1 } },
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: null,
				dataValue: null,
				command: 'Set',
				ctrlKey: 'favoriteCtrl',
				dataSetList: {
					'airState.wDir.vStep': '100',
					'airState.wDir.hStep': '100',
				},
			});
		});

		it('should send individual commands when only one axis changes (not compound favoriteCtrl)', async () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			mockApiClient = createMockApiClient();
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: true, rockLeftRight: false, rockRound: false },
					{ rockUpDown: true, rockLeftRight: true, rockRound: false },
					{ fabric: { index: 1 } },
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Assert
			expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledWith('device-123', {
				dataKey: 'airState.wDir.hStep',
				dataValue: '0',
			});
			// Should NOT use compound favoriteCtrl
			const sendCalls = vi.mocked(mockApiClient.sendCommand).mock.calls;
			const hasFavoriteCtrl = sendCalls.some((call: any[]) => call[1]?.ctrlKey === 'favoriteCtrl');
			expect(hasFavoriteCtrl).toBe(false);
		});

		it('should ignore rockRound-only changes with debug log', () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setRockHandler) {
				setRockHandler(
					{ rockUpDown: false, rockLeftRight: false, rockRound: true },
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					{ fabric: { index: 1 } },
				);
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});

		it('should ignore update when both old and new values are undefined', () => {
			// Arrange
			const swingCapabilities: AirConditionerCapabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};
			registerAirConditionerCommandHandlers(mockEndpoint, mockDevice, mockApiClient, mockLogger, swingCapabilities);
			const setRockHandler = vi
				.mocked(mockEndpoint.subscribeAttribute)
				.mock.calls.find((call: any[]) => call[1] === 'rockSetting')?.[2] as ((...args: any[]) => any) | undefined;
			const sendCommandSpy = vi.mocked(mockApiClient.sendCommand);

			// Act
			if (setRockHandler) {
				setRockHandler(undefined, undefined, { fabric: { index: 1 } });
			}

			// Assert
			expect(sendCommandSpy).not.toHaveBeenCalled();
		});
	});
});
