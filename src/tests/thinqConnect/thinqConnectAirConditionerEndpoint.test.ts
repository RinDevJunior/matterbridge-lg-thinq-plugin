import { MatterbridgeEndpoint, powerSource, roomAirConditioner } from 'matterbridge';
import {
	FanControl,
	HepaFilterMonitoring,
	OnOff,
	RelativeHumidityMeasurement,
	ResourceMonitoring,
	TemperatureMeasurement,
	Thermostat,
} from 'matterbridge/matter/clusters';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
	fahrenheitToCelsius,
	readAirConditionerProfile,
} from '../../services/thinqConnect/thinqConnectAirConditioner.js';
import {
	applyThinqConnectAirConditionerState,
	buildThinqConnectAirConditionerEndpoint,
	mapFanModeToWindStrength,
	mapPercentToWindStrength,
	mapWindStrengthToFanMode,
	mapWindStrengthToPercent,
	resolveFilterChangeIndication,
} from '../../thinqConnect/thinqConnectAirConditionerEndpoint.js';
import type {
	ThinqConnectAirConditioner,
	ThinqConnectAirConditionerService,
	ThinqConnectAirConditionerState,
} from '../../thinqConnect/thinqConnectAirConditionerService.js';
import type { ThinqConnectMatterIdentityOverride } from '../../thinqConnect/thinqConnectMatterIdentity.js';
import { createMockLogger } from '../helpers/testUtils.js';
import { BEDROOM_PROFILE, STUDY_PROFILE } from '../helpers/thinqConnectAirConditionerFixtures.js';

const mocks = vi.hoisted(() => {
	const child = { updateAttribute: vi.fn().mockResolvedValue(undefined) };
	const endpoint = {
		mode: undefined as string | undefined,
		createDefaultIdentifyClusterServer: vi.fn().mockReturnThis(),
		createDefaultBasicInformationClusterServer: vi.fn().mockReturnThis(),
		createDefaultPowerSourceWiredClusterServer: vi.fn().mockReturnThis(),
		createDeadFrontOnOffClusterServer: vi.fn().mockReturnThis(),
		createDefaultCoolingThermostatClusterServer: vi.fn().mockReturnThis(),
		createDefaultThermostatUserInterfaceConfigurationClusterServer: vi.fn().mockReturnThis(),
		createCompleteFanControlClusterServer: vi.fn().mockReturnThis(),
		createDefaultFanControlClusterServer: vi.fn().mockReturnThis(),
		createOnOffFanControlClusterServer: vi.fn().mockReturnThis(),
		addChildDeviceType: vi.fn().mockReturnThis(),
		createDefaultRelativeHumidityMeasurementClusterServer: vi.fn().mockReturnThis(),
		createDefaultHepaFilterMonitoringClusterServer: vi.fn().mockReturnThis(),
		createDefaultTemperatureMeasurementClusterServer: vi.fn().mockReturnThis(),
		addCommandHandler: vi.fn(),
		subscribeAttribute: vi.fn(),
		updateAttribute: vi.fn().mockResolvedValue(undefined),
		getAttribute: vi.fn(),
		getChildEndpointById: vi.fn(),
	};
	return { child, endpoint };
});

vi.mock('matterbridge', () => ({
	MatterbridgeEndpoint: vi.fn(function () {
		return mocks.endpoint;
	}),
	roomAirConditioner: { name: 'roomAirConditioner' },
	powerSource: { name: 'powerSource' },
	humiditySensor: { name: 'humiditySensor' },
}));

type CommandHandler = () => Promise<void>;
type SubscriptionHandler = (newValue: unknown, oldValue: unknown, context: { fabric?: number }) => void;

interface MockService {
	setPower: Mock<ThinqConnectAirConditionerService['setPower']>;
	setCoolMode: Mock<ThinqConnectAirConditionerService['setCoolMode']>;
	setTargetTemperature: Mock<ThinqConnectAirConditionerService['setTargetTemperature']>;
	setWindStrength: Mock<ThinqConnectAirConditionerService['setWindStrength']>;
	setSwing: Mock<ThinqConnectAirConditionerService['setSwing']>;
}

function createMockService(): MockService {
	return {
		setPower: vi.fn<ThinqConnectAirConditionerService['setPower']>(),
		setCoolMode: vi.fn<ThinqConnectAirConditionerService['setCoolMode']>(),
		setTargetTemperature: vi.fn<ThinqConnectAirConditionerService['setTargetTemperature']>(),
		setWindStrength: vi.fn<ThinqConnectAirConditionerService['setWindStrength']>(),
		setSwing: vi.fn<ThinqConnectAirConditionerService['setSwing']>(),
	};
}

function getCommandHandler(name: string): CommandHandler {
	const call = mocks.endpoint.addCommandHandler.mock.calls.find((entry: unknown[]) => entry[0] === name);
	if (!call) {
		throw new Error(`no ${name} handler registered`);
	}
	return call[1] as CommandHandler;
}

function getSubscriber(clusterId: number, attribute: string): SubscriptionHandler {
	const call = mocks.endpoint.subscribeAttribute.mock.calls.find(
		(entry: unknown[]) => entry[0] === clusterId && entry[1] === attribute,
	);
	if (!call) {
		throw new Error(`no subscription for ${attribute}`);
	}
	return call[2] as SubscriptionHandler;
}

function hasSubscriber(clusterId: number, attribute: string): boolean {
	return mocks.endpoint.subscribeAttribute.mock.calls.some(
		(entry: unknown[]) => entry[0] === clusterId && entry[1] === attribute,
	);
}

const LIVE = { fabric: 1 };
const IGNORED = { fabric: undefined };

function buildStudyAc(overrides: Partial<ThinqConnectAirConditioner> = {}): ThinqConnectAirConditioner {
	return {
		deviceId: 'study-ac',
		name: 'Study Room AC',
		profile: readAirConditionerProfile(STUDY_PROFILE),
		...overrides,
	};
}

function buildBedroomAc(overrides: Partial<ThinqConnectAirConditioner> = {}): ThinqConnectAirConditioner {
	return {
		deviceId: 'bedroom-ac',
		name: 'Bedroom AC',
		profile: readAirConditionerProfile(BEDROOM_PROFILE),
		...overrides,
	};
}

describe('thinqConnectAirConditionerEndpoint', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let service: MockService;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		service = createMockService();
		mocks.endpoint.getChildEndpointById.mockReturnValue(mocks.child);
		mocks.endpoint.getAttribute.mockReturnValue(undefined);
		mocks.endpoint.updateAttribute.mockResolvedValue(undefined);
		mocks.endpoint.mode = undefined;
	});

	describe('buildThinqConnectAirConditionerEndpoint construction', () => {
		it('should set the endpoint mode to server so the AC runs as its own Matter node', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Assert
			expect(mocks.endpoint.mode).toBe('server');
		});

		it('should build the Study Room endpoint with a cooling thermostat limited to 16-30 C and no humidity child', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultCoolingThermostatClusterServer).toHaveBeenCalledWith(23, 23, 16, 30);
			expect(mocks.endpoint.addChildDeviceType).not.toHaveBeenCalled();
			expect(mocks.endpoint.createDefaultHepaFilterMonitoringClusterServer).toHaveBeenCalledTimes(1);
		});

		it('should use the Study Room rock support with up/down only and rockRound false', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Assert
			expect(mocks.endpoint.createCompleteFanControlClusterServer).toHaveBeenCalledWith(
				FanControl.FanMode.Auto,
				FanControl.FanModeSequence.OffLowMedHighAuto,
				0,
				0,
				undefined,
				undefined,
				undefined,
				{ rockLeftRight: false, rockUpDown: true, rockRound: false },
				{ rockLeftRight: false, rockUpDown: false, rockRound: false },
			);
		});

		it('should create a humidity child and no filter monitoring for the Bedroom AC', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);

			// Assert
			expect(mocks.endpoint.addChildDeviceType).toHaveBeenCalledWith('HumiditySensor', expect.anything());
			expect(mocks.endpoint.createDefaultRelativeHumidityMeasurementClusterServer).toHaveBeenCalledWith(0);
			expect(mocks.endpoint.createDefaultHepaFilterMonitoringClusterServer).not.toHaveBeenCalled();
		});

		it('should create the TemperatureMeasurement cluster with the initial room temperature in centi-Celsius', () => {
			// Arrange
			const ac = buildStudyAc({ initialState: { currentTemperatureC: 30 } });

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultTemperatureMeasurementClusterServer).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.createDefaultTemperatureMeasurementClusterServer).toHaveBeenCalledWith(3000);
		});

		it('should keep the unclamped 32 C initial room temperature on the Bedroom AC as 3200', () => {
			// Arrange
			const ac = buildBedroomAc({ initialState: { currentTemperatureC: 32 } });

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultTemperatureMeasurementClusterServer).toHaveBeenCalledWith(3200);
		});

		it('should create the TemperatureMeasurement cluster with a null initial value when initialState is absent', () => {
			// Arrange
			const ac = buildStudyAc({ initialState: undefined });

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultTemperatureMeasurementClusterServer).toHaveBeenCalledWith(null);
		});

		it('should create the TemperatureMeasurement cluster with a null initial value when initialState has no currentTemperatureC', () => {
			// Arrange
			const ac = buildStudyAc({ initialState: { powerOn: true } });

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultTemperatureMeasurementClusterServer).toHaveBeenCalledWith(null);
		});

		it('should create no TemperatureMeasurement cluster when the profile has no current temperature', () => {
			// Arrange
			const ac = buildStudyAc({
				profile: { ...readAirConditionerProfile(STUDY_PROFILE), hasCurrentTemperature: false },
			});

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultTemperatureMeasurementClusterServer).not.toHaveBeenCalled();
		});

		it('should enable both swing axes in the Complete fan tier for the Bedroom AC', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);

			// Assert
			expect(mocks.endpoint.createCompleteFanControlClusterServer).toHaveBeenCalledWith(
				FanControl.FanMode.Auto,
				FanControl.FanModeSequence.OffLowMedHighAuto,
				0,
				0,
				undefined,
				undefined,
				undefined,
				{ rockLeftRight: true, rockUpDown: true, rockRound: false },
				expect.anything(),
			);
		});

		it('should use the OnOff fan tier when windStrength is not writable', () => {
			// Arrange
			const ac = buildStudyAc({
				profile: {
					...readAirConditionerProfile(STUDY_PROFILE),
					windStrength: { writable: false, readValues: [], writeValues: [] },
				},
			});

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createOnOffFanControlClusterServer).toHaveBeenCalledWith(FanControl.FanMode.Auto);
			expect(mocks.endpoint.createCompleteFanControlClusterServer).not.toHaveBeenCalled();
			expect(mocks.endpoint.createDefaultFanControlClusterServer).not.toHaveBeenCalled();
			expect(hasSubscriber(FanControl.id, 'fanMode')).toBe(false);
		});

		it('should use the Default fan tier when windStrength is writable but no swing axis is', () => {
			// Arrange
			const profile = readAirConditionerProfile(STUDY_PROFILE);
			const ac = buildStudyAc({ profile: { ...profile, rotateUpDown: false } });

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultFanControlClusterServer).toHaveBeenCalledWith(
				FanControl.FanMode.Auto,
				FanControl.FanModeSequence.OffLowMedHighAuto,
				0,
				0,
			);
			expect(mocks.endpoint.createCompleteFanControlClusterServer).not.toHaveBeenCalled();
		});

		it('should set basic information from the name, deviceId and fixed vendor and product identity', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Assert
			expect(MatterbridgeEndpoint).toHaveBeenCalledWith(expect.anything(), { id: 'StudyRoomAC-study-ac' });
			expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Study Room AC',
				'study-ac',
				0xfff1,
				'Matterbridge',
				0x8000,
				'LG Air Conditioner',
			);
		});

		it('should take initial thermostat values from initialState when present', () => {
			// Arrange
			const ac = buildStudyAc({
				initialState: { powerOn: true, currentTemperatureC: 25, targetTemperatureC: 27 },
			});

			// Act
			buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultCoolingThermostatClusterServer).toHaveBeenCalledWith(25, 27, 16, 30);
		});

		it('should use the midpoint of the limits for initial values when initialState is absent', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc({ initialState: undefined }), service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultCoolingThermostatClusterServer).toHaveBeenCalledWith(23, 23, 16, 30);
		});

		it('should keep the same thermostat limits whether or not initialState is present', () => {
			// Arrange
			const withState = buildStudyAc({ initialState: { currentTemperatureC: 19, targetTemperatureC: 20 } });

			// Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
			buildThinqConnectAirConditionerEndpoint(withState, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultCoolingThermostatClusterServer).toHaveBeenNthCalledWith(1, 23, 23, 16, 30);
			expect(mocks.endpoint.createDefaultCoolingThermostatClusterServer).toHaveBeenNthCalledWith(2, 19, 20, 16, 30);
		});

		it('should register exactly the on and off command handlers plus resetCondition for the Study Room AC', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Assert
			const names = mocks.endpoint.addCommandHandler.mock.calls.map((entry: unknown[]) => entry[0]);
			expect(names).toEqual(['resetCondition', 'on', 'off']);
		});

		it('should register no resetCondition handler for the Bedroom AC', () => {
			// Arrange & Act
			buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);

			// Assert
			const names = mocks.endpoint.addCommandHandler.mock.calls.map((entry: unknown[]) => entry[0]);
			expect(names).toEqual(['on', 'off']);
		});
	});

	describe('on and off command handlers', () => {
		beforeEach(() => {
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
		});

		it('should call setPower with true and write OnOff only after the service resolved', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });

			// Act
			await getCommandHandler('on')();

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'study-ac' }), true);
			expect(mocks.endpoint.updateAttribute.mock.invocationCallOrder[0]).toBeGreaterThan(
				service.setPower.mock.invocationCallOrder[0] ?? 0,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write the real power state back after a refused outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'guard', state: { powerOn: false } });

			// Act
			await getCommandHandler('on')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should write the requested inverse after a failed outcome with empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act
			await getCommandHandler('off')();

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(expect.anything(), false);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should resolve and log the error when setPower rejects', async () => {
			// Arrange
			service.setPower.mockRejectedValue(new Error('service exploded'));

			// Act & Assert
			await expect(getCommandHandler('on')()).resolves.toBeUndefined();
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('service exploded'));
		});

		it('should resolve and log the error when updateAttribute rejects', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });
			mocks.endpoint.updateAttribute.mockRejectedValue(new Error('write failed'));

			// Act & Assert
			await expect(getCommandHandler('on')()).resolves.toBeUndefined();
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
		});
	});

	describe('occupiedCoolingSetpoint subscription', () => {
		beforeEach(() => {
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
		});

		it('should ignore our own attribute echoes when the context has no fabric', () => {
			// Arrange
			const listener = getSubscriber(Thermostat.id, 'occupiedCoolingSetpoint');

			// Act
			listener(2450, 2700, IGNORED);

			// Assert
			expect(service.setTargetTemperature).not.toHaveBeenCalled();
		});

		it('should call setTargetTemperature with 24.5 when a 2450 setpoint is written', async () => {
			// Arrange
			service.setTargetTemperature.mockResolvedValue({ status: 'noop', state: {} });
			const listener = getSubscriber(Thermostat.id, 'occupiedCoolingSetpoint');

			// Act
			listener(2450, 2700, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(service.setTargetTemperature).toHaveBeenCalledWith(expect.anything(), 24.5);
			});
		});

		it('should write the real target back x100 after a refused outcome', async () => {
			// Arrange
			service.setTargetTemperature.mockResolvedValue({
				status: 'refused',
				reason: 'off',
				state: { targetTemperatureC: 27 },
			});
			const listener = getSubscriber(Thermostat.id, 'occupiedCoolingSetpoint');

			// Act
			listener(2000, 2700, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
					Thermostat.id,
					'occupiedCoolingSetpoint',
					2700,
					logger,
				);
			});
		});

		it('should log the error and not throw when setTargetTemperature rejects', async () => {
			// Arrange
			service.setTargetTemperature.mockRejectedValue(new Error('target boom'));
			const listener = getSubscriber(Thermostat.id, 'occupiedCoolingSetpoint');

			// Act & Assert
			expect(() => listener(2450, 2700, LIVE)).not.toThrow();
			await vi.waitFor(() => {
				expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('target boom'));
			});
		});

		it('should revert the setpoint to the old value after a failed outcome with empty state', async () => {
			// Arrange
			service.setTargetTemperature.mockResolvedValue({ status: 'failed', error: 'net', state: {} });
			const listener = getSubscriber(Thermostat.id, 'occupiedCoolingSetpoint');

			// Act
			listener(2000, 2700, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
					Thermostat.id,
					'occupiedCoolingSetpoint',
					2700,
					logger,
				);
			});
		});
	});

	describe('systemMode subscription', () => {
		beforeEach(() => {
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
		});

		it('should call setPower with false when systemMode is set to Off', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: false } });
			const listener = getSubscriber(Thermostat.id, 'systemMode');

			// Act
			listener(Thermostat.SystemMode.Off, Thermostat.SystemMode.Cool, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(service.setPower).toHaveBeenCalledWith(expect.anything(), false);
			});
		});

		it('should call setCoolMode when systemMode is set to Cool', async () => {
			// Arrange
			service.setCoolMode.mockResolvedValue({ status: 'noop', state: { powerOn: true } });
			const listener = getSubscriber(Thermostat.id, 'systemMode');

			// Act
			listener(Thermostat.SystemMode.Cool, Thermostat.SystemMode.Off, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(service.setCoolMode).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'study-ac' }));
			});
		});

		it.each([
			['Auto', Thermostat.SystemMode.Auto],
			['Heat', Thermostat.SystemMode.Heat],
			['Dry', Thermostat.SystemMode.Dry],
			['FanOnly', Thermostat.SystemMode.FanOnly],
		])('should not call the service and revert to the old value when systemMode is %s', (_label, mode) => {
			// Arrange
			const listener = getSubscriber(Thermostat.id, 'systemMode');

			// Act
			listener(mode, Thermostat.SystemMode.Off, LIVE);

			// Assert
			expect(service.setPower).not.toHaveBeenCalled();
			expect(service.setCoolMode).not.toHaveBeenCalled();
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Off,
				logger,
			);
		});

		it('should revert systemMode to the old value when the Off request fails with empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'net', state: {} });
			const listener = getSubscriber(Thermostat.id, 'systemMode');

			// Act
			listener(Thermostat.SystemMode.Off, Thermostat.SystemMode.Cool, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
					Thermostat.id,
					'systemMode',
					Thermostat.SystemMode.Cool,
					logger,
				);
			});
		});
	});

	describe('fanMode and percentSetting subscriptions', () => {
		beforeEach(() => {
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
			service.setWindStrength.mockResolvedValue({ status: 'noop', state: {} });
		});

		it.each([
			['Low', FanControl.FanMode.Low, 'LOW'],
			['Medium', FanControl.FanMode.Medium, 'MID'],
			['High', FanControl.FanMode.High, 'HIGH'],
			['Auto', FanControl.FanMode.Auto, 'AUTO'],
		])('should call setWindStrength with the mapped strength when fanMode is %s', async (_label, mode, strength) => {
			// Arrange
			const listener = getSubscriber(FanControl.id, 'fanMode');

			// Act
			listener(mode, FanControl.FanMode.Off, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(service.setWindStrength).toHaveBeenCalledWith(expect.anything(), strength);
			});
		});

		it.each([
			['Off', FanControl.FanMode.Off],
			['On', FanControl.FanMode.On],
		])('should not call the service and revert the old fanMode when fanMode is %s', (_label, mode) => {
			// Arrange
			const listener = getSubscriber(FanControl.id, 'fanMode');

			// Act
			listener(mode, FanControl.FanMode.High, LIVE);

			// Assert
			expect(service.setWindStrength).not.toHaveBeenCalled();
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'fanMode',
				FanControl.FanMode.High,
				logger,
			);
		});

		it.each([
			[20, 'LOW'],
			[50, 'MID'],
			[90, 'HIGH'],
		])('should call setWindStrength %s percent as %s', async (percent, strength) => {
			// Arrange
			const listener = getSubscriber(FanControl.id, 'percentSetting');

			// Act
			listener(percent, 0, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(service.setWindStrength).toHaveBeenCalledWith(expect.anything(), strength);
			});
		});

		it.each([
			['0', 0],
			['null', null],
		])('should not call the service and revert the old percent when percentSetting is %s', (_label, percent) => {
			// Arrange
			const listener = getSubscriber(FanControl.id, 'percentSetting');

			// Act
			listener(percent, 50, LIVE);

			// Assert
			expect(service.setWindStrength).not.toHaveBeenCalled();
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(FanControl.id, 'percentSetting', 50, logger);
		});

		it('should revert fanMode to the old value when the request fails with empty state', async () => {
			// Arrange
			service.setWindStrength.mockResolvedValue({ status: 'failed', error: 'net', state: {} });
			const listener = getSubscriber(FanControl.id, 'fanMode');

			// Act
			listener(FanControl.FanMode.High, FanControl.FanMode.Low, LIVE);

			// Assert
			await vi.waitFor(() => {
				expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
					FanControl.id,
					'fanMode',
					FanControl.FanMode.Low,
					logger,
				);
			});
		});
	});

	describe('rockSetting subscription', () => {
		beforeEach(() => {
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
		});

		it('should call setSwing with rotateUpDown true when the up/down axis flips on', async () => {
			// Arrange
			service.setSwing.mockResolvedValue({ status: 'sent', state: { rotateUpDown: true } });
			const listener = getSubscriber(FanControl.id, 'rockSetting');

			// Act
			listener(
				{ rockUpDown: true, rockLeftRight: false, rockRound: false },
				{ rockUpDown: false, rockLeftRight: false, rockRound: false },
				LIVE,
			);

			// Assert
			await vi.waitFor(() => {
				expect(service.setSwing).toHaveBeenCalledWith(expect.anything(), { rotateUpDown: true });
			});
		});

		it('should ignore a left/right flip on the Study Room AC', () => {
			// Arrange
			const listener = getSubscriber(FanControl.id, 'rockSetting');

			// Act
			listener(
				{ rockUpDown: false, rockLeftRight: true, rockRound: false },
				{ rockUpDown: false, rockLeftRight: false, rockRound: false },
				LIVE,
			);

			// Assert
			expect(service.setSwing).not.toHaveBeenCalled();
		});

		it('should ignore a rockRound-only change', () => {
			// Arrange
			const listener = getSubscriber(FanControl.id, 'rockSetting');

			// Act
			listener(
				{ rockUpDown: false, rockLeftRight: false, rockRound: true },
				{ rockUpDown: false, rockLeftRight: false, rockRound: false },
				LIVE,
			);

			// Assert
			expect(service.setSwing).not.toHaveBeenCalled();
		});

		it('should write the real rockSetting back after a refused swing request', async () => {
			// Arrange
			service.setSwing.mockResolvedValue({ status: 'refused', reason: 'off', state: { rotateUpDown: false } });
			const listener = getSubscriber(FanControl.id, 'rockSetting');

			// Act
			listener(
				{ rockUpDown: true, rockLeftRight: false, rockRound: false },
				{ rockUpDown: false, rockLeftRight: false, rockRound: false },
				LIVE,
			);

			// Assert
			await vi.waitFor(() => {
				expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
					FanControl.id,
					'rockSetting',
					{ rockUpDown: false, rockLeftRight: false, rockRound: false },
					logger,
				);
			});
		});
	});

	describe('resetCondition handler', () => {
		beforeEach(() => {
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);
		});

		it('should reject with a message that mentions the ThinQ Connect API and log a warning', async () => {
			// Arrange
			const handler = getCommandHandler('resetCondition');

			// Act & Assert
			await expect(handler()).rejects.toThrow(/ThinQ Connect API/);
			expect(logger.warn).toHaveBeenCalledTimes(1);
		});

		it('should write no attribute when a reset is refused', async () => {
			// Arrange
			const handler = getCommandHandler('resetCondition');

			// Act
			await expect(handler()).rejects.toThrow();

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});
	});

	describe('applyThinqConnectAirConditionerState', () => {
		const STUDY_FULL_STATE: ThinqConnectAirConditionerState = {
			powerOn: true,
			jobMode: 'COOL',
			temperatureUnit: 'C',
			currentTemperatureC: 30,
			targetTemperatureC: 27,
			windStrength: 'HIGH',
			rotateUpDown: false,
			filterRemainingPercent: 94,
		};

		it('should write the full Study Room state to the Matter clusters', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), STUDY_FULL_STATE, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Cool,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 3000, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'occupiedCoolingSetpoint',
				2700,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'fanMode',
				FanControl.FanMode.High,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 90, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{ rockUpDown: false, rockLeftRight: false, rockRound: false },
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(HepaFilterMonitoring.id, 'condition', 94, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				HepaFilterMonitoring.id,
				'changeIndication',
				ResourceMonitoring.ChangeIndication.Ok,
				logger,
			);
		});

		it('should write systemMode Off when powerOn is false', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { powerOn: false }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Off,
				logger,
			);
		});

		it('should write neither OnOff nor systemMode when powerOn is undefined', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { currentTemperatureC: 25 }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(OnOff.id, 'onOff', expect.anything(), logger);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				expect.anything(),
				logger,
			);
		});

		it('should write fanMode Auto and no percent values when the wind strength is AUTO', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { windStrength: 'AUTO' }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'fanMode',
				FanControl.FanMode.Auto,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				FanControl.id,
				'percentCurrent',
				expect.anything(),
				logger,
			);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				FanControl.id,
				'percentSetting',
				expect.anything(),
				logger,
			);
		});

		it('should keep the other swing axis from the current attribute when only one axis is in the state', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);
			mocks.endpoint.getAttribute.mockReturnValue({ rockUpDown: false, rockLeftRight: true, rockRound: false });

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildBedroomAc(), { rotateUpDown: true }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{ rockUpDown: true, rockLeftRight: true, rockRound: false },
				logger,
			);
		});

		it('should write the humidity child measuredValue as 7000 for 70 percent on the Bedroom AC', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildBedroomAc(), { humidityPercent: 70 }, logger);

			// Assert
			expect(mocks.child.updateAttribute).toHaveBeenCalledWith(
				RelativeHumidityMeasurement.id,
				'measuredValue',
				7000,
				logger,
			);
		});

		it('should write no humidity value when the endpoint has no humidity child', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);
			mocks.endpoint.getChildEndpointById.mockReturnValue(undefined);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildBedroomAc(), { humidityPercent: 70 }, logger);

			// Assert
			expect(mocks.child.updateAttribute).not.toHaveBeenCalled();
		});

		it.each([
			[5, ResourceMonitoring.ChangeIndication.Warning],
			[0, ResourceMonitoring.ChangeIndication.Critical],
		])('should set filter changeIndication for %s percent remaining', async (percent, indication) => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { filterRemainingPercent: percent }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				HepaFilterMonitoring.id,
				'condition',
				percent,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				HepaFilterMonitoring.id,
				'changeIndication',
				indication,
				logger,
			);
		});

		it('should write measuredValue 3000 alongside localTemperature 3000 for 30 C', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { currentTemperatureC: 30 }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 3000, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				TemperatureMeasurement.id,
				'measuredValue',
				3000,
				logger,
			);
		});

		it.each([
			['22.4 C', 22.4, 2240],
			['22.456 C (rounded to an integer)', 22.456, 2246],
			['80 F converted to 26.67 C', fahrenheitToCelsius(80), 2667],
		])('should write measuredValue %s as %i', async (_label, celsius, expected) => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { currentTemperatureC: celsius }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				TemperatureMeasurement.id,
				'measuredValue',
				expected,
				logger,
			);
		});

		it('should write the unclamped 32 C measuredValue as 3200 on the Bedroom AC', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildBedroomAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildBedroomAc(), { currentTemperatureC: 32 }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				TemperatureMeasurement.id,
				'measuredValue',
				3200,
				logger,
			);
		});

		it('should write no measuredValue when currentTemperatureC is undefined', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), { targetTemperatureC: 25 }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				TemperatureMeasurement.id,
				'measuredValue',
				expect.anything(),
				logger,
			);
		});

		it('should write no measuredValue but still write localTemperature when the profile has no current temperature', async () => {
			// Arrange
			const ac = buildStudyAc({
				profile: { ...readAirConditionerProfile(STUDY_PROFILE), hasCurrentTemperature: false },
			});
			const endpoint = buildThinqConnectAirConditionerEndpoint(ac, service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, ac, { currentTemperatureC: 30 }, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
				TemperatureMeasurement.id,
				'measuredValue',
				expect.anything(),
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 3000, logger);
		});

		it('should write nothing for an empty state', async () => {
			// Arrange
			const endpoint = buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger);

			// Act
			await applyThinqConnectAirConditionerState(endpoint, buildStudyAc(), {}, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});
	});

	describe('mapping functions', () => {
		it.each([
			['LOW', FanControl.FanMode.Low],
			['MID', FanControl.FanMode.Medium],
			['HIGH', FanControl.FanMode.High],
			['AUTO', FanControl.FanMode.Auto],
			['NATURE', undefined],
			[undefined, undefined],
		])('should map wind strength %s to fan mode %s', (strength, mode) => {
			// Arrange & Act
			const result = mapWindStrengthToFanMode(strength);

			// Assert
			expect(result).toBe(mode);
		});

		it.each([
			[FanControl.FanMode.Low, 'LOW'],
			[FanControl.FanMode.Medium, 'MID'],
			[FanControl.FanMode.High, 'HIGH'],
			[FanControl.FanMode.Auto, 'AUTO'],
			[FanControl.FanMode.Off, undefined],
		])('should map fan mode %s back to wind strength %s', (mode, strength) => {
			// Arrange & Act
			const result = mapFanModeToWindStrength(mode);

			// Assert
			expect(result).toBe(strength);
		});

		it.each([
			[0, undefined],
			[1, 'LOW'],
			[33, 'LOW'],
			[34, 'MID'],
			[66, 'MID'],
			[67, 'HIGH'],
			[100, 'HIGH'],
		])('should map percent %s to wind strength %s', (percent, strength) => {
			// Arrange & Act
			const result = mapPercentToWindStrength(percent);

			// Assert
			expect(result).toBe(strength);
		});

		it.each([
			['LOW', 20],
			['MID', 50],
			['HIGH', 90],
			['AUTO', undefined],
			[undefined, undefined],
		])('should map wind strength %s to percent %s', (strength, percent) => {
			// Arrange & Act
			const result = mapWindStrengthToPercent(strength);

			// Assert
			expect(result).toBe(percent);
		});

		it.each([
			[0, ResourceMonitoring.ChangeIndication.Critical],
			[1, ResourceMonitoring.ChangeIndication.Warning],
			[10, ResourceMonitoring.ChangeIndication.Warning],
			[11, ResourceMonitoring.ChangeIndication.Ok],
			[100, ResourceMonitoring.ChangeIndication.Ok],
		])('should map %s percent remaining to change indication %s', (percent, indication) => {
			// Arrange & Act
			const result = resolveFilterChangeIndication(percent);

			// Assert
			expect(result).toBe(indication);
		});
	});

	describe('buildThinqConnectAirConditionerEndpoint identity overrides', () => {
		const AC_IDENTITY_CASES: {
			field: string;
			identity: ThinqConnectMatterIdentityOverride;
			expected: [number, string, number, string];
		}[] = [
			{
				field: 'no override (defaults)',
				identity: {},
				expected: [0xfff1, 'Matterbridge', 0x8000, 'LG Air Conditioner'],
			},
			{
				field: 'vendorId',
				identity: { vendorId: 0x1234 },
				expected: [0x1234, 'Matterbridge', 0x8000, 'LG Air Conditioner'],
			},
			{
				field: 'vendorName',
				identity: { vendorName: 'Acme' },
				expected: [0xfff1, 'Acme', 0x8000, 'LG Air Conditioner'],
			},
			{
				field: 'productId',
				identity: { productId: 0x8123 },
				expected: [0xfff1, 'Matterbridge', 0x8123, 'LG Air Conditioner'],
			},
			{
				field: 'productName',
				identity: { productName: 'Study AC' },
				expected: [0xfff1, 'Matterbridge', 0x8000, 'Study AC'],
			},
			{
				field: 'undefined vendorId falls back to default',
				identity: { vendorId: undefined, productName: 'Study AC' },
				expected: [0xfff1, 'Matterbridge', 0x8000, 'Study AC'],
			},
		];

		it.each(AC_IDENTITY_CASES)(
			'should apply only the $field identity field to basic information',
			({ identity, expected }) => {
				// Arrange & Act
				buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger, identity);

				// Assert
				expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
					'Study Room AC',
					'study-ac',
					...expected,
				);
			},
		);

		it('should keep the deviceId as serial number and the name-deviceId as uniqueId when every identity field is overridden', () => {
			// Arrange
			const identity: ThinqConnectMatterIdentityOverride = {
				vendorId: 0x1234,
				vendorName: 'Acme',
				productId: 0x8123,
				productName: 'Study AC',
			};

			// Act
			buildThinqConnectAirConditionerEndpoint(buildStudyAc(), service, logger, identity);

			// Assert
			expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Study Room AC',
				'study-ac',
				0x1234,
				'Acme',
				0x8123,
				'Study AC',
			);
			expect(vi.mocked(MatterbridgeEndpoint)).toHaveBeenCalledWith(
				[roomAirConditioner, powerSource],
				expect.objectContaining({ id: 'StudyRoomAC-study-ac' }),
			);
		});
	});
});
