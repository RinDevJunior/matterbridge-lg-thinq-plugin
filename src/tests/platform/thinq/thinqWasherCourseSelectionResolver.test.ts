import { describe, expect, it } from 'vitest';

import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import { resolveWasherCourseSelectionFromConfig } from '../../../platform/thinq/thinqWasherCourseSelectionResolver.js';

describe('thinqWasherCourseSelectionResolver', () => {
	describe('resolveWasherCourseSelectionFromConfig', () => {
		it('should resolve courseId and coerce mixed valueTypes correctly', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: '1200', valueType: 'number' },
							{ name: 'waterTemp', value: '60', valueType: 'number' },
							{ name: 'mode', value: 'delicate', valueType: 'string' },
							{ name: 'enabled', value: 'true', valueType: 'boolean' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('courseA');
			expect(result.parameterOverrides ?? {}).toEqual({
				spinSpeed: 1200,
				waterTemp: 60,
				mode: 'delicate',
				enabled: true,
			});
		});

		it('should skip parameter with non-numeric string for number valueType', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 'abc', valueType: 'number' }, // Invalid number
							{ name: 'waterTemp', value: '60', valueType: 'number' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides ?? {}).toEqual({
				waterTemp: 60,
			});
			expect((result.parameterOverrides ?? {})['spinSpeed']).toBeUndefined();
		});

		it('should skip parameter with Infinity for number valueType', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 'Infinity', valueType: 'number' },
							{ name: 'waterTemp', value: '60', valueType: 'number' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides ?? {}).toEqual({
				waterTemp: 60,
			});
			expect((result.parameterOverrides ?? {})['spinSpeed']).toBeUndefined();
		});

		it('should skip parameter with NaN for number valueType', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 'NaN', valueType: 'number' },
							{ name: 'waterTemp', value: '60', valueType: 'number' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides ?? {}).toEqual({
				waterTemp: 60,
			});
			expect((result.parameterOverrides ?? {})['spinSpeed']).toBeUndefined();
		});

		it('should coerce string "true" to boolean true for boolean valueType', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'enabled', value: 'true', valueType: 'boolean' }],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect((result.parameterOverrides ?? {})['enabled']).toBe(true);
		});

		it('should coerce non-"true" string to boolean false for boolean valueType', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'enabled1', value: 'false', valueType: 'boolean' },
							{ name: 'enabled2', value: 'anything', valueType: 'boolean' },
							{ name: 'enabled3', value: '', valueType: 'boolean' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect((result.parameterOverrides ?? {})['enabled1']).toBe(false);
			expect((result.parameterOverrides ?? {})['enabled2']).toBe(false);
			expect((result.parameterOverrides ?? {})['enabled3']).toBe(false);
		});

		it('should return courseId undefined when selectedCourse unset', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				// selectedCourse undefined
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'param', value: 'value', valueType: 'string' }],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBeUndefined();
		});

		it('should return empty parameterOverrides when selectedCourse set but no matching course entry', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'unknownCourse',
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'param', value: 'value', valueType: 'string' }],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('unknownCourse'); // Still passed through
			expect(result.parameterOverrides ?? {}).toEqual({});
		});

		it('should return courseId when no matching course but courses array exists', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'missingCourse',
				courses: [],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('missingCourse');
			expect(result.parameterOverrides ?? {}).toEqual({});
		});

		it('should skip parameter with missing name', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: '', value: 'should-skip', valueType: 'string' }, // Empty name
							{ name: 'validParam', value: 'keep', valueType: 'string' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides ?? {}).toEqual({
				validParam: 'keep',
			});
		});

		it('should skip parameter with non-string name', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 123 as any, value: 'should-skip', valueType: 'string' }, // Non-string name
							{ name: 'validParam', value: 'keep', valueType: 'string' },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides ?? {}).toEqual({
				validParam: 'keep',
			});
		});

		it('should treat missing valueType as passthrough string', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'param1', value: 'text' /* valueType omitted */ },
							{ name: 'param2', value: '123', valueType: undefined },
						],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect((result.parameterOverrides ?? {})['param1']).toBe('text');
			expect((result.parameterOverrides ?? {})['param2']).toBe('123');
		});

		it('should return empty washerControl as undefined courseId with empty overrides', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBeUndefined();
			expect(result.parameterOverrides ?? {}).toEqual({});
		});

		it('should handle washerControl with no courses array', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				// courses undefined
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('courseA');
			expect(result.parameterOverrides ?? {}).toEqual({});
		});

		it('should convert 0 to number 0 correctly for number valueType', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'zeroParam', value: '0', valueType: 'number' }],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect((result.parameterOverrides ?? {})['zeroParam']).toBe(0);
		});

		it('should handle negative numbers correctly', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'negativeParam', value: '-500', valueType: 'number' }],
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect((result.parameterOverrides ?? {})['negativeParam']).toBe(-500);
		});
	});
});
