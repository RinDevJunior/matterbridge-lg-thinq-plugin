import { describe, expect, it } from 'vitest';

import { extractWasherCourseCatalog } from '../../../platform/thinq/thinqWasherCourseCatalogResolver.js';

describe('thinqWasherCourseCatalogResolver', () => {
	describe('extractWasherCourseCatalog', () => {
		it('should extract full catalog from valid model with 2+ courses', () => {
			// Arrange
			const deviceModel = {
				Course: {
					courseA: {
						function: [
							{ value: 'spinSpeed', default: 1200 },
							{ value: 'waterTemp', default: 60 },
						],
					},
					courseB: {
						function: [
							{ value: 'spinSpeed', default: 800 },
							{ value: 'waterTemp', default: 40 },
							{ value: 'enabled', default: true },
						],
					},
				},
				Config: {
					defaultCourse: 'courseA',
					courseType: 'course',
					smartCourseType: 'smartCourse',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.defaultCourseId).toBe('courseA');
			expect(result?.courses).toHaveLength(2);
			expect(result?.courses[0]).toEqual({
				id: 'courseA',
				parameters: expect.arrayContaining([
					{ name: 'spinSpeed', value: 1200, valueType: 'number' },
					{ name: 'waterTemp', value: 60, valueType: 'number' },
				]),
			});
			expect(result?.courses[1]).toEqual({
				id: 'courseB',
				parameters: expect.arrayContaining([
					{ name: 'spinSpeed', value: 800, valueType: 'number' },
					{ name: 'waterTemp', value: 40, valueType: 'number' },
					{ name: 'enabled', value: true, valueType: 'boolean' },
				]),
			});
		});

		it('should skip course with missing function array', () => {
			// Arrange
			const deviceModel = {
				Course: {
					validCourse: {
						function: [{ value: 'param', default: 'value' }],
					},
					missingFunction: {
						// No function array
					},
				},
				Config: {
					defaultCourse: 'validCourse',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result?.courses).toHaveLength(1);
			expect(result?.courses[0].id).toBe('validCourse');
		});

		it('should skip course with empty function array', () => {
			// Arrange
			const deviceModel = {
				Course: {
					validCourse: {
						function: [{ value: 'param', default: 'value' }],
					},
					emptyCourse: {
						function: [],
					},
				},
				Config: {
					defaultCourse: 'validCourse',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result?.courses).toHaveLength(1);
			expect(result?.courses[0].id).toBe('validCourse');
		});

		it('should skip course with only malformed function entries', () => {
			// Arrange
			const deviceModel = {
				Course: {
					validCourse: {
						function: [{ value: 'param', default: 'value' }],
					},
					malformedCourse: {
						function: [
							{ value: 123, default: 'value' }, // value not a string
							{ /* missing 'value' */ default: 'value' },
						],
					},
				},
				Config: {
					defaultCourse: 'validCourse',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result?.courses).toHaveLength(1);
			expect(result?.courses[0].id).toBe('validCourse');
		});

		it('should return undefined when all courses are malformed', () => {
			// Arrange
			const deviceModel = {
				Course: {
					badCourse1: {
						function: [{ value: 123, default: 'value' }],
					},
					badCourse2: {
						function: [],
					},
				},
				Config: {
					defaultCourse: 'badCourse1',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course is missing', () => {
			// Arrange
			const deviceModel = {
				Config: {
					defaultCourse: 'express',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result).toBeUndefined();
		});

		it('should return undefined when Course is not an object', () => {
			// Arrange & Act & Assert
			expect(extractWasherCourseCatalog({ Course: 'not-an-object' })).toBeUndefined();
			expect(extractWasherCourseCatalog({ Course: null })).toBeUndefined();
			expect(extractWasherCourseCatalog({ Course: 123 })).toBeUndefined();
		});

		it('should return undefined when deviceModel is not an object', () => {
			// Arrange & Act & Assert
			expect(extractWasherCourseCatalog(null as any)).toBeUndefined();
			expect(extractWasherCourseCatalog(undefined as any)).toBeUndefined();
			expect(extractWasherCourseCatalog('string' as any)).toBeUndefined();
			expect(extractWasherCourseCatalog(123 as any)).toBeUndefined();
		});

		it('should infer valueType correctly for string default', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [{ value: 'waterTemp', default: 'cold' }],
					},
				},
				Config: { defaultCourse: 'course1' },
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			const param = result?.courses[0].parameters[0];
			expect(param?.valueType).toBe('string');
			expect(param?.value).toBe('cold');
		});

		it('should infer valueType correctly for number default', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [{ value: 'spinSpeed', default: 1200 }],
					},
				},
				Config: { defaultCourse: 'course1' },
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			const param = result?.courses[0].parameters[0];
			expect(param?.valueType).toBe('number');
			expect(param?.value).toBe(1200);
		});

		it('should infer valueType correctly for boolean default', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [{ value: 'enabled', default: true }],
					},
				},
				Config: { defaultCourse: 'course1' },
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			const param = result?.courses[0].parameters[0];
			expect(param?.valueType).toBe('boolean');
			expect(param?.value).toBe(true);
		});

		it('should infer valueType as "other" for array/object/null default', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [
							{ value: 'arrayParam', default: [] },
							{ value: 'objectParam', default: {} },
							{ value: 'nullParam', default: null },
						],
					},
				},
				Config: { defaultCourse: 'course1' },
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			const params = result?.courses[0].parameters;
			expect(params?.find((p) => p.name === 'arrayParam')?.valueType).toBe('other');
			expect(params?.find((p) => p.name === 'objectParam')?.valueType).toBe('other');
			expect(params?.find((p) => p.name === 'nullParam')?.valueType).toBe('other');
		});

		it('should set defaultCourseId to undefined when Config missing', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [{ value: 'param', default: 'value' }],
					},
				},
				// No Config
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result?.defaultCourseId).toBeUndefined();
			expect(result?.courses).toHaveLength(1);
		});

		it('should set defaultCourseId to undefined when Config.defaultCourse is not a string', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [{ value: 'param', default: 'value' }],
					},
				},
				Config: {
					defaultCourse: 123, // Not a string
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result?.defaultCourseId).toBeUndefined();
			expect(result?.courses).toHaveLength(1);
		});

		it('should return catalog even when defaultCourse is invalid but courses exist', () => {
			// Arrange
			const deviceModel = {
				Course: {
					validCourse: {
						function: [{ value: 'param', default: 'value' }],
					},
				},
				Config: {
					defaultCourse: null, // Invalid
					courseType: 'course',
				},
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			expect(result).toBeDefined();
			expect(result?.defaultCourseId).toBeUndefined();
			expect(result?.courses).toHaveLength(1);
		});

		it('should skip function entries without default key', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [
							{ value: 'param1', default: 'value1' },
							{ value: 'param2' }, // Missing 'default' key
							{ value: 'param3', default: 'value3' },
						],
					},
				},
				Config: { defaultCourse: 'course1' },
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			const params = result?.courses[0].parameters;
			expect(params).toHaveLength(2);
			expect(params?.map((p) => p.name)).toEqual(['param1', 'param3']);
		});

		it('should include falsy defaults (0, false, empty string) in parameters', () => {
			// Arrange
			const deviceModel = {
				Course: {
					course1: {
						function: [
							{ value: 'zeroParam', default: 0 },
							{ value: 'falseParam', default: false },
							{ value: 'emptyParam', default: '' },
						],
					},
				},
				Config: { defaultCourse: 'course1' },
			};

			// Act
			const result = extractWasherCourseCatalog(deviceModel);

			// Assert
			const params = result?.courses[0].parameters;
			expect(params?.find((p) => p.name === 'zeroParam')).toEqual({
				name: 'zeroParam',
				value: 0,
				valueType: 'number',
			});
			expect(params?.find((p) => p.name === 'falseParam')).toEqual({
				name: 'falseParam',
				value: false,
				valueType: 'boolean',
			});
			expect(params?.find((p) => p.name === 'emptyParam')).toEqual({
				name: 'emptyParam',
				value: '',
				valueType: 'string',
			});
		});
	});
});
