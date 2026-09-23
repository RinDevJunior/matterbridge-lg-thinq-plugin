import {
	AirQuality,
	ElectricalPowerMeasurement,
	FanControl,
	OnOff,
	Pm10ConcentrationMeasurement,
	Pm25ConcentrationMeasurement,
	RelativeHumidityMeasurement,
	TemperatureMeasurement,
	Thermostat,
} from 'matterbridge/matter/clusters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AirConditionerCapabilities } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { DEFAULT_AIR_CONDITIONER_CAPABILITIES } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import {
	applyThinqSnapshotToAirConditioner,
	mapOperationModeToSystemMode,
	mapWindStrengthToPercent,
} from '../../../platform/thinq/thinqAirConditionerStateSync.js';
import { createMockLogger } from '../../helpers/testUtils.js';

describe('applyThinqSnapshotToAirConditioner', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let airConditioner: any;
	let capabilities: AirConditionerCapabilities;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES;

		airConditioner = {
			id: 0x01,
			name: 'Living Room AC',
			log: mockLogger,
			updateAttribute: vi.fn().mockResolvedValue(false),
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should update all attributes with full snapshot when powered on with all values defined', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0, // COOL
			'airState.windStrength': 2, // LOW
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(TemperatureMeasurement.id, 'measuredValue', 2200, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 2200, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedCoolingSetpoint', 2400, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedHeatingSetpoint', 2400, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(
			Thermostat.id,
			'systemMode',
			Thermostat.SystemMode.Cool,
			mockLogger,
		);
		expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'fanMode', FanControl.FanMode.Low, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
	});

	it('should set systemMode to Off when power is off', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({
			'airState.operation': 0,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0, // COOL - ignored when powered off
			'airState.windStrength': 2,
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'systemMode', Thermostat.SystemMode.Off, mockLogger);
	});

	it('should skip measuredValue and localTemperature updates when currentTemperatureCelsius is undefined', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		const calls = updateAttributeSpy.mock.calls;
		const hasTemperatureMeasurement = calls.some(
			(call) => call[0] === TemperatureMeasurement.id && call[1] === 'measuredValue',
		);
		const hasLocalTemp = calls.some((call) => call[0] === Thermostat.id && call[1] === 'localTemperature');

		expect(hasTemperatureMeasurement).toBe(false);
		expect(hasLocalTemp).toBe(false);
	});

	it('should skip setpoint updates when targetTemperatureCelsius is undefined', async () => {
		// Arrange
		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.opMode': 0,
			'airState.windStrength': 2,
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		const calls = updateAttributeSpy.mock.calls;
		const hasCoolingSetpoint = calls.some((call) => call[0] === Thermostat.id && call[1] === 'occupiedCoolingSetpoint');
		const hasHeatingSetpoint = calls.some((call) => call[0] === Thermostat.id && call[1] === 'occupiedHeatingSetpoint');

		expect(hasCoolingSetpoint).toBe(false);
		expect(hasHeatingSetpoint).toBe(false);
	});

	it('should not update occupiedHeatingSetpoint when capabilities.supportsHeat is false', async () => {
		// Arrange
		const noHeatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: false,
		};

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, noHeatCapabilities, mockLogger);

		// Assert
		const calls = updateAttributeSpy.mock.calls;
		const hasHeatingSetpoint = calls.some((call) => call[0] === Thermostat.id && call[1] === 'occupiedHeatingSetpoint');

		expect(hasHeatingSetpoint).toBe(false);
	});

	it('should not update fan attributes when supportsFanSpeedControl is false', async () => {
		// Arrange
		const noFanCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsFanSpeedControl: false,
		};

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, noFanCapabilities, mockLogger);

		// Assert
		const calls = updateAttributeSpy.mock.calls;
		const hasPercentCurrent = calls.some((call: any[]) => call[0] === FanControl.id && call[1] === 'percentCurrent');

		// Should have fanMode but mapped to fixed mode
		expect(calls.some((call: any[]) => call[0] === FanControl.id && call[1] === 'fanMode')).toBe(true);
		// Should not have percentCurrent
		expect(hasPercentCurrent).toBe(false);
	});
});

describe('mapWindStrengthToPercent', () => {
	it('should map LOW windStrength to 20 percent', () => {
		// Act & Assert
		expect(mapWindStrengthToPercent(2)).toBe(20);
	});

	it('should map MEDIUM windStrength to 50 percent', () => {
		// Act & Assert
		expect(mapWindStrengthToPercent(4)).toBe(50);
	});

	it('should map HIGH windStrength to 90 percent', () => {
		// Act & Assert
		expect(mapWindStrengthToPercent(6)).toBe(90);
	});

	it('should map AUTO windStrength to undefined', () => {
		// Act & Assert
		expect(mapWindStrengthToPercent(8)).toBeUndefined();
	});

	it('should return undefined when windStrength is undefined', () => {
		// Act & Assert
		expect(mapWindStrengthToPercent(undefined)).toBeUndefined();
	});
});

describe('mapOperationModeToSystemMode', () => {
	let capabilities: AirConditionerCapabilities;

	beforeEach(() => {
		capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES;
	});

	it('should return SystemMode.Off when powered off regardless of operation mode', () => {
		// Act & Assert
		expect(mapOperationModeToSystemMode(0, false, capabilities)).toBe(Thermostat.SystemMode.Off);
		expect(mapOperationModeToSystemMode(4, false, capabilities)).toBe(Thermostat.SystemMode.Off);
		expect(mapOperationModeToSystemMode(undefined, false, capabilities)).toBe(Thermostat.SystemMode.Off);
	});

	it('should map opMode 0 (COOL) to SystemMode.Cool', () => {
		// Act & Assert
		expect(mapOperationModeToSystemMode(0, true, capabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map opMode 1 (DRY) to SystemMode.Cool (Apple Home has no Dry slot)', () => {
		// Act & Assert
		// Note: supportsDry is irrelevant; Dry always collapses to Cool for Apple Home compatibility
		expect(mapOperationModeToSystemMode(1, true, capabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map opMode 2 (FAN) to SystemMode.Cool (Apple Home has no FanOnly slot)', () => {
		// Act & Assert
		expect(mapOperationModeToSystemMode(2, true, capabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map opMode 4 (HEAT) to SystemMode.Heat when supported', () => {
		// Act & Assert
		const heatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: true,
		};
		expect(mapOperationModeToSystemMode(4, true, heatCapabilities)).toBe(Thermostat.SystemMode.Heat);
	});

	it('should map opMode 4 (HEAT) to SystemMode.Cool when not supported', () => {
		// Act & Assert
		const noHeatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: false,
		};
		expect(mapOperationModeToSystemMode(4, true, noHeatCapabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map opMode 5 (AIR_CLEAN) to SystemMode.Auto when heat supported', () => {
		// Act & Assert
		const heatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: true,
		};
		expect(mapOperationModeToSystemMode(5, true, heatCapabilities)).toBe(Thermostat.SystemMode.Auto);
	});

	it('should map opMode 5 (AIR_CLEAN) to SystemMode.Cool when heat not supported', () => {
		// Act & Assert
		const noHeatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: false,
		};
		expect(mapOperationModeToSystemMode(5, true, noHeatCapabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map opMode 6 (AUTO) to SystemMode.Auto when heat supported', () => {
		// Act & Assert
		const heatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: true,
		};
		expect(mapOperationModeToSystemMode(6, true, heatCapabilities)).toBe(Thermostat.SystemMode.Auto);
	});

	it('should map opMode 6 (AUTO) to SystemMode.Cool when heat not supported', () => {
		// Act & Assert
		const noHeatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: false,
		};
		expect(mapOperationModeToSystemMode(6, true, noHeatCapabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map unknown opMode to SystemMode.Auto when heat supported', () => {
		// Act & Assert
		const heatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: true,
		};
		expect(mapOperationModeToSystemMode(999, true, heatCapabilities)).toBe(Thermostat.SystemMode.Auto);
	});

	it('should map unknown opMode to SystemMode.Cool when heat not supported', () => {
		// Act & Assert
		const noHeatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: false,
		};
		expect(mapOperationModeToSystemMode(999, true, noHeatCapabilities)).toBe(Thermostat.SystemMode.Cool);
	});

	it('should map undefined opMode to SystemMode.Auto when heat supported', () => {
		// Act & Assert
		const heatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: true,
		};
		expect(mapOperationModeToSystemMode(undefined, true, heatCapabilities)).toBe(Thermostat.SystemMode.Auto);
	});

	it('should map undefined opMode to SystemMode.Cool when heat not supported', () => {
		// Act & Assert
		const noHeatCapabilities: AirConditionerCapabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsHeat: false,
		};
		expect(mapOperationModeToSystemMode(undefined, true, noHeatCapabilities)).toBe(Thermostat.SystemMode.Cool);
	});
});

describe('applyThinqSnapshotToAirConditioner with auxiliary toggles (Phase A)', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let airConditioner: any;
	let capabilities: AirConditionerCapabilities;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();

		airConditioner = {
			id: 0x01,
			name: 'Living Room AC',
			log: mockLogger,
			updateAttribute: vi.fn().mockResolvedValue(false),
			getChildEndpointById: vi.fn(),
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should update jet mode toggle when supportsJetMode is enabled and snapshot has value', async () => {
		// Arrange
		capabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsJetMode: true,
		};

		const mockChild = {
			updateAttribute: vi.fn().mockResolvedValue(false),
		};
		airConditioner.getChildEndpointById.mockReturnValue(mockChild);

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
			'airState.wMode.jet': 1,
		});

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('JetMode');
		expect(mockChild.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
	});

	it('should update quiet mode toggle when supportsQuietMode is enabled', async () => {
		// Arrange
		capabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsQuietMode: true,
		};

		const mockChild = {
			updateAttribute: vi.fn().mockResolvedValue(false),
		};
		airConditioner.getChildEndpointById.mockReturnValue(mockChild);

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
			'airState.miscFuncState.silentAWHP': 0,
		});

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('QuietMode');
		expect(mockChild.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, mockLogger);
	});

	it('should not update jet mode toggle when supportsJetMode is disabled', async () => {
		// Arrange
		capabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsJetMode: false,
		};

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
			'airState.wMode.jet': 1,
		});

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		expect(airConditioner.getChildEndpointById).not.toHaveBeenCalledWith('JetMode');
	});

	it('should update all enabled auxiliary toggles in a single snapshot', async () => {
		// Arrange
		capabilities = {
			...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
			supportsJetMode: true,
			supportsQuietMode: true,
			supportsEnergySaveMode: true,
			supportsAirCleanMode: true,
			supportsLedControl: true,
		};

		const mockChild = {
			updateAttribute: vi.fn().mockResolvedValue(false),
		};
		airConditioner.getChildEndpointById.mockReturnValue(mockChild);

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0,
			'airState.windStrength': 2,
			'airState.wMode.jet': 1,
			'airState.miscFuncState.silentAWHP': 1,
			'airState.powerSave.basic': 0,
			'airState.wMode.airClean': 1,
			'airState.lightingState.displayControl': 0,
		});

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('JetMode');
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('QuietMode');
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('EnergySaveMode');
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('AirCleanMode');
		expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('LedLight');
	});

	it('should maintain full regression parity with default capabilities (all toggles disabled)', async () => {
		// Arrange
		capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES; // all new flags = false

		const snapshot = new ThinqSnapshot({
			'airState.operation': 1,
			'airState.tempState.current': 22,
			'airState.tempState.target': 24,
			'airState.opMode': 0, // COOL
			'airState.windStrength': 2, // LOW
		});

		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		// Act
		await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

		// Assert - only the existing attributes should be updated
		expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(TemperatureMeasurement.id, 'measuredValue', 2200, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 2200, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedCoolingSetpoint', 2400, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedHeatingSetpoint', 2400, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(
			Thermostat.id,
			'systemMode',
			Thermostat.SystemMode.Cool,
			mockLogger,
		);
		expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'fanMode', FanControl.FanMode.Low, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
		// No child endpoint calls should happen
		expect(airConditioner.getChildEndpointById).not.toHaveBeenCalled();
	});

	describe('applyThinqSnapshotToAirConditioner with rockSetting (Phase B)', () => {
		let mockLogger: ReturnType<typeof createMockLogger>;
		let airConditioner: any;
		let capabilities: AirConditionerCapabilities;

		beforeEach(() => {
			vi.clearAllMocks();
			mockLogger = createMockLogger();

			airConditioner = {
				id: 0x01,
				name: 'Living Room AC',
				log: mockLogger,
				updateAttribute: vi.fn().mockResolvedValue(false),
			};
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it('should update rockSetting when supportsSwingMode is true with both axes on', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
				'airState.wDir.vStep': 100,
				'airState.wDir.hStep': 100,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{
					rockLeftRight: true,
					rockUpDown: true,
					rockRound: true,
				},
				mockLogger,
			);
		});

		it('should update rockSetting with vertical swing only', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
				'airState.wDir.vStep': 100,
				'airState.wDir.hStep': 0,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{
					rockLeftRight: false,
					rockUpDown: true,
					rockRound: false,
				},
				mockLogger,
			);
		});

		it('should update rockSetting with horizontal swing only', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
				'airState.wDir.vStep': 0,
				'airState.wDir.hStep': 100,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{
					rockLeftRight: true,
					rockUpDown: false,
					rockRound: false,
				},
				mockLogger,
			);
		});

		it('should update rockSetting with both axes off', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
				'airState.wDir.vStep': 0,
				'airState.wDir.hStep': 0,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{
					rockLeftRight: false,
					rockUpDown: false,
					rockRound: false,
				},
				mockLogger,
			);
		});

		it('should not update rockSetting when supportsSwingMode is false', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: false,
			};

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
				'airState.wDir.vStep': 100,
				'airState.wDir.hStep': 100,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const rockSettingCalls = updateAttributeSpy.mock.calls.filter(
				(call: any[]) => call[0] === FanControl.id && call[1] === 'rockSetting',
			);
			expect(rockSettingCalls).toHaveLength(0);
		});

		it('should handle string values for swing steps (100 as string)', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsSwingMode: true,
			};

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
				'airState.wDir.vStep': '100',
				'airState.wDir.hStep': '100',
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{
					rockLeftRight: true,
					rockUpDown: true,
					rockRound: true,
				},
				mockLogger,
			);
		});

		it('should maintain parity with existing attributes when supportsSwingMode is false', async () => {
			// Arrange - regression test: all capabilities at default (false for new features)
			capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES;

			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert - existing attributes unchanged
			expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(TemperatureMeasurement.id, 'measuredValue', 2200, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 2200, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedCoolingSetpoint', 2400, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedHeatingSetpoint', 2400, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Cool,
				mockLogger,
			);
			expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'fanMode', FanControl.FanMode.Low, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
			// rockSetting should NOT be called
			const rockSettingCalls = updateAttributeSpy.mock.calls.filter(
				(call: any[]) => call[0] === FanControl.id && call[1] === 'rockSetting',
			);
			expect(rockSettingCalls).toHaveLength(0);
		});

		describe('applyThinqSnapshotToAirConditioner with humidity and air quality sensors (Phase C)', () => {
			let mockLogger: ReturnType<typeof createMockLogger>;
			let airConditioner: any;
			let capabilities: AirConditionerCapabilities;

			beforeEach(() => {
				vi.clearAllMocks();
				mockLogger = createMockLogger();

				airConditioner = {
					id: 0x01,
					name: 'Living Room AC',
					log: mockLogger,
					updateAttribute: vi.fn().mockResolvedValue(false),
					getChildEndpointById: vi.fn(),
				};
			});

			afterEach(() => {
				vi.clearAllMocks();
			});

			it('should update humidity sensor when supportsHumiditySensor is enabled and humidityPercent is defined', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsHumiditySensor: true,
				};

				const mockChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				airConditioner.getChildEndpointById.mockReturnValue(mockChild);

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.humidity.current': 65,
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('HumiditySensor');
				expect(mockChild.updateAttribute).toHaveBeenCalledWith(expect.any(Number), 'measuredValue', 6500, mockLogger);
			});

			it('should apply humidity heuristic when value > 100', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsHumiditySensor: true,
				};

				const mockChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				airConditioner.getChildEndpointById.mockReturnValue(mockChild);

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.humidity.current': 650,
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(mockChild.updateAttribute).toHaveBeenCalledWith(
					expect.any(Number),
					'measuredValue',
					6500, // 65 * 100
					mockLogger,
				);
			});

			it('should not push humidity sensor when humidityPercent is undefined even if capability is enabled', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsHumiditySensor: true,
				};

				const mockChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				airConditioner.getChildEndpointById.mockReturnValue(mockChild);

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					// humidity key absent
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				// Child should not be retrieved since humidity is undefined (defensive check prevents child lookup)
				expect(airConditioner.getChildEndpointById).not.toHaveBeenCalledWith('HumiditySensor');
				expect(mockChild.updateAttribute).not.toHaveBeenCalled();
			});

			it('should not attempt humidity push when supportsHumiditySensor is disabled', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsHumiditySensor: false,
				};

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.humidity.current': 65,
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(airConditioner.getChildEndpointById).not.toHaveBeenCalledWith('HumiditySensor');
			});

			it('should handle missing HumiditySensor child endpoint gracefully', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsHumiditySensor: true,
				};

				airConditioner.getChildEndpointById.mockReturnValue(undefined); // child doesn't exist

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.humidity.current': 65,
				});

				// Act & Assert - should not throw
				await expect(
					applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger),
				).resolves.not.toThrow();
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('HumiditySensor');
			});

			it('should update air quality sensor when supportsAirQualitySensor is enabled and all values are defined', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsAirQualitySensor: true,
				};

				const mockChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				airConditioner.getChildEndpointById.mockReturnValue(mockChild);

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.quality.overall': 3,
					'airState.quality.PM2': 25,
					'airState.quality.PM10': 50,
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('AirQualitySensor');
				expect(mockChild.updateAttribute).toHaveBeenCalledWith(expect.any(Number), 'airQuality', 3, mockLogger);
				expect(mockChild.updateAttribute).toHaveBeenCalledWith(expect.any(Number), 'measuredValue', 25, mockLogger);
				expect(mockChild.updateAttribute).toHaveBeenCalledWith(expect.any(Number), 'measuredValue', 50, mockLogger);
			});

			it('should only push air quality overall when PM values are undefined', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsAirQualitySensor: true,
				};

				const mockChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				airConditioner.getChildEndpointById.mockReturnValue(mockChild);

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.quality.overall': 2,
					// PM2 and PM10 absent
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(mockChild.updateAttribute).toHaveBeenCalledWith(expect.any(Number), 'airQuality', 2, mockLogger);
				// PM updates should not happen
				const pmCalls = mockChild.updateAttribute.mock.calls.filter((call: any[]) => call[1] === 'measuredValue');
				expect(pmCalls).toHaveLength(0);
			});

			it('should not push air quality when all values are undefined even if capability is enabled', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsAirQualitySensor: true,
				};

				const mockChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				airConditioner.getChildEndpointById.mockReturnValue(mockChild);

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					// all quality values absent
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('AirQualitySensor');
				expect(mockChild.updateAttribute).not.toHaveBeenCalled();
			});

			it('should not attempt air quality push when supportsAirQualitySensor is disabled', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsAirQualitySensor: false,
				};

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.quality.overall': 3,
					'airState.quality.PM2': 25,
					'airState.quality.PM10': 50,
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(airConditioner.getChildEndpointById).not.toHaveBeenCalledWith('AirQualitySensor');
			});

			it('should handle missing AirQualitySensor child endpoint gracefully', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsAirQualitySensor: true,
				};

				airConditioner.getChildEndpointById.mockReturnValue(undefined); // child doesn't exist

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.quality.overall': 3,
					'airState.quality.PM2': 25,
					'airState.quality.PM10': 50,
				});

				// Act & Assert - should not throw
				await expect(
					applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger),
				).resolves.not.toThrow();
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('AirQualitySensor');
			});

			it('should push both humidity and air quality sensors when both capabilities are enabled', async () => {
				// Arrange
				capabilities = {
					...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
					supportsHumiditySensor: true,
					supportsAirQualitySensor: true,
				};

				const mockHumidityChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};
				const mockAirQualityChild = {
					updateAttribute: vi.fn().mockResolvedValue(false),
				};

				airConditioner.getChildEndpointById.mockImplementation((id: string) => {
					if (id === 'HumiditySensor') return mockHumidityChild;
					if (id === 'AirQualitySensor') return mockAirQualityChild;
					return undefined;
				});

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0,
					'airState.windStrength': 2,
					'airState.humidity.current': 65,
					'airState.quality.overall': 3,
					'airState.quality.PM2': 25,
					'airState.quality.PM10': 50,
				});

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('HumiditySensor');
				expect(airConditioner.getChildEndpointById).toHaveBeenCalledWith('AirQualitySensor');
				expect(mockHumidityChild.updateAttribute).toHaveBeenCalled();
				expect(mockAirQualityChild.updateAttribute).toHaveBeenCalled();
			});

			it('should maintain full regression parity with default capabilities (all sensors disabled)', async () => {
				// Arrange
				capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES; // all new flags = false

				const snapshot = new ThinqSnapshot({
					'airState.operation': 1,
					'airState.tempState.current': 22,
					'airState.tempState.target': 24,
					'airState.opMode': 0, // COOL
					'airState.windStrength': 2, // LOW
					'airState.humidity.current': 65,
					'airState.quality.overall': 3,
					'airState.quality.PM2': 25,
					'airState.quality.PM10': 50,
				});

				const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

				// Act
				await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

				// Assert - only the existing attributes should be updated
				expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
				expect(updateAttributeSpy).toHaveBeenCalledWith(TemperatureMeasurement.id, 'measuredValue', 2200, mockLogger);
				expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 2200, mockLogger);
				expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedCoolingSetpoint', 2400, mockLogger);
				expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedHeatingSetpoint', 2400, mockLogger);
				expect(updateAttributeSpy).toHaveBeenCalledWith(
					Thermostat.id,
					'systemMode',
					Thermostat.SystemMode.Cool,
					mockLogger,
				);
				expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'fanMode', FanControl.FanMode.Low, mockLogger);
				expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
				// No sensor child endpoint calls should happen
				expect(airConditioner.getChildEndpointById).not.toHaveBeenCalled();
			});

			describe('energy monitoring on AC endpoint (Phase D)', () => {
				let mockLogger: ReturnType<typeof createMockLogger>;
				let airConditioner: any;
				let capabilities: AirConditionerCapabilities;

				beforeEach(() => {
					vi.clearAllMocks();
					mockLogger = createMockLogger();

					airConditioner = {
						id: 0x01,
						name: 'Living Room AC',
						log: mockLogger,
						updateAttribute: vi.fn().mockResolvedValue(false),
						getChildEndpointById: vi.fn(),
					};
				});

				afterEach(() => {
					vi.clearAllMocks();
				});

				it('should push power consumption to AC endpoint when supportsEnergyMonitoring is true and value is defined', async () => {
					// Arrange
					capabilities = {
						...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
						supportsEnergyMonitoring: true,
					};

					const snapshot = new ThinqSnapshot({
						'airState.operation': 1,
						'airState.tempState.current': 22,
						'airState.tempState.target': 24,
						'airState.opMode': 0,
						'airState.windStrength': 2,
						'airState.energy.onCurrent': 500,
					});

					// Act
					await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

					// Assert
					expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
						ElectricalPowerMeasurement.id,
						'activePower',
						500000,
						mockLogger,
					);
				});

				it('should not push power consumption when supportsEnergyMonitoring is true but value is undefined', async () => {
					// Arrange
					capabilities = {
						...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
						supportsEnergyMonitoring: true,
					};

					const snapshot = new ThinqSnapshot({
						'airState.operation': 1,
						'airState.tempState.current': 22,
						'airState.tempState.target': 24,
						'airState.opMode': 0,
						'airState.windStrength': 2,
						// airState.energy.onCurrent deliberately omitted
					});

					// Act
					await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

					// Assert
					const powerUpdateCalls = (airConditioner.updateAttribute as any).mock.calls.filter(
						(call: any[]) => call[1] === 'activePower',
					);
					expect(powerUpdateCalls).toHaveLength(0);
				});

				it('should skip energy monitoring when capability is false (default)', async () => {
					// Arrange
					capabilities = {
						...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
						supportsEnergyMonitoring: false,
					};

					const snapshot = new ThinqSnapshot({
						'airState.operation': 1,
						'airState.tempState.current': 22,
						'airState.tempState.target': 24,
						'airState.opMode': 0,
						'airState.windStrength': 2,
						'airState.energy.onCurrent': 500,
					});

					// Act & Assert - should not throw
					await expect(
						applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger),
					).resolves.not.toThrow();
					const powerUpdateCalls = (airConditioner.updateAttribute as any).mock.calls.filter(
						(call: any[]) => call[1] === 'activePower',
					);
					expect(powerUpdateCalls).toHaveLength(0);
				});

				it('should write 0 watts correctly when onCurrent is 0', async () => {
					// Arrange
					capabilities = {
						...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
						supportsEnergyMonitoring: true,
					};

					const snapshot = new ThinqSnapshot({
						'airState.operation': 1,
						'airState.tempState.current': 22,
						'airState.tempState.target': 24,
						'airState.opMode': 0,
						'airState.windStrength': 2,
						'airState.energy.onCurrent': 0,
					});

					// Act
					await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

					// Assert
					expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
						ElectricalPowerMeasurement.id,
						'activePower',
						0,
						mockLogger,
					);
				});

				it('should push power value 999 W correctly', async () => {
					// Arrange
					capabilities = {
						...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
						supportsEnergyMonitoring: true,
					};

					const snapshot = new ThinqSnapshot({
						'airState.operation': 1,
						'airState.tempState.current': 22,
						'airState.tempState.target': 24,
						'airState.opMode': 0,
						'airState.windStrength': 2,
						'airState.energy.onCurrent': 999,
					});

					// Act
					await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

					// Assert
					expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
						ElectricalPowerMeasurement.id,
						'activePower',
						999000,
						mockLogger,
					);
				});

				it('should maintain full regression parity with default capabilities (energy monitoring disabled)', async () => {
					// Arrange
					capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES };

					const snapshot = new ThinqSnapshot({
						'airState.operation': 1,
						'airState.tempState.current': 22,
						'airState.tempState.target': 24,
						'airState.opMode': 0,
						'airState.windStrength': 2,
						'airState.energy.onCurrent': 500,
					});

					const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

					// Act
					await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

					// Assert - only the existing attributes should be updated
					expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
					expect(updateAttributeSpy).toHaveBeenCalledWith(TemperatureMeasurement.id, 'measuredValue', 2200, mockLogger);
					expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 2200, mockLogger);
					expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedCoolingSetpoint', 2400, mockLogger);
					expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedHeatingSetpoint', 2400, mockLogger);
					expect(updateAttributeSpy).toHaveBeenCalledWith(
						Thermostat.id,
						'systemMode',
						Thermostat.SystemMode.Cool,
						mockLogger,
					);
					expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'fanMode', FanControl.FanMode.Low, mockLogger);
					expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
					// No energy monitor child endpoint calls should happen
					expect(airConditioner.getChildEndpointById).not.toHaveBeenCalledWith('EnergyMonitor');
				});
			});
		});
	});

	describe('applyThinqSnapshotToAirConditioner (partial pushes)', () => {
		let mockLogger: ReturnType<typeof createMockLogger>;
		let airConditioner: any;
		let capabilities: AirConditionerCapabilities;

		beforeEach(async () => {
			vi.clearAllMocks();
			mockLogger = createMockLogger();
			capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES;

			airConditioner = {
				id: 0x01,
				name: 'Living Room AC',
				log: mockLogger,
				updateAttribute: vi.fn().mockResolvedValue(false),
				getAttribute: vi.fn(),
				getChildEndpointById: vi.fn(),
			};
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it('should write only temperature attributes for temp-only push', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.tempState.current': 27.5 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasOnOff = calls.some((call: any[]) => call[0] === OnOff.id && call[1] === 'onOff');
			const hasSystemMode = calls.some((call: any[]) => call[0] === Thermostat.id && call[1] === 'systemMode');
			const hasFanMode = calls.some((call: any[]) => call[0] === FanControl.id && call[1] === 'fanMode');
			const hasMeasuredValue = calls.some(
				(call: any[]) => call[0] === TemperatureMeasurement.id && call[1] === 'measuredValue',
			);

			expect(hasOnOff).toBe(false);
			expect(hasSystemMode).toBe(false);
			expect(hasFanMode).toBe(false);
			expect(hasMeasuredValue).toBe(true);
		});

		it('should write energy to AC endpoint for energy-only push when OnOff is true', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsEnergyMonitoring: true,
			};

			airConditioner.getAttribute.mockImplementation((clusterId: number, attr: string) => {
				if (clusterId === OnOff.id && attr === 'onOff') {
					return true; // Explicitly true
				}
				return undefined;
			});

			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': 996 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const acCalls = (airConditioner.updateAttribute as any).mock.calls;
			const hasOnOff = acCalls.some((call: any[]) => call[0] === OnOff.id);
			const hasSystemMode = acCalls.some((call: any[]) => call[0] === Thermostat.id);

			expect(hasOnOff).toBe(false);
			expect(hasSystemMode).toBe(false);
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
				ElectricalPowerMeasurement.id,
				'activePower',
				996000,
				mockLogger,
			);
		});

		it('should not write activePower for energy-only push when operation is absent (no bogus 0 W)', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsEnergyMonitoring: true,
			};

			const snapshot = new ThinqSnapshot({ 'airState.tempState.current': 27.5 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasActivePower = calls.some((call: any[]) => call[1] === 'activePower');

			expect(hasActivePower).toBe(false);
		});

		it('should write OnOff false and systemMode Off for operation=0 only push', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 0 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, mockLogger);
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Off,
				mockLogger,
			);
		});

		it('should write OnOff true but not systemMode for operation=1 only push', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 1 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);

			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasSystemMode = calls.some((call: any[]) => call[0] === Thermostat.id && call[1] === 'systemMode');
			expect(hasSystemMode).toBe(false);
		});

		it('should write systemMode derived from opMode when OnOff is currently true', async () => {
			// Arrange
			airConditioner.getAttribute.mockImplementation((clusterId: number, attr: string) => {
				if (clusterId === OnOff.id && attr === 'onOff') {
					return true;
				}
				return undefined;
			});

			const snapshot = new ThinqSnapshot({ 'airState.opMode': 0 }); // COOL

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Cool,
				mockLogger,
			);
		});

		it('should not write systemMode for opMode-only push when OnOff is currently false', async () => {
			// Arrange
			airConditioner.getAttribute.mockImplementation((clusterId: number, attr: string) => {
				if (clusterId === OnOff.id && attr === 'onOff') {
					return false;
				}
				return undefined;
			});

			const snapshot = new ThinqSnapshot({ 'airState.opMode': 0 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasSystemMode = calls.some((call: any[]) => call[0] === Thermostat.id && call[1] === 'systemMode');
			expect(hasSystemMode).toBe(false);
		});

		it('should not write systemMode for opMode-only push when OnOff is undefined', async () => {
			// Arrange
			airConditioner.getAttribute.mockReturnValue(undefined);

			const snapshot = new ThinqSnapshot({ 'airState.opMode': 0 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasSystemMode = calls.some((call: any[]) => call[0] === Thermostat.id && call[1] === 'systemMode');
			expect(hasSystemMode).toBe(false);
		});

		it('should map unsupported opMode (Dry when disabled) to Cool when OnOff is true', async () => {
			// Arrange
			// Note: supportsDry is irrelevant; Dry always collapses to Cool for Apple Home compatibility
			capabilities = DEFAULT_AIR_CONDITIONER_CAPABILITIES;

			airConditioner.getAttribute.mockImplementation((clusterId: number, attr: string) => {
				if (clusterId === OnOff.id && attr === 'onOff') {
					return true;
				}
				return undefined;
			});

			const snapshot = new ThinqSnapshot({ 'airState.opMode': 1 }); // DRY (unsupported)

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Cool,
				mockLogger,
			);
		});

		it('should write fan mode and percent for windStrength-only push', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.windStrength': 2 }); // LOW

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'fanMode',
				FanControl.FanMode.Low,
				mockLogger,
			);
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
		});

		it('should write rockSetting when vertical swing axis only is present', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsFanSpeedControl: true,
				supportsSwingMode: true,
			};

			airConditioner.getAttribute.mockImplementation((clusterId: number, attr: string) => {
				if (clusterId === FanControl.id && attr === 'rockSetting') {
					return { rockLeftRight: true, rockUpDown: false, rockRound: false };
				}
				return undefined;
			});

			const snapshot = new ThinqSnapshot({ 'airState.wDir.vStep': 100 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(airConditioner.updateAttribute).toHaveBeenCalledWith(
				FanControl.id,
				'rockSetting',
				{
					rockLeftRight: true,
					rockUpDown: true,
					rockRound: true,
				},
				mockLogger,
			);
		});

		it('should not write rockSetting when neither swing axis is present', async () => {
			// Arrange
			capabilities = {
				...DEFAULT_AIR_CONDITIONER_CAPABILITIES,
				supportsFanSpeedControl: true,
				supportsSwingMode: true,
			};

			const snapshot = new ThinqSnapshot({ 'airState.tempState.current': 27.5 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasRockSetting = calls.some((call: any[]) => call[0] === FanControl.id && call[1] === 'rockSetting');
			expect(hasRockSetting).toBe(false);
		});

		it('should not write OnOff for push with online extra', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ online: true, 'airState.tempState.current': 27.5 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			const calls = (airConditioner.updateAttribute as any).mock.calls;
			const hasOnOff = calls.some((call: any[]) => call[0] === OnOff.id && call[1] === 'onOff');
			expect(hasOnOff).toBe(false);
		});

		it('should log skipped attributes for partial push', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.tempState.current': 27.5 });

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('skipped (source key absent)'));
		});

		it('should maintain full parity with full snapshot', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				'airState.operation': 1,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0, // COOL
				'airState.windStrength': 2, // LOW
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', true, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(TemperatureMeasurement.id, 'measuredValue', 2200, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'localTemperature', 2200, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedCoolingSetpoint', 2400, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(Thermostat.id, 'occupiedHeatingSetpoint', 2400, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Cool,
				mockLogger,
			);
			expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'fanMode', FanControl.FanMode.Low, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(FanControl.id, 'percentCurrent', 20, mockLogger);
		});

		it('should write OnOff false and systemMode Off for full snapshot with operation 0', async () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				'airState.operation': 0,
				'airState.tempState.current': 22,
				'airState.tempState.target': 24,
				'airState.opMode': 0,
				'airState.windStrength': 2,
			});

			const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

			// Act
			await applyThinqSnapshotToAirConditioner(airConditioner, snapshot, capabilities, mockLogger);

			// Assert
			expect(updateAttributeSpy).toHaveBeenCalledWith(OnOff.id, 'onOff', false, mockLogger);
			expect(updateAttributeSpy).toHaveBeenCalledWith(
				Thermostat.id,
				'systemMode',
				Thermostat.SystemMode.Off,
				mockLogger,
			);
		});
	});
});
