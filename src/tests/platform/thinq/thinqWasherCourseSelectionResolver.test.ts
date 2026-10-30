import { describe, expect, it } from 'vitest';

import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import { resolveWasherCourseSelectionFromConfig } from '../../../platform/thinq/thinqWasherCourseSelectionResolver.js';

describe('thinqWasherCourseSelectionResolver', () => {
	describe('resolveWasherCourseSelectionFromConfig', () => {
		it('should return courseId and parameterOverrides when selectedCourse set and matching entry exists', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: {
							spinSpeed: '1200',
							waterTemp: '60',
							mode: 'delicate',
						},
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('courseA');
			expect(result.parameterOverrides).toEqual({
				spinSpeed: '1200',
				waterTemp: '60',
				mode: 'delicate',
			});
		});

		it('should return a new object for parameterOverrides, not the same reference', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: { spinSpeed: '1200' },
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides).not.toBe(washerControl.courses?.[0].parameters);
			expect(result.parameterOverrides).toEqual(washerControl.courses?.[0].parameters);
		});

		it('should return undefined courseId when selectedCourse unset', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				// selectedCourse undefined
				courses: [
					{
						id: 'courseA',
						parameters: { param: 'value' },
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBeUndefined();
		});

		it('should pass through courseId even when no matching course entry found', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'unknownCourse',
				courses: [
					{
						id: 'courseA',
						parameters: { param: 'value' },
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('unknownCourse'); // Still passed through
			expect(result.parameterOverrides).toBeUndefined(); // But no overrides found
		});

		it('should return undefined parameterOverrides when no matching course entry found', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'missingCourse',
				courses: [
					{
						id: 'courseA',
						parameters: { param: 'value' },
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.parameterOverrides).toBeUndefined();
		});

		it('should return undefined parameterOverrides when courses array is empty', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('courseA');
			expect(result.parameterOverrides).toBeUndefined();
		});

		it('should return a distinct empty object when entry exists but has empty parameters', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: {},
					},
				],
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('courseA');
			expect(result.parameterOverrides).toBeDefined(); // Not undefined
			expect(result.parameterOverrides).toEqual({});
			expect(result.parameterOverrides).not.toBe(washerControl.courses?.[0].parameters); // Defensive copy
		});

		it('should return undefined courseId and parameterOverrides for empty washerControl', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBeUndefined();
			expect(result.parameterOverrides).toBeUndefined();
		});

		it('should return undefined parameterOverrides when courses array missing', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				selectedCourse: 'courseA',
				// courses undefined
			};

			// Act
			const result = resolveWasherCourseSelectionFromConfig(washerControl);

			// Assert
			expect(result.courseId).toBe('courseA');
			expect(result.parameterOverrides).toBeUndefined();
		});
	});
});
