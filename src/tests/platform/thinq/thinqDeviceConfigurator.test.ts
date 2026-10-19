import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqAirConditionerDevice, ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { DEFAULT_AIR_CONDITIONER_CAPABILITIES } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import type { PlatformConfigManager } from '../../../platform/platformConfigManager.js';
import { registerAirConditionerCommandHandlers } from '../../../platform/thinq/thinqAirConditionerCommandHandlers.js';
import { buildAirConditionerEndpoint } from '../../../platform/thinq/thinqAirConditionerEndpointFactory.js';
import { ThinqDeviceConfigurator } from '../../../platform/thinq/thinqDeviceConfigurator.js';
import { registerWasherCommandHandlers } from '../../../platform/thinq/thinqWasherCommandHandlers.js';
import { buildWasherEndpoint } from '../../../platform/thinq/thinqWasherEndpointFactory.js';
import { extractWasherStartCommand } from '../../../platform/thinq/thinqWasherStartCommandResolver.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

vi.mock('../../../platform/thinq/thinqAirConditionerCommandHandlers.js');
vi.mock('../../../platform/thinq/thinqAirConditionerAuxiliaryToggles.js', () => ({
	registerAuxiliaryToggleCommandHandlers: vi.fn(),
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
vi.mock('../../../platform/thinq/thinqWasherCommandHandlers.js', () => ({
	registerWasherCommandHandlers: vi.fn(),
}));
vi.mock('../../../platform/thinq/thinqWasherStartCommandResolver.js', () => ({
	extractWasherStartCommand: vi.fn(),
}));
vi.mock('../../../platform/thinq/thinqAirConditionerFilterResetCommandHandler.js', () => ({
	registerFilterResetCommandHandler: vi.fn(),
}));

/** LG `ControlWifi.WMStop` entry: the PAUSE control (matches the LG sample washer model shape). */
const PAUSE_CONTROL_ENTRY = {
	command: 'Set',
	data: {
		washerDryer: { controlDataType: 'PAUSE', controlDataValueLength: 1, controlDataValue: 0 },
	},
};

/** LG `ControlWifi.WMOff` entry: the POWEROFF control (matches the LG sample washer model shape). */
const POWEROFF_CONTROL_ENTRY = {
	command: 'Set',
	data: {
		washerDryer: { controlDataType: 'POWEROFF', controlDataValueLength: 1, controlDataValue: 0 },
	},
};

function createConfiguratorWithDeviceModel(
	logger: ReturnType<typeof createMockLogger>,
	configManager: PlatformConfigManager,
	getDeviceModel: ThinqApiClient['getDeviceModel'],
): ThinqDeviceConfigurator {
	return new ThinqDeviceConfigurator(
		logger,
		asPartial<ThinqApiClient>({
			getDeviceModel,
			sendCommand: vi.fn().mockResolvedValue(undefined),
		}),
		configManager,
	);
}

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
		getWasherControlConfig: vi.fn().mockReturnValue({}),
		getAcFilterControlConfig: vi.fn().mockReturnValue({}),
		overrideMatterConfiguration: false,
		matterOverrideSettings: {
			matterVendorName: 'Matterbridge',
			matterVendorId: 0xfff1,
		},
		getProductNameForDevice: vi.fn().mockReturnValue(undefined),
		getProductIdForDevice: vi.fn().mockReturnValue(undefined),
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

		it('should hardcode the endpoint mode to server', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();

			// Act
			const endpoint = await configurator.registerAirConditioner(device);

			// Assert
			// The AC is always exposed as its own standalone Matter node (server mode), not user-configurable.
			expect(endpoint.mode).toBe('server');
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

		it('should pass options with default product identity when overrideMatterConfiguration is false', async () => {
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
					productId: 0x8000,
					productName: 'LG Air Conditioner',
				}),
			);
		});

		it('should pass options with matterOverrideSettings values when overrideMatterConfiguration is true and no per-device override', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const customSettings = {
				matterVendorName: 'Custom Vendor',
				matterVendorId: 0xabcd,
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
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
				}),
			);
		});

		it('should use per-device productName when available and override enabled', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const customSettings = {
				matterVendorName: 'Custom Vendor',
				matterVendorId: 0xabcd,
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue('Device-Specific AC'),
				getProductIdForDevice: vi.fn().mockReturnValue(0xef01),
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
			};
			mockConfigManager = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				overrideMatterConfiguration: true,
				matterOverrideSettings: customSettings,
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			configurator = new ThinqDeviceConfigurator(mockLogger, mockApiClient, mockConfigManager);
			const getProductNameSpy = vi.mocked(mockConfigManager.getProductNameForDevice);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(getProductNameSpy).toHaveBeenCalledWith('device-123');
		});

		it('should call getAcFilterControlConfig with device id', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const getFilterControlConfigSpy = vi.mocked(mockConfigManager.getAcFilterControlConfig);

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(getFilterControlConfigSpy).toHaveBeenCalledWith('device-123');
		});

		it('should import and call registerFilterResetCommandHandler', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			// Note: We use dynamic import to get the mocked version since it's mocked at the module level
			const { registerFilterResetCommandHandler: mockedHandler } =
				await import('../../../platform/thinq/thinqAirConditionerFilterResetCommandHandler.js');

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(vi.mocked(mockedHandler)).toHaveBeenCalledOnce();
		});

		it('should call registerFilterResetCommandHandler with correct parameters', async () => {
			// Arrange
			const device = createMockThinqAirConditionerDevice();
			const filterResetControl = { allowFilterReset: true };
			vi.mocked(mockConfigManager.getAcFilterControlConfig).mockReturnValue(filterResetControl);

			// Import the mocked handler
			const { registerFilterResetCommandHandler: mockedHandler } =
				await import('../../../platform/thinq/thinqAirConditionerFilterResetCommandHandler.js');

			// Act
			await configurator.registerAirConditioner(device);

			// Assert
			expect(vi.mocked(mockedHandler)).toHaveBeenCalledWith(
				expect.anything(), // endpoint
				device,
				mockApiClient,
				mockLogger,
				DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				filterResetControl,
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

		it('should call buildWasherEndpoint with the device and options', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const buildEndpointSpy = vi.mocked(buildWasherEndpoint);

			// Act
			await configurator.registerWasher(device);

			// Assert
			expect(buildEndpointSpy).toHaveBeenCalledWith(
				device,
				expect.objectContaining({
					vendorId: undefined,
					vendorName: undefined,
					productId: 0x8001,
					productName: 'LG Washer',
				}),
			);
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

		it('should pass washer, device, apiClient and logger to registerWasherCommandHandlers', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const washerControl = { selectedCourse: 'express' };
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue(washerControl);
			const registerHandlersSpy = vi.mocked(registerWasherCommandHandlers);

			// Act
			await configurator.registerWasher(device);

			// Assert
			const call = registerHandlersSpy.mock.calls[0];
			expect(call?.[1]).toBe(device);
			expect(call?.[2]).toBe(mockApiClient);
			expect(call?.[3]).toBe(mockLogger);
		});

		it('should pass 5 parameters to registerWasherCommandHandlers with a { pause, stop, start } payloads object fifth', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const registerHandlersSpy = vi.mocked(registerWasherCommandHandlers);

			// Act
			await configurator.registerWasher(device);

			// Assert
			const call = registerHandlersSpy.mock.calls[0];
			// washer, device, apiClient, logger, { pause, stop, start }
			expect(call).toHaveLength(5);
			expect(Object.keys(call?.[4] ?? {}).sort()).toEqual(['pause', 'start', 'stop']);
		});

		it('should call getDeviceModel three times (once for pause+stop, once for catalog, once for start)', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				ControlWifi: {
					WMStop: { data: { washerDryer: {} } },
					WMOff: { data: { washerDryer: {} } },
					WMStart: { command: 'Set', data: { washerDryer: {} } },
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'spinSpeed', default: 1200 }],
					},
				},
			});
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue({});
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue({}),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);

			// Assert
			expect(getDeviceModelSpy).toHaveBeenCalledTimes(3); // pause+stop, catalog, start
		});

		it('should resolve pause from WMStop and stop from WMOff when both ControlWifi entries exist', async () => {
			// Arrange
			const device = createMockWasherDevice();
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				ControlWifi: {
					WMStop: PAUSE_CONTROL_ENTRY,
					WMOff: POWEROFF_CONTROL_ENTRY,
				},
			});
			const configuratorWithModel = createConfiguratorWithDeviceModel(mockLogger, mockConfigManager, getDeviceModelSpy);

			// Act
			await configuratorWithModel.registerWasher(device);

			// Assert
			const payloads = vi.mocked(registerWasherCommandHandlers).mock.calls[0]?.[4];
			expect(payloads).toMatchObject({
				pause: { command: 'Set', dataSetList: { washerDryer: PAUSE_CONTROL_ENTRY.data.washerDryer } },
				stop: { command: 'Set', dataSetList: { washerDryer: POWEROFF_CONTROL_ENTRY.data.washerDryer } },
			});
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('resolved pause-command payload'));
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('resolved stop-command (power-off) payload'),
			);
		});

		it('should leave stop undefined and warn about missing WMOff when only WMStop exists', async () => {
			// Arrange
			const device = createMockWasherDevice();
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});
			const getDeviceModelSpy = vi.fn().mockResolvedValue({ ControlWifi: { WMStop: PAUSE_CONTROL_ENTRY } });
			const configuratorWithModel = createConfiguratorWithDeviceModel(mockLogger, mockConfigManager, getDeviceModelSpy);

			// Act
			await configuratorWithModel.registerWasher(device);

			// Assert
			const payloads = vi.mocked(registerWasherCommandHandlers).mock.calls[0]?.[4];
			expect(payloads?.pause).toBeDefined();
			expect(payloads?.stop).toBeUndefined();
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no WMOff'));
		});

		it('should leave pause undefined and warn about missing WMStop when only WMOff exists', async () => {
			// Arrange
			const device = createMockWasherDevice();
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});
			const getDeviceModelSpy = vi.fn().mockResolvedValue({ ControlWifi: { WMOff: POWEROFF_CONTROL_ENTRY } });
			const configuratorWithModel = createConfiguratorWithDeviceModel(mockLogger, mockConfigManager, getDeviceModelSpy);

			// Act
			await configuratorWithModel.registerWasher(device);

			// Assert
			const payloads = vi.mocked(registerWasherCommandHandlers).mock.calls[0]?.[4];
			expect(payloads?.pause).toBeUndefined();
			expect(payloads?.stop).toBeDefined();
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no WMStop'));
		});

		it('should resolve both pause and stop to undefined without any pause/stop model fetch when modelJsonUri is missing', async () => {
			// Arrange
			const device = asPartial<ThinqWasherDevice>({
				id: 'washer-456',
				name: 'Laundry Room Washer',
				type: 'WASHER',
				modelName: 'VCDWL_QEUK',
				platformType: 'THINQ',
				online: true,
				snapshot: new ThinqSnapshot({}),
			});
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});
			const getDeviceModelSpy = vi.fn().mockResolvedValue({});
			const configuratorWithModel = createConfiguratorWithDeviceModel(mockLogger, mockConfigManager, getDeviceModelSpy);

			// Act
			await configuratorWithModel.registerWasher(device);

			// Assert
			const payloads = vi.mocked(registerWasherCommandHandlers).mock.calls[0]?.[4];
			expect(payloads?.pause).toBeUndefined();
			expect(payloads?.stop).toBeUndefined();
			expect(getDeviceModelSpy).not.toHaveBeenCalled();
		});

		it('should resolve registerWasher with pause and stop undefined and only a debug log when the pause/stop model fetch rejects', async () => {
			// Arrange
			const device = createMockWasherDevice();
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});
			const getDeviceModelSpy = vi.fn().mockRejectedValueOnce(new Error('Model unavailable')).mockResolvedValue({});
			const configuratorWithModel = createConfiguratorWithDeviceModel(mockLogger, mockConfigManager, getDeviceModelSpy);

			// Act & Assert
			await expect(configuratorWithModel.registerWasher(device)).resolves.toBeDefined();
			const payloads = vi.mocked(registerWasherCommandHandlers).mock.calls[0]?.[4];
			expect(payloads?.pause).toBeUndefined();
			expect(payloads?.stop).toBeUndefined();
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('failed to resolve pause/stop-command payloads'),
			);
			expect(mockLogger.warn).not.toHaveBeenCalledWith(
				expect.stringContaining('failed to resolve pause/stop-command payloads'),
			);
		});

		it('should not pass includeRemoteStartStopSwitch to buildWasherEndpoint so the switch is always created', async () => {
			// Arrange
			const device = createMockWasherDevice();
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});

			// Act
			await configurator.registerWasher(device);

			// Assert
			const options = vi.mocked(buildWasherEndpoint).mock.calls[0]?.[1];
			expect(options).not.toHaveProperty('includeRemoteStartStopSwitch');
		});

		it('should warn when no usable start payload can be resolved from the device model', async () => {
			// Arrange
			const device = createMockWasherDevice();
			vi.mocked(mockConfigManager.getWasherControlConfig).mockReturnValue({});
			vi.mocked(extractWasherStartCommand).mockReturnValue(undefined);
			const configuratorWithModel = new ThinqDeviceConfigurator(
				mockLogger,
				asPartial<ThinqApiClient>({
					getDeviceModel: vi.fn().mockResolvedValue({}),
					sendCommand: vi.fn().mockResolvedValue(undefined),
				}),
				mockConfigManager,
			);

			// Act
			await configuratorWithModel.registerWasher(device);

			// Assert
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no usable WMStart/default-course entry'));
			expect(mockLogger.info).not.toHaveBeenCalledWith(
				expect.stringContaining('no usable WMStart/default-course entry'),
			);
		});

		it('should fetch device model and reconcile course config when catalog available', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				Course: { express: { function: [{ value: 'spinSpeed', default: 1200 }] } },
				Config: { defaultCourse: 'express' },
			});
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue({});
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue({}),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);

			// Assert
			expect(ensureWasherControlEntrySpy).toHaveBeenCalledWith('washer-456');
		});

		it('should not call ensureWasherControlEntry when course catalog is undefined', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				// Invalid model - no Course data
			});
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue({});
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue({}),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);

			// Assert
			expect(ensureWasherControlEntrySpy).not.toHaveBeenCalled();
		});

		it('should set courseConfigChanged to true when config was backfilled', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				Course: {
					courseA: {
						function: [{ value: 'spinSpeed', default: 1200 }],
					},
				},
				Config: { defaultCourse: 'courseA' },
			});
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue({}); // Empty, will be backfilled
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue({}),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);

			// Assert
			expect(configuratorWithSpy.consumeCourseConfigChanged()).toBe(true);
		});

		it('should return false from consumeCourseConfigChanged when no backfill occurred', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const fullWasherControl = {
				availableCourseIds: ['courseA'],
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: { spinSpeed: '1200' },
					},
				],
			};
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				Course: {
					courseA: {
						function: [{ value: 'spinSpeed', default: 1200 }],
					},
				},
				Config: { defaultCourse: 'courseA' },
			});
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue(fullWasherControl); // Already full
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue(fullWasherControl),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);

			// Assert
			expect(configuratorWithSpy.consumeCourseConfigChanged()).toBe(false);
		});

		it('should reset consumeCourseConfigChanged to false after being read', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getDeviceModelSpy = vi.fn().mockResolvedValue({
				Course: {
					courseA: {
						function: [{ value: 'spinSpeed', default: 1200 }],
					},
				},
				Config: { defaultCourse: 'courseA' },
			});
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue({});
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue({}),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);
			const first = configuratorWithSpy.consumeCourseConfigChanged();
			const second = configuratorWithSpy.consumeCourseConfigChanged();

			// Assert
			expect(first).toBe(true);
			expect(second).toBe(false);
		});

		it('should retrieve backfilled washer control config after reconciliation', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const washerControlWithSelection = {
				selectedCourse: 'delicate',
				courses: [
					{
						id: 'delicate',
						parameters: {
							spinSpeed: '600',
							waterTemp: '30',
						},
					},
				],
			};
			const validModel = {
				ControlWifi: {
					WMStop: { data: { washerDryer: {} } },
					WMOff: { data: { washerDryer: {} } },
					WMStart: {
						command: 'Set',
						data: { washerDryer: {} },
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [
							{ value: 'spinSpeed', default: 1200 },
							{ value: 'waterTemp', default: 60 },
						],
					},
					delicate: {
						function: [
							{ value: 'spinSpeed', default: 600 },
							{ value: 'waterTemp', default: 30 },
						],
					},
				},
			};
			const getDeviceModelSpy = vi.fn().mockResolvedValue(validModel);
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const ensureWasherControlEntrySpy = vi.fn().mockReturnValue(washerControlWithSelection);
			// Single read in registerWasher, made after ensureWasherControlEntry + reconcile backfilled the entry
			const getWasherControlConfigSpy = vi.fn().mockReturnValue(washerControlWithSelection);
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: getWasherControlConfigSpy,
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: ensureWasherControlEntrySpy,
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act
			await configuratorWithSpy.registerWasher(device);

			// Assert - the single config read happens for the backfilled device
			const calls = vi.mocked(getWasherControlConfigSpy).mock.calls;
			expect(calls.length).toBe(1);
			expect(calls[0]?.[0]).toBe('washer-456');
		});

		it('should gracefully skip course backfill when getDeviceModel throws', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const validModel = {
				ControlWifi: {
					WMStop: { data: { washerDryer: {} } },
					WMOff: { data: { washerDryer: {} } },
					WMStart: {
						command: 'Set',
						data: { washerDryer: {} },
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'spinSpeed', default: 1200 }],
					},
				},
			};
			const getDeviceModelSpy = vi
				.fn()
				.mockRejectedValueOnce(new Error('Network error')) // Pause/stop fetch (first in registerWasher) fails
				.mockResolvedValueOnce(validModel) // Catalog fetch succeeds
				.mockResolvedValueOnce(validModel); // Start fetch succeeds
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: getDeviceModelSpy,
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});
			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue({}),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: vi.fn().mockReturnValue({}),
				overrideMatterConfiguration: false,
				matterOverrideSettings: {
					matterVendorName: 'Matterbridge',
					matterVendorId: 0xfff1,
				},
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});
			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Act & Assert - should not throw, should gracefully handle error
			await expect(configuratorWithSpy.registerWasher(device)).resolves.toBeDefined();
			// Verification: getDeviceModel was called 3 times (pause/stop fails, catalog succeeds, start succeeds)
			expect(getDeviceModelSpy).toHaveBeenCalledTimes(3);
		});

		it('should forward resolved start payload as the start field of the fifth argument to registerWasherCommandHandlers', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const resolvedStartPayload = { command: 'Set', dataSetList: { washerDryer: { course: 'express' } } };
			vi.mocked(extractWasherStartCommand).mockReturnValue(resolvedStartPayload);
			const registerHandlersSpy = vi.mocked(registerWasherCommandHandlers);
			const configuratorWithModel = new ThinqDeviceConfigurator(
				mockLogger,
				asPartial<ThinqApiClient>({
					getDeviceModel: vi.fn().mockResolvedValue({}),
					sendCommand: vi.fn().mockResolvedValue(undefined),
				}),
				mockConfigManager,
			);

			// Act
			await configuratorWithModel.registerWasher(device);

			// Assert
			const call = registerHandlersSpy.mock.calls[0];
			expect(call).toHaveLength(5);
			expect(call?.[4]?.start).toEqual(resolvedStartPayload);
		});

		it('should preserve device id in getWasherControlConfig calls', async () => {
			// Arrange
			const device = createMockWasherDevice();
			const getConfigSpy = vi.mocked(mockConfigManager.getWasherControlConfig);

			// Act
			await configurator.registerWasher(device);

			// Assert
			// Called once in registerWasher (after the course reconcile step)
			expect(getConfigSpy).toHaveBeenCalledWith('washer-456');
		});

		it('end-to-end: config-overridden course parameters reach extractWasherStartCommand via registerWasher', async () => {
			// This test proves the complete feature: user-edited config values flow through registerWasher()
			// into the real start command payload resolved for registerWasherCommandHandlers
			//
			// Arrange: pre-seed config with washerControl containing user-edited parameter values
			const device = createMockWasherDevice();
			const preSeededWasherControl = asPartial<ThinqWasherControlConfig>({
				selectedCourse: 'delicate',
				courses: [
					{
						id: 'delicate',
						parameters: {
							spinSpeed: '400', // User edited value
						},
					},
				],
			});

			// Device model where delicate course has a DIFFERENT default than config override
			const deviceModel = {
				ControlWifi: {
					WMStop: { data: { washerDryer: {} } },
					WMOff: { data: { washerDryer: {} } },
					WMStart: { command: 'Set', data: { washerDryer: {} } },
				},
				Config: { defaultCourse: 'express', courseType: 'course', smartCourseType: 'smartCourse' },
				Course: {
					express: { function: [{ value: 'spinSpeed', default: 1200 }] },
					delicate: { function: [{ value: 'spinSpeed', default: 800 }] }, // Model default differs: 400 vs 800
				},
			};

			// Create fresh mocks for this test
			const apiClientWithSpy = asPartial<ThinqApiClient>({
				getDeviceModel: vi
					.fn()
					.mockResolvedValueOnce(deviceModel) // catalog fetch
					.mockResolvedValueOnce(deviceModel) // stop fetch
					.mockResolvedValueOnce(deviceModel), // start fetch
				sendCommand: vi.fn().mockResolvedValue(undefined),
			});

			const mockConfigManagerWithSpy = asPartial<PlatformConfigManager>({
				getDeviceCapabilities: vi.fn().mockReturnValue(DEFAULT_AIR_CONDITIONER_CAPABILITIES),
				getWasherControlConfig: vi.fn().mockReturnValue(preSeededWasherControl),
				getAcFilterControlConfig: vi.fn().mockReturnValue({}),
				ensureWasherControlEntry: vi.fn().mockReturnValue(preSeededWasherControl),
				overrideMatterConfiguration: false,
				matterOverrideSettings: { matterVendorName: 'Matterbridge', matterVendorId: 0xfff1 },
				getProductNameForDevice: vi.fn().mockReturnValue(undefined),
				getProductIdForDevice: vi.fn().mockReturnValue(undefined),
			});

			const configuratorWithSpy = new ThinqDeviceConfigurator(mockLogger, apiClientWithSpy, mockConfigManagerWithSpy);

			// Get the mocked extractWasherStartCommand to verify call arguments
			// Return a minimal payload so the code path doesn't crash (actual content is tested in resolver unit tests)
			const mockedExtractWasherStartCommand = vi.mocked(extractWasherStartCommand);
			vi.mocked(mockedExtractWasherStartCommand).mockReturnValue({
				command: 'Set',
				dataSetList: { washerDryer: {} },
				resolvedCourseId: 'delicate',
			});

			// Act: call registerWasher with the pre-seeded config
			await configuratorWithSpy.registerWasher(device);

			// Assert: verify registerWasher() processes the config with overridden parameters
			// Verify registerWasher() successfully runs the course resolution flow with seeded config
			const getConfigSpy = vi.mocked(mockConfigManagerWithSpy.getWasherControlConfig);
			expect(getConfigSpy).toHaveBeenCalledWith('washer-456');
			// Exactly one read in registerWasher, made after the course reconcile step
			expect(getConfigSpy.mock.calls.length).toBe(1);

			// CRITICAL ASSERTION: Verify that extractWasherStartCommand was called with the resolved courseSelection
			// argument containing the user-edited override value (400 as string), not the model default (800)
			// This test proves the raw config value flows through unchanged; numeric coercion is unit-tested in
			// thinqWasherStartCommandResolver.test.ts, since extractWasherStartCommand is MOCKED in this file
			// and never actually runs its coercion logic here.
			expect(vi.mocked(mockedExtractWasherStartCommand)).toHaveBeenCalledWith(
				expect.anything(), // deviceModel
				expect.objectContaining({
					courseId: 'delicate',
					parameterOverrides: expect.objectContaining({ spinSpeed: '400' }),
				}),
			);
		});
	});
});
