import { describe, expect, it } from 'vitest';

import {
	extractWasherStopCommand,
	type WasherStopCommandPayload,
} from '../../../platform/thinq/thinqWasherStopCommandResolver.js';

describe('thinqWasherStopCommandResolver', () => {
	describe('extractWasherStopCommand', () => {
		it('should extract WMStop command when present', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						command: 'Set',
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.command).toBe('Set');
			expect(result?.dataKey).toBe('washerDryer.state');
			expect(result?.dataValue).toBe('STOP');
		});

		it('should fall back to WMOff when WMStop is absent', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMOff: {
						command: 'Set',
						dataKey: 'washerDryer.state',
						dataValue: 'OFF',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.dataValue).toBe('OFF');
		});

		it('should prefer WMStop over WMOff when both present', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						command: 'Set',
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
					},
					WMOff: {
						command: 'Set',
						dataKey: 'washerDryer.state',
						dataValue: 'OFF',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataValue).toBe('STOP');
		});

		it('should return undefined when both WMStop and WMOff are absent', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					OtherCommand: {
						dataKey: 'some.state',
						dataValue: 'VALUE',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when ControlWifi is absent', () => {
			// Arrange
			const deviceModel = {
				OtherProperty: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
					},
				},
			};

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

		it('should handle WMStop as non-object gracefully', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: 'string-value',
					WMOff: {
						dataKey: 'washerDryer.state',
						dataValue: 'OFF',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.dataValue).toBe('OFF');
		});

		it('should include optional command field when present', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						command: 'Operation',
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.command).toBe('Operation');
		});

		it('should omit command field when absent', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.command).toBeUndefined();
		});

		it('should handle dataSetList when present', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
						dataSetList: {
							course: 'value1',
							spin: 'value2',
						},
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList).toBeDefined();
			expect(result?.dataSetList?.course).toBe('value1');
			expect(result?.dataSetList?.spin).toBe('value2');
		});

		it('should fallback to data field when dataSetList is absent', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
						data: {
							course: 'value1',
						},
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList).toBeDefined();
			expect(result?.dataSetList?.course).toBe('value1');
		});

		it('should prefer dataSetList over data field', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
						dataSetList: {
							course: 'from-dataSetList',
						},
						data: {
							course: 'from-data',
						},
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
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 123,
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataValue).toBe(123);
		});

		it('should handle boolean dataValue', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: true,
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataValue).toBe(true);
		});

		it('should handle null dataValue', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: null,
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataValue).toBeNull();
		});

		it('should omit dataSetList when neither dataSetList nor data are objects', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
						dataSetList: 'not-an-object',
						data: 'also-not-an-object',
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result?.dataSetList).toBeUndefined();
		});

		it('should handle ControlWifi as non-object gracefully', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: 'not-an-object',
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should handle deeply nested undefined properties gracefully', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						dataKey: undefined,
						dataValue: undefined,
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.dataKey).toBeUndefined();
			expect(result?.dataValue).toBeUndefined();
		});

		it('should include all fields from WMStop in payload', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStop: {
						command: 'Operation',
						dataKey: 'washerDryer.state',
						dataValue: 'STOP',
						dataSetList: { course: 'express' },
					},
				},
			};

			// Act
			const result = extractWasherStopCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.command).toBe('Operation');
			expect(result?.dataKey).toBe('washerDryer.state');
			expect(result?.dataValue).toBe('STOP');
			expect(result?.dataSetList).toBeDefined();
		});
	});
});
