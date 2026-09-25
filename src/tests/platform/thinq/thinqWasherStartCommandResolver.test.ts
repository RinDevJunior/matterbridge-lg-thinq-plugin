import { describe, expect, it } from 'vitest';

import { extractWasherStartCommand } from '../../../platform/thinq/thinqWasherStartCommandResolver.js';

describe('thinqWasherStartCommandResolver', () => {
	describe('extractWasherStartCommand', () => {
		it('should extract WMStart command from full valid model JSON', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {
								course: 'express',
								spinSpeed: 1000,
								waterTemp: 40,
							},
						},
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
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.command).toBe('Set');
			expect(result?.dataSetList).toBeDefined();
			expect(result?.dataSetList?.['washerDryer']).toBeDefined();
			expect((result?.dataSetList?.['washerDryer'] as Record<string, unknown>)?.['course']).toBe('express');
			expect((result?.dataSetList?.['washerDryer'] as Record<string, unknown>)?.['spinSpeed']).toBe(1200); // From function array default
			expect((result?.dataSetList?.['washerDryer'] as Record<string, unknown>)?.['waterTemp']).toBe(60); // From function array default
		});

		it('should merge template fields with course function defaults', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {
								templateField1: 'template-value',
							},
						},
					},
				},
				Config: {
					defaultCourse: 'normal',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					normal: {
						function: [
							{ value: 'courseField1', default: 'course-default-1' },
							{ value: 'courseField2', default: 'course-default-2' },
						],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			const inner = result?.dataSetList?.['washerDryer'] as Record<string, unknown>;
			expect(inner?.['templateField1']).toBe('template-value');
			expect(inner?.['courseField1']).toBe('course-default-1');
			expect(inner?.['courseField2']).toBe('course-default-2');
		});

		it('should set course selector field based on Config.courseType', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'delicate',
					courseType: 'selectedCourse',
					smartCourseType: 'smartCourse',
				},
				Course: {
					delicate: {
						function: [{ value: 'tempSetting', default: 30 }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			const inner = result?.dataSetList?.['washerDryer'] as Record<string, unknown>;
			expect(inner?.['selectedCourse']).toBe('delicate');
		});

		it('should set smart course field to NOT_SELECTED based on Config.smartCourseType', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'eco',
					courseType: 'course',
					smartCourseType: 'smartCourseName',
				},
				Course: {
					eco: {
						function: [{ value: 'mode', default: 'eco' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			const inner = result?.dataSetList?.['washerDryer'] as Record<string, unknown>;
			expect(inner?.['smartCourseName']).toBe('NOT_SELECTED');
		});

		it('should skip malformed function entries and include only valid ones', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'mixed',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					mixed: {
						function: [
							{ value: 'validField1', default: 'value1' }, // Valid
							{ value: 123, default: 'value2' }, // Invalid: value not a string
							{ /* missing 'value' */ default: 'value3' }, // Invalid: missing value
							{ value: 'validField2' /* missing 'default' key */ }, // Invalid: no default key
							{ value: 'validField3', default: false }, // Valid: default is falsy but present
						],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			const inner = result?.dataSetList?.['washerDryer'] as Record<string, unknown>;
			expect(inner?.['validField1']).toBe('value1');
			expect(inner?.['validField3']).toBe(false);
			expect(Object.keys(result?.dataSetList?.['washerDryer'] || {}).length).toBe(4); // template + 2 valid + course + smartCourse
		});

		it('should include falsy defaults (0, false, empty string) in merged payload', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'test',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					test: {
						function: [
							{ value: 'field0', default: 0 },
							{ value: 'fieldFalse', default: false },
							{ value: 'fieldEmpty', default: '' },
						],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			const inner = result?.dataSetList?.['washerDryer'] as Record<string, unknown>;
			expect(inner?.['field0']).toBe(0);
			expect(inner?.['fieldFalse']).toBe(false);
			expect(inner?.['fieldEmpty']).toBe('');
		});

		it('should return undefined when deviceModel is not an object', () => {
			// Arrange & Act & Assert
			expect(extractWasherStartCommand(null as any)).toBeUndefined();
			expect(extractWasherStartCommand(undefined as any)).toBeUndefined();
			expect(extractWasherStartCommand('string' as any)).toBeUndefined();
			expect(extractWasherStartCommand(123 as any)).toBeUndefined();
		});

		it('should return undefined when ControlWifi is missing', () => {
			// Arrange
			const deviceModel = {
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when ControlWifi is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: 'not-an-object',
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMStart is missing', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					OtherCommand: { data: {} },
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMStart is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: 'not-an-object',
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMStart.data is missing', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						// Missing 'data' field
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMStart.data is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: 'not-an-object',
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when WMStart.data is an empty object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should use the first key in data as the device key', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							firstDevice: {
								field: 'first-value',
							},
							secondDevice: {
								field: 'second-value',
							},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'default' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result?.dataSetList?.firstDevice).toBeDefined();
		});

		it('should return undefined when template inner object is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: 'not-an-object',
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Config is missing', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Config is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: 'not-an-object',
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when defaultCourse is missing from Config', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when defaultCourse is not a string', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 123,
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when courseType is missing from Config', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when courseType is not a string', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 123,
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when smartCourseType is missing from Config', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when smartCourseType is not a string', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 123,
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course is missing', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: 'not-an-object',
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course[defaultCourse] does not exist', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					delicate: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course[defaultCourse] is not an object', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: 'not-an-object',
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course[defaultCourse].function is missing', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						// Missing 'function' field
						otherField: 'value',
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course[defaultCourse].function is not an array', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: 'not-an-array',
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when function array is empty', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when all function entries are malformed', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {},
						},
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
							{ value: 123, default: 'value1' }, // value not string
							{ /* missing 'value' */ default: 'value2' },
							{ value: 'noDefault' }, // missing 'default' key
						],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return payload with undefined command when startEntry.command is missing', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						// Missing 'command' field
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.command).toBeUndefined();
			expect(result?.dataSetList).toBeDefined();
		});

		it('should return payload with undefined command when startEntry.command is not a string', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 123,
						data: {
							washerDryer: {},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'field', default: 'value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.command).toBeUndefined();
			expect(result?.dataSetList).toBeDefined();
		});

		it('should prefer course defaults over template fields', () => {
			// Arrange
			const deviceModel = {
				ControlWifi: {
					WMStart: {
						command: 'Set',
						data: {
							washerDryer: {
								sharedField: 'template-value',
							},
						},
					},
				},
				Config: {
					defaultCourse: 'express',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
				Course: {
					express: {
						function: [{ value: 'sharedField', default: 'course-value' }],
					},
				},
			};

			// Act
			const result = extractWasherStartCommand(deviceModel);

			// Assert
			const inner = result?.dataSetList?.['washerDryer'] as Record<string, unknown>;
			expect(inner?.['sharedField']).toBe('course-value');
		});
	});
});
