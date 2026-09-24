import { describe, expect, it } from 'vitest';

import { ThinqSnapshot } from '../../../../core/domain/value-objects/ThinqSnapshot.js';

describe('ThinqSnapshot', () => {
	describe('raw getter', () => {
		it('should return the constructor input as-is', () => {
			// Arrange
			const data = {
				'airState.operation': 1,
				'airState.tempState.current': 22,
				foo: 'bar',
			};

			// Act
			const snapshot = new ThinqSnapshot(data);

			// Assert
			expect(snapshot.raw).toBe(data);
		});
	});

	describe('isPowerOn', () => {
		it('should return true when airState.operation is 1', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 1 });

			// Assert
			expect(snapshot.isPowerOn).toBe(true);
		});

		it('should return false when airState.operation is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 0 });

			// Assert
			expect(snapshot.isPowerOn).toBe(false);
		});

		it('should return false when airState.operation is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isPowerOn).toBe(false);
		});

		it('should return false when airState.operation is a non-numeric type', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 'on' });

			// Assert
			expect(snapshot.isPowerOn).toBe(false);
		});
	});

	describe('currentTemperatureCelsius', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.tempState.current': 22 });

			// Assert
			expect(snapshot.currentTemperatureCelsius).toBe(22);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.currentTemperatureCelsius).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.tempState.current': '22' });

			// Assert
			expect(snapshot.currentTemperatureCelsius).toBeUndefined();
		});
	});

	describe('targetTemperatureCelsius', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.tempState.target': 24 });

			// Assert
			expect(snapshot.targetTemperatureCelsius).toBe(24);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.targetTemperatureCelsius).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.tempState.target': '24' });

			// Assert
			expect(snapshot.targetTemperatureCelsius).toBeUndefined();
		});
	});

	describe('operationMode', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.opMode': 0 });

			// Assert
			expect(snapshot.operationMode).toBe(0);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.operationMode).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.opMode': 'cool' });

			// Assert
			expect(snapshot.operationMode).toBeUndefined();
		});
	});

	describe('windStrength', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.windStrength': 2 });

			// Assert
			expect(snapshot.windStrength).toBe(2);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.windStrength).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.windStrength': 'low' });

			// Assert
			expect(snapshot.windStrength).toBeUndefined();
		});
	});

	describe('online', () => {
		it('should return true when online is boolean true', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ online: true });

			// Assert
			expect(snapshot.online).toBe(true);
		});

		it('should return false when online is boolean false', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ online: false });

			// Assert
			expect(snapshot.online).toBe(false);
		});

		it('should return undefined when online is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.online).toBeUndefined();
		});

		it('should return undefined when online is not a boolean', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ online: 'yes' });

			// Assert
			expect(snapshot.online).toBeUndefined();
		});
	});

	describe('isJetModeOn', () => {
		it('should return true when airState.wMode.jet is 1', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wMode.jet': 1 });

			// Assert
			expect(snapshot.isJetModeOn).toBe(true);
		});

		it('should return false when airState.wMode.jet is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wMode.jet': 0 });

			// Assert
			expect(snapshot.isJetModeOn).toBe(false);
		});

		it('should return false when airState.wMode.jet is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isJetModeOn).toBe(false);
		});
	});

	describe('isQuietModeOn', () => {
		it('should return true when airState.miscFuncState.silentAWHP is 1', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.miscFuncState.silentAWHP': 1 });

			// Assert
			expect(snapshot.isQuietModeOn).toBe(true);
		});

		it('should return false when airState.miscFuncState.silentAWHP is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.miscFuncState.silentAWHP': 0 });

			// Assert
			expect(snapshot.isQuietModeOn).toBe(false);
		});

		it('should return false when airState.miscFuncState.silentAWHP is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isQuietModeOn).toBe(false);
		});
	});

	describe('isEnergySaveModeOn', () => {
		it('should return true when airState.powerSave.basic is 1', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.powerSave.basic': 1 });

			// Assert
			expect(snapshot.isEnergySaveModeOn).toBe(true);
		});

		it('should return false when airState.powerSave.basic is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.powerSave.basic': 0 });

			// Assert
			expect(snapshot.isEnergySaveModeOn).toBe(false);
		});

		it('should return false when airState.powerSave.basic is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isEnergySaveModeOn).toBe(false);
		});
	});

	describe('isAirCleanModeOn', () => {
		it('should return true when airState.wMode.airClean is 1', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wMode.airClean': 1 });

			// Assert
			expect(snapshot.isAirCleanModeOn).toBe(true);
		});

		it('should return false when airState.wMode.airClean is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wMode.airClean': 0 });

			// Assert
			expect(snapshot.isAirCleanModeOn).toBe(false);
		});

		it('should return false when airState.wMode.airClean is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isAirCleanModeOn).toBe(false);
		});
	});

	describe('isLedOn', () => {
		it('should return true when airState.lightingState.displayControl is 1', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.lightingState.displayControl': 1 });

			// Assert
			expect(snapshot.isLedOn).toBe(true);
		});

		it('should return false when airState.lightingState.displayControl is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.lightingState.displayControl': 0 });

			// Assert
			expect(snapshot.isLedOn).toBe(false);
		});

		it('should return false when airState.lightingState.displayControl is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isLedOn).toBe(false);
		});
	});

	describe('isVerticalSwingOn (Phase B)', () => {
		it('should return true when airState.wDir.vStep is 100 (numeric)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.vStep': 100 });

			// Assert
			expect(snapshot.isVerticalSwingOn).toBe(true);
		});

		it('should return true when airState.wDir.vStep is "100" (string)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.vStep': '100' });

			// Assert
			expect(snapshot.isVerticalSwingOn).toBe(true);
		});

		it('should return false when airState.wDir.vStep is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.vStep': 0 });

			// Assert
			expect(snapshot.isVerticalSwingOn).toBe(false);
		});

		it('should return false when airState.wDir.vStep is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isVerticalSwingOn).toBe(false);
		});

		it('should return false when airState.wDir.vStep is any other number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.vStep': 50 });

			// Assert
			expect(snapshot.isVerticalSwingOn).toBe(false);
		});
	});

	describe('isHorizontalSwingOn (Phase B)', () => {
		it('should return true when airState.wDir.hStep is 100 (numeric)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.hStep': 100 });

			// Assert
			expect(snapshot.isHorizontalSwingOn).toBe(true);
		});

		it('should return true when airState.wDir.hStep is "100" (string)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.hStep': '100' });

			// Assert
			expect(snapshot.isHorizontalSwingOn).toBe(true);
		});

		it('should return false when airState.wDir.hStep is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.hStep': 0 });

			// Assert
			expect(snapshot.isHorizontalSwingOn).toBe(false);
		});

		it('should return false when airState.wDir.hStep is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isHorizontalSwingOn).toBe(false);
		});

		it('should return false when airState.wDir.hStep is any other number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.wDir.hStep': 50 });

			// Assert
			expect(snapshot.isHorizontalSwingOn).toBe(false);
		});
	});

	describe('humidityPercent (Phase C)', () => {
		it('should return the value directly when <= 100', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': 55 });

			// Assert
			expect(snapshot.humidityPercent).toBe(55);
		});

		it('should return the value divided by 10 when > 100', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': 550 });

			// Assert
			expect(snapshot.humidityPercent).toBe(55);
		});

		it('should return exactly 100 when value is 100', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': 100 });

			// Assert
			expect(snapshot.humidityPercent).toBe(100);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.humidityPercent).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': '55' });

			// Assert
			expect(snapshot.humidityPercent).toBeUndefined();
		});

		it('should apply heuristic to large values (1000 → 100)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': 1000 });

			// Assert
			expect(snapshot.humidityPercent).toBe(100);
		});

		it('should apply heuristic to small > 100 values (101 → 10.1)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': 101 });

			// Assert
			expect(snapshot.humidityPercent).toBe(10.1);
		});

		it('should apply heuristic to common > 100 value (650 → 65)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.humidity.current': 650 });

			// Assert
			expect(snapshot.humidityPercent).toBe(65);
		});
	});

	describe('airQualityOverall (Phase C)', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.overall': 3 });

			// Assert
			expect(snapshot.airQualityOverall).toBe(3);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.airQualityOverall).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.overall': 'Good' });

			// Assert
			expect(snapshot.airQualityOverall).toBeUndefined();
		});

		it('should return 0 for poor air quality', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.overall': 0 });

			// Assert
			expect(snapshot.airQualityOverall).toBe(0);
		});
	});

	describe('pm25 (Phase C)', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.PM2': 25 });

			// Assert
			expect(snapshot.pm25).toBe(25);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.pm25).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.PM2': '25' });

			// Assert
			expect(snapshot.pm25).toBeUndefined();
		});

		it('should return 0 for zero PM2.5 reading', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.PM2': 0 });

			// Assert
			expect(snapshot.pm25).toBe(0);
		});
	});

	describe('pm10 (Phase C)', () => {
		it('should return the number value when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.PM10': 50 });

			// Assert
			expect(snapshot.pm10).toBe(50);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.pm10).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.PM10': '50' });

			// Assert
			expect(snapshot.pm10).toBeUndefined();
		});

		it('should return 0 for zero PM10 reading', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.quality.PM10': 0 });

			// Assert
			expect(snapshot.pm10).toBe(0);
		});
	});

	describe('powerConsumptionWatts (Phase D)', () => {
		it('should return the raw value when present (no division)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': 500 });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBe(500);
		});

		it('should return 0 when airState.energy.onCurrent is 0', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': 0 });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBe(0);
		});

		it('should return undefined when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.powerConsumptionWatts).toBeUndefined();
		});

		it('should return undefined when value is not a number', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': '500' });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBeUndefined();
		});

		it('should return undefined when the result is NaN', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': NaN });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBeUndefined();
		});

		it('should return raw value for intermediate powers (999 → 999)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': 999 });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBe(999);
		});

		it('should handle large power values (5000 → 5000)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': 5000 });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBe(5000);
		});

		it('should handle fractional onCurrent values (1.5 → 1.5)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.energy.onCurrent': 1.5 });

			// Assert
			expect(snapshot.powerConsumptionWatts).toBe(1.5);
		});
	});

	describe('has', () => {
		it('should return true when key has a number value', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 1 });

			// Assert
			expect(snapshot.has('airState.operation')).toBe(true);
		});

		it('should return true when key has value 0 (falsy number)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': 0 });

			// Assert
			expect(snapshot.has('airState.operation')).toBe(true);
		});

		it('should return true when key has a false boolean value', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ online: false });

			// Assert
			expect(snapshot.has('online')).toBe(true);
		});

		it('should return true when key has an empty string value', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ foo: '' });

			// Assert
			expect(snapshot.has('foo')).toBe(true);
		});

		it('should return false when key is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.has('airState.operation')).toBe(false);
		});

		it('should return false when key value is undefined', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': undefined });

			// Assert
			expect(snapshot.has('airState.operation')).toBe(false);
		});

		it('should return false when key value is null', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({ 'airState.operation': null });

			// Assert
			expect(snapshot.has('airState.operation')).toBe(false);
		});

		it('regression: isPowerOn should remain false when key is absent (existing behavior)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Assert
			expect(snapshot.isPowerOn).toBe(false);
		});
	});

	describe('washerRawState', () => {
		it('should return the washerDryer.state string when present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 1 },
			});

			// Act & Assert
			expect(snapshot.washerRawState).toBe('RUNNING');
		});

		it('should return undefined when washerDryer is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act & Assert
			expect(snapshot.washerRawState).toBeUndefined();
		});

		it('should return undefined when washerDryer.state is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { remainTimeHour: 1 },
			});

			// Act & Assert
			expect(snapshot.washerRawState).toBeUndefined();
		});

		it('should return undefined when washerDryer.state is not a string', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 123 },
			});

			// Act & Assert
			expect(snapshot.washerRawState).toBeUndefined();
		});
	});

	describe('isWasherPowerOn', () => {
		it('should return true when washerRawState is RUNNING', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(true);
		});

		it('should return true when washerRawState is PAUSE', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'PAUSE' },
			});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(true);
		});

		it('should return true when washerRawState is END', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'END' },
			});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(true);
		});

		it('should return true when washerRawState is ERROR', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'ERROR' },
			});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(true);
		});

		it('should return false when washerRawState is POWEROFF', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWEROFF' },
			});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(false);
		});

		it('should return false when washerRawState is POWERFAIL', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWERFAIL' },
			});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(false);
		});

		it('should return false when washerDryer is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act & Assert
			expect(snapshot.isWasherPowerOn).toBe(false);
		});
	});

	describe('isWasherRunning', () => {
		it('should return true when washerRawState is RUNNING', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act & Assert
			expect(snapshot.isWasherRunning).toBe(true);
		});

		it('should return false when washerRawState is PAUSE (not running, even if powered on)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'PAUSE' },
			});

			// Act & Assert
			expect(snapshot.isWasherRunning).toBe(false);
		});

		it('should return false when washerRawState is END (finished, not running)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'END' },
			});

			// Act & Assert
			expect(snapshot.isWasherRunning).toBe(false);
		});

		it('should return false when washerRawState is POWEROFF', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWEROFF' },
			});

			// Act & Assert
			expect(snapshot.isWasherRunning).toBe(false);
		});

		it('should return false when washerRawState is ERROR', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'ERROR' },
			});

			// Act & Assert
			expect(snapshot.isWasherRunning).toBe(false);
		});

		it('should return false when washerDryer is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act & Assert
			expect(snapshot.isWasherRunning).toBe(false);
		});
	});

	describe('isWasherError', () => {
		it('should return true when washerRawState is ERROR', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'ERROR' },
			});

			// Act & Assert
			expect(snapshot.isWasherError).toBe(true);
		});

		it('should return false when washerRawState is RUNNING', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act & Assert
			expect(snapshot.isWasherError).toBe(false);
		});

		it('should return false when washerRawState is POWEROFF', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'POWEROFF' },
			});

			// Act & Assert
			expect(snapshot.isWasherError).toBe(false);
		});

		it('should return false when washerDryer is absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act & Assert
			expect(snapshot.isWasherError).toBe(false);
		});
	});

	describe('washerRemainingDurationSeconds', () => {
		it('should return combined seconds when both hours and minutes present', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 1, remainTimeMinute: 30 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(5400); // 1*3600 + 30*60
		});

		it('should return seconds from hours only', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 2 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(7200); // 2*3600
		});

		it('should return seconds from minutes only', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeMinute: 45 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(2700); // 45*60
		});

		it('should return 0 when present but not running (PAUSE)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'PAUSE', remainTimeHour: 1, remainTimeMinute: 30 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(0); // Zeroed when not running
		});

		it('should return 0 when present but not running (END)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'END', remainTimeHour: 1 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(0); // Zeroed when not running
		});

		it('should return undefined when both remain times absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING' },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when washerDryer absent', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBeUndefined();
		});

		it('should handle zero hour/minute values', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 0, remainTimeMinute: 0 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(0);
		});

		it('should add hours and minutes correctly (large values)', () => {
			// Arrange
			const snapshot = new ThinqSnapshot({
				washerDryer: { state: 'RUNNING', remainTimeHour: 10, remainTimeMinute: 59 },
			});

			// Act
			const result = snapshot.washerRemainingDurationSeconds;

			// Assert
			expect(result).toBe(39540); // 10*3600 + 59*60
		});
	});
});
