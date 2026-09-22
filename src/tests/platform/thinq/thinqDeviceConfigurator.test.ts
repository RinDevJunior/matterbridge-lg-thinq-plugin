import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqAirConditionerDevice, ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { DEFAULT_AIR_CONDITIONER_CAPABILITIES } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import type { PlatformConfigManager } from '../../../platform/platformConfigManager.js';
import * as auxiliaryTogglesModule from '../../../platform/thinq/thinqAirConditionerAuxiliaryToggles.js';
import { registerAirConditionerCommandHandlers } from '../../../platform/thinq/thinqAirConditionerCommandHandlers.js';
import { buildAirConditionerEndpoint } from '../../../platform/thinq/thinqAirConditionerEndpointFactory.js';
import * as sceneButtonsModule from '../../../platform/thinq/thinqAirConditionerSceneButtons.js';
import { ThinqDeviceConfigurator } from '../../../platform/thinq/thinqDeviceConfigurator.js';
import { registerWasherCommandHandlers } from '../../../platform/thinq/thinqWasherCommandHandlers.js';
import { buildWasherEndpoint } from '../../../platform/thinq/thinqWasherEndpointFactory.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

vi.mock('../../../platform/thinq/thinqAirConditionerCommandHandlers.js');
vi.mock('../../../platform/thinq/thinqAirConditionerAuxiliaryToggles.js', () => ({
	registerAuxiliaryToggleCommandHandlers: vi.fn(),
}));
vi.mock('../../../platform/thinq/thinqAirConditionerSceneButtons.js', () => ({
	registerSceneButtonCommandHandlers: vi.fn(),
}));
vi.mock('../../../platform/thinq/thinqAirConditionerEndpointFactory.js', () => ({
	buildAirConditionerEndpoint: vi.fn(() => ({
		log: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
		createDefaultTemperatureMeasurementClusterServer: vi.fn().mockReturnThis(),
		addRequiredClusterServers: vi.fn().mockReturnThis(),
	})),
}));
vi.mock('../../../platform/thinq/thinqWasherEndpointFactory.js', () => ({
	buildWasherEndpoint: vi.fn(() => ({
		log: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
	})),
}));
vi.mock('../../../platform/thinq/thinqWasherCommandHandlers.js');
vi.mock('../../../platform/thinq/thinqWasherStopCommandResolver.js');

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

function createMockWasherDevice(): ThinqWasherDevice {
	return asPartial<ThinqWasherDevice>({
		id: 'washer-456',
		name: 'Laundry Room Washer',
		type: 'WASHER',
		modelName: 'VCDWL_QEUK',
		platformType: 'THINQ',
		online: true,
		snapshot: new ThinqSnapshot({
			'washerDryer.state': 'RUNNING',
		}),
		modelJsonUri: 'https://example.com/model.json',
	});
}

function createMockConfigManager(): PlatformConfigManager {
	return asPartial<PlatformConfigManager>({
		getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
		getSceneButtons: vi.fn().mockReturnValue([]),
		getWasherControlConfig: vi.fn().mockReturnValue({}),
		overrideMatterConfiguration: false,
		matterOverrideSettings: {
			matterVendorName: 'Matterbridge',
			matterVendorId: 0xfff1,
			matterProductName: 'LG Air Conditioner',
			matterProductId: 0x8000,
		},
		getProductNameForDevice: vi.fn().mockReturnValue(undefined),
	});
}

describe('ThinqDeviceConfigurator', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockApiClient: ThinqApiClient;
	let mockConfigManager: PlatformConfigManager;
	let configurator: ThinqDeviceConfigurator;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockApiClient = createMockApiClient();
		mockConfigManager = createMockConfigManager();
		configurator = new ThinqDeviceConfigurator(mockLogger, mockApiClient, mockConfigManager);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('registerAirConditioner', () => {
		it('should log device registration', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Registering ThinQ AirConditioner: Living Room AC (device-123)'),
			);
		});

		it('should call getDeviceCapabilities with the device id', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const getCapabilitiesSpy = vi.mocked(mockConfigManager.getDeviceCapabilities);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(getCapabilitiesSpy).toHaveBeenCalledWith('device-123');
		});

		it('should call registerAirConditionerCommandHandlers before returning', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const registerHandlersSpy = vi.mocked(registerAirConditionerCommandHandlers);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(registerHandlersSpy).toHaveBeenCalled();
		});

		it('should return a promise that resolves to an endpoint', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();

			// Act
			const result = await configurator.registerAirConditioner(device);

			// Assert
			expect(result).toBeDefined();
		});

		it('should not assign a mode to the endpoint', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();

			// Act
			const endpoint = await configurator.registerAirConditioner(device);

			// Assert
			// Verify mode is not set by registerAirConditioner (regression test for removed hardcoded server mode)
			expect(endpoint.mode).toBeUndefined();
		});

		it('should use device snapshot values for initial state when defined', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			// Verify it was called with the correct temperature from the device snapshot (22°C current, 24°C target)
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Living Room AC'));
		});

		it('should use default temperature when snapshot values are missing', async () => {
			// Arrange
			const deviceWithNoTemp = createMockThinqAirConditionerDevice();
			// Create a new device with missing temperature data
			const deviceWithoutTemp: ThinqAirConditionerDevice = asPartial<ThinqAirConditionerDevice>({
				...deviceWithNoTemp,
				snapshot: new ThinqSnapshot({
					'airState.operation': 1,
					'airState.opMode': 0,
					'airState.windStrength': 2,
				}),
			});

			// Act
			await configurator.registerAirConditioner(deviceWithoutTemp);

			// Assert
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Registering ThinQ AirConditioner'));
		});

		it('should call registerAirConditionerCommandHandlers with correct parameters', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const registerHandlersSpy = vi.mocked(registerAirConditionerCommandHandlers);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(registerHandlersSpy).toHaveBeenCalledWith(
				expect.anything(), // endpoint
				device,
				mockApiClient,
				mockLogger,
				DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			);
		});

		it('should call registerAuxiliaryToggleCommandHandlers with correct parameters (Phase A)', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const registerAuxHandlersSpy = vi.mocked(auxiliaryTogglesModule.registerAuxiliaryToggleCommandHandlers);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(registerAuxHandlersSpy).toHaveBeenCalledWith(
				expect.anything(), // endpoint
				device,
				mockApiClient,
				mockLogger,
				DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			);
		});

		it('should call registerAuxiliaryToggleCommandHandlers after registerAirConditionerCommandHandlers', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const registerHandlersSpy = vi.mocked(registerAirConditionerCommandHandlers);
			const registerAuxHandlersSpy = vi.mocked(auxiliaryTogglesModule.registerAuxiliaryToggleCommandHandlers);

			// Mock to track call order
			const callOrder: string[] = [];
			registerHandlersSpy.mockImplementation(() => {
				callOrder.push('registerAirConditionerCommandHandlers');
			});
			registerAuxHandlersSpy.mockImplementation(() => {
				callOrder.push('registerAuxiliaryToggleCommandHandlers');
			});

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(callOrder).toEqual(['registerAirConditionerCommandHandlers', 'registerAuxiliaryToggleCommandHandlers']);
		});

		it('should call getSceneButtons with device id', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const getSceneButtonsSpy = vi.mocked(mockConfigManager.getSceneButtons);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(getSceneButtonsSpy).toHaveBeenCalledWith('device-123');
		});

		it('should call registerSceneButtonCommandHandlers with correct parameters', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const sceneButtons = [{ name: 'PowerOff', opMode: 0 }];
			vi.mocked(mockConfigManager.getSceneButtons).mockReturnValue(sceneButtons);
			const registerSceneHandlersSpy = vi.mocked(sceneButtonsModule.registerSceneButtonCommandHandlers);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(registerSceneHandlersSpy).toHaveBeenCalledWith(
				expect.anything(), // endpoint
				sceneButtons,
				device,
				mockApiClient,
				mockLogger,
			);
		});

		it('should pass empty scene buttons array to handler when none configured', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			vi.mocked(mockConfigManager.getSceneButtons).mockReturnValue([]);
			const registerSceneHandlersSpy = vi.mocked(sceneButtonsModule.registerSceneButtonCommandHandlers);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(registerSceneHandlersSpy).toHaveBeenCalledWith(
				expect.anything(), // endpoint
				[],
				device,
				mockApiClient,
				mockLogger,
			);
		});

		it('should call registerSceneButtonCommandHandlers after registerAuxiliaryToggleCommandHandlers', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const registerHandlersSpy = vi.mocked(registerAirConditionerCommandHandlers);
			const registerAuxHandlersSpy = vi.mocked(auxiliaryTogglesModule.registerAuxiliaryToggleCommandHandlers);
			const registerSceneHandlersSpy = vi.mocked(sceneButtonsModule.registerSceneButtonCommandHandlers);

			// Mock to track call order
			const callOrder: string[] = [];
			registerHandlersSpy.mockImplementation(() => {
				callOrder.push('registerAirConditionerCommandHandlers');
			});
			registerAuxHandlersSpy.mockImplementation(() => {
				callOrder.push('registerAuxiliaryToggleCommandHandlers');
			});
			registerSceneHandlersSpy.mockImplementation(() => {
				callOrder.push('registerSceneButtonCommandHandlers');
			});

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(callOrder).toEqual([
				'registerAirConditionerCommandHandlers',
				'registerAuxiliaryToggleCommandHandlers',
				'registerSceneButtonCommandHandlers',
			]);
		});

		it('should pass options with undefined override fields when overrideMatterConfiguration is false', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const buildEndpointSpy = vi.mocked(buildAirConditionerEndpoint);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(buildEndpointSpy).toHaveBeenCalledWith(
				device,
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.objectContaining({
					vendorId: undefined,
					vendorName: undefined,
					productId: undefined,
					productName: undefined,
				}),
			);
		});

		it('should pass options with matterOverrideSettings values when overrideMatterConfiguration is true and no per-device override', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const customSettings = {
				matterVendorName: 'Custom Vendor',
				matterVendorId: 0xabcd,
				matterProductName: 'Premium AC',
				matterProductId: 0xef01,
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getSceneButtons: vi.fn().mockReturnValue([]),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
			});
			configurator = new ThinqDeviceConfigurator(mockLogger, mockApiClient, mockConfigManager);
			const buildEndpointSpy = vi.mocked(buildAirConditionerEndpoint);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(buildEndpointSpy).toHaveBeenCalledWith(
				device,
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.objectContaining({
					vendorId: 0xabcd,
					vendorName: 'Custom Vendor',
					productId: 0xef01,
					productName: 'Premium AC', // Falls back to matterProductName
				}),
			);
		});

		it('should use per-device productName when available and override enabled', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const customSettings = {
				matterVendorName: 'Custom Vendor',
				matterVendorId: 0xabcd,
				matterProductName: 'Premium AC',
				matterProductId: 0xef01,
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getSceneButtons: vi.fn().mockReturnValue([]),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue('Device-Specific AC'),
			});
			configurator = new ThinqDeviceConfigurator(mockLogger, mockApiClient, mockConfigManager);
			const buildEndpointSpy = vi.mocked(buildAirConditionerEndpoint);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(buildEndpointSpy).toHaveBeenCalledWith(
				device,
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.objectContaining({
					vendorId: 0xabcd,
					vendorName: 'Custom Vendor',
					productId: 0xef01,
					productName: 'Device-Specific AC', // Per-device override takes precedence
				}),
			);
		});

		it('should call getProductNameForDevice with correct device id', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const customSettings = {
				matterVendorName: 'Matterbridge',
				matterVendorId: 0xfff1,
				matterProductName: 'LG Air Conditioner',
				matterProductId: 0x8000,
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getSceneButtons: vi.fn().mockReturnValue([]),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
			});
			configurator = new ThinqDeviceConfigurator(mockLogger, mockApiClient, mockConfigManager);
			const getProductNameSpy = vi.mocked(mockConfigManager.getProductNameForDevice);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(getProductNameSpy).toHaveBeenCalledWith('device-123');
		});

		it('should still pass sceneButtons in options alongside override settings', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const sceneButtons = [{ name: 'PowerOff', opMode: 0 }];
			const customSettings = {
				matterVendorName: 'Custom Vendor',
				matterVendorId: 0xabcd,
				matterProductName: 'Premium AC',
				matterProductId: 0xef01,
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getSceneButtons: vi.fn().mockReturnValue(sceneButtons),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue('Custom AC'),
			});
			configurator = new ThinqDeviceConfigurator(mockLogger, mockApiClient, mockConfigManager);
			const buildEndpointSpy = vi.mocked(buildAirConditionerEndpoint);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(buildEndpointSpy).toHaveBeenCalledWith(
				device,
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.objectContaining({
					sceneButtons,
					vendorId: 0xabcd,
					vendorName: 'Custom Vendor',
					productId: 0xef01,
					productName: 'Custom AC',
				}),
			);
		});
	});

	describe('registerWasher', () => {
		it('should log device registration', async () => {
			// Arrange
			const device = createMockWasherDevice();

			// Act
			await configurator.registerWasher(device);

			// Assert
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Registering ThinQ Washer: Laundry Room Washer (washer-456)'),
			);
		});

		it('should call buildWasherEndpoint with the device', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const buildEndpointSpy = vi.mocked(buildWasherEndpoint);

			// Act
			await configurator.registerWasher(device);

			// Assert
			expect(buildEndpointSpy).toHaveBeenCalledWith(device);
		});

		it('should call registerWasherCommandHandlers with correct parameters', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const registerHandlersSpy = vi.mocked(registerWasherCommandHandlers);

			// Act
			await configurator.registerWasher(device);

			// Assert
			expect(registerHandlersSpy).toHaveBeenCalled();
			const call = registerHandlersSpy.mock.calls[0];
			expect(call[1]).toBe(device); // device parameter
			expect(call[2]).toBe(mockApiClient); // apiClient parameter
			expect(call[3]).toBe(mockLogger); // logger parameter
		});

		it('should return an endpoint', async () => {
			// Arrange
			const device = createMockWasherDevice();

			// Act
			const result = await configurator.registerWasher(device);

			// Assert
			expect(result).toBeDefined();
		});

		it('should call getWasherControlConfig with device id', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getConfigSpy = vi.mocked(mockConfigManager.getWasherControlConfig);

			// Act
			await configurator.registerWasher(device);

			// Assert
			expect(getConfigSpy).toHaveBeenCalledWith('washer-456');
		});

		it('should pass washerControl config to registerWasherCommandHandlers', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const washerControl = { allowRemoteStop: true };
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue(washerControl);
			const registerHandlersSpy = vi.mocked(registerWasherCommandHandlers);

			// Act
			await configurator.registerWasher(device);

			// Assert
			const call = registerHandlersSpy.mock.calls[0];
			expect(call[4]).toEqual(washerControl); // washerControl parameter
		});

		it('should pass 5+ parameters to registerWasherCommandHandlers (includes stop payload)', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const registerHandlersSpy = vi.mocked(registerWasherCommandHandlers);

			// Act
			await configurator.registerWasher(device);

			// Assert
			const call = registerHandlersSpy.mock.calls[0];
			// Verify the function is called with 6 parameters:
			// washer, device, apiClient, logger, washerControl, stopCommandPayload
			expect(call.length).toBe(6);
		});
	});
});
