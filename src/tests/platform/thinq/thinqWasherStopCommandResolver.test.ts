import { describe, expect, it } from 'vitest';

import {
	extractWasherPauseCommand,
	extractWasherStopCommand,
	type WasherStopCommandPayload,
} from '../../../platform/thinq/thinqWasherStopCommandResolver.js';

const PAUSE_SHAPE = {
	command: 'Set',
	data: {
		washerDryer: {
			controlDataType: 'PAUSE',
			controlDataValueLength: 1,
			controlDataValue: 0,
		},
	},
};

const POWEROFF_SHAPE = {
	command: 'Set',
	data: {
		washerDryer: {
			controlDataType: 'POWEROFF',
			controlDataValueLength: 1,
			controlDataValue: 0,
		},
	},
};

describe('thinqWasherStopCommandResolver', () => {
	describe('extractWasherPauseCommand', () => {
		it('should map WMStop PAUSE shape to a Set payload when present', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMStop: PAUSE_SHAPE } };

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result).toEqual({
				command: 'Set',
				dataSetList: {
					washerDryer: {
						controlDataType: 'PAUSE',
						controlDataValueLength: 1,
						controlDataValue: 0,
					},
				},
			});
		});

		it('should return undefined and not fall back to WMOff when only WMOff is present', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMOff: POWEROFF_SHAPE } };

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when ControlWifi is absent', () => {
			// Arrange
			const deviceModel = { OtherProperty: { WMStop: PAUSE_SHAPE } };

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when ControlWifi is not an object', () => {
			// Arrange
			const deviceModel = { ControlWifi: 'not-an-object' };

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when deviceModel is not an object', () => {
			// Arrange
			const deviceModel: any = null;

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMStop is not an object', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMStop: 'string-value' } };

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return the pause payload and not the power-off payload when both are present', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMStop: PAUSE_SHAPE, WMOff: POWEROFF_SHAPE } };

			// Act
			const result = extractWasherPauseCommand(deviceModel);

			// Assert
			expect(result?.dataSetList).toEqual({
				washerDryer: { controlDataType: 'PAUSE', controlDataValueLength: 1, controlDataValue: 0 },
			});
		});
	});

	describe('extractWasherStopCommand', () => {
		it('should map WMOff POWEROFF shape to a Set payload when present', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMOff: POWEROFF_SHAPE } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toEqual({
				command: 'Set',
				dataSetList: {
					washerDryer: {
						controlDataType: 'POWEROFF',
						controlDataValueLength: 1,
						controlDataValue: 0,
					},
				},
			});
		});

		it('should return undefined and not fall back to WMStop when only WMStop is present', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMStop: PAUSE_SHAPE } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return the power-off payload and not the pause payload when both are present', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMStop: PAUSE_SHAPE, WMOff: POWEROFF_SHAPE } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList).toEqual({
				washerDryer: { controlDataType: 'POWEROFF', controlDataValueLength: 1, controlDataValue: 0 },
			});
		});

		it('should return undefined when ControlWifi is absent', () => {
			// Arrange
			const deviceModel = { OtherProperty: { WMOff: POWEROFF_SHAPE } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined for empty deviceModel', () => {
			// Arrange
			const deviceModel = {};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when deviceModel is not an object', () => {
			// Arrange
			const deviceModel: any = null;

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMOff is not an object', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMOff: 'string-value' } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when ControlWifi is not an object', () => {
			// Arrange
			const deviceModel = { ControlWifi: 'not-an-object' };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should include optional command field when present', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: { WMOff: { command: 'Operation', dataKey: 'washerDryer.state', dataValue: 'OFF' } },
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.command).toBe('Operation');
		});

		it('should omit command field when absent', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMOff: { dataKey: 'washerDryer.state', dataValue: 'OFF' } } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.command).toBeUndefined();
		});

		it('should handle dataSetList when present', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMOff: {
						dataKey: 'washerDryer.state',
						dataValue: 'OFF',
						dataSetList: { course: 'value1', spin: 'value2' },
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList?.course).toBe('value1');
			expect(result?.dataSetList?.spin).toBe('value2');
		});

		it('should fallback to data field when dataSetList is absent', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: { WMOff: { dataKey: 'washerDryer.state', dataValue: 'OFF', data: { course: 'value1' } } },
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList?.course).toBe('value1');
		});

		it('should prefer dataSetList over data field', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMOff: {
						dataKey: 'washerDryer.state',
						dataValue: 'OFF',
						dataSetList: { course: 'from-dataSetList' },
						data: { course: 'from-data' },
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList?.course).toBe('from-dataSetList');
		});

		it('should handle dataValue as any type (not just string)', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMOff: { dataKey: 'washerDryer.state', dataValue: 123 } } };

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataValue).toBe(123);
		});

		it('should handle boolean and null dataValue', () => {
			// Arrange
			const booleanModel = { ControlWifi: { WMOff: { dataKey: 'washerDryer.state', dataValue: true } } };
			const nullModel = { ControlWifi: { WMOff: { dataKey: 'washerDryer.state', dataValue: null } } };

			// Act
			const booleanResult = extractWasherStopCommand(booleanModel);
			const nullResult = extractWasherStopCommand(nullModel);

			// Assert
			expect(booleanResult?.dataValue).toBe(true);
			expect(nullResult?.dataValue).toBeNull();
		});

		it('should omit dataSetList when neither dataSetList nor data are objects', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMOff: { dataKey: 'washerDryer.state', dataValue: 'OFF', dataSetList: 'x', data: 'y' },
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList).toBeUndefined();
		});

		it('should return a payload with undefined fields when WMOff has no usable values', () => {
			// Arrange
			const deviceModel = { ControlWifi: { WMOff: { dataKey: undefined, dataValue: undefined } } };

			// Act
			const result: WasherStopCommandPayload | undefined = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.dataKey).toBeUndefined();
			expect(result?.dataValue).toBeUndefined();
		});
	});
});
