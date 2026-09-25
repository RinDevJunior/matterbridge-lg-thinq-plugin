import { describe, expect, it } from 'vitest';

import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import type { WasherCourseCatalog } from '../../../platform/thinq/thinqWasherCourseCatalogResolver.js';
import { reconcileWasherCourseConfig } from '../../../platform/thinq/thinqWasherCourseConfigReconciler.js';

describe('thinqWasherCourseConfigReconciler', () => {
	describe('reconcileWasherCourseConfig', () => {
		it('should push all catalog courses to empty washerControl', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 1200, valueType: 'number' },
							{ name: 'waterTemp', value: 60, valueType: 'number' },
						],
					},
					{
						id: 'courseB',
						parameters: [{ name: 'mode', value: 'delicate', valueType: 'string' }],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(true);
			expect(washerControl.courses).toHaveLength(2);
			expect(washerControl.courses?.[0]).toEqual({
				id: 'courseA',
				parameters: [
					{ name: 'spinSpeed', value: '1200', valueType: 'number' },
					{ name: 'waterTemp', value: '60', valueType: 'number' },
				],
			});
			expect(washerControl.courses?.[1]).toEqual({
				id: 'courseB',
				parameters: [{ name: 'mode', value: 'delicate', valueType: 'string' }],
			});
		});

		it('should not overwrite existing course entries, only add missing ones', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'spinSpeed', value: '1200', valueType: 'number' }],
					},
				],
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 1200, valueType: 'number' },
							{ name: 'waterTemp', value: 60, valueType: 'number' },
						],
					},
					{
						id: 'courseB',
						parameters: [{ name: 'mode', value: 'delicate', valueType: 'string' }],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(true); // Because courseB and waterTemp were added
			expect(washerControl.courses).toHaveLength(2);
			// courseA should have both spinSpeed (pre-existing) and waterTemp (newly added)
			expect(washerControl.courses?.[0].parameters).toHaveLength(2);
		});

		it('should not touch existing parameter values, only add missing parameters', () => {
			// Arrange
			const userEditedValue = '900'; // User changed from model default 1200
			const washerControl: ThinqWasherControlConfig = {
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'spinSpeed', value: userEditedValue, valueType: 'number' }],
					},
				],
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 1200, valueType: 'number' }, // Model default
							{ name: 'waterTemp', value: 60, valueType: 'number' }, // New parameter
						],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(true); // waterTemp was added
			const spinSpeedParam = washerControl.courses?.[0].parameters.find((p) => p.name === 'spinSpeed');
			expect(spinSpeedParam?.value).toBe(userEditedValue); // User's edit is preserved
		});

		it('should set selectedCourse to defaultCourseId when selectedCourse unset', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [],
				// selectedCourse is undefined
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(true);
			expect(washerControl.selectedCourse).toBe('courseA');
		});

		it('should not overwrite an already-set selectedCourse', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [],
				selectedCourse: 'courseB',
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [],
					},
					{
						id: 'courseB',
						parameters: [],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(washerControl.selectedCourse).toBe('courseB'); // Unchanged
		});

		it('should not correct a stale selectedCourse that no longer exists in catalog', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [],
				selectedCourse: 'staleOldCourse', // No longer in catalog
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(washerControl.selectedCourse).toBe('staleOldCourse'); // Left unchanged (handled downstream)
		});

		it('should not set selectedCourse when defaultCourseId is undefined', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [],
				// selectedCourse undefined
			};
			const catalog: WasherCourseCatalog = {
				// defaultCourseId undefined
				courses: [
					{
						id: 'courseA',
						parameters: [],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(washerControl.selectedCourse).toBeUndefined();
		});

		it('should return false when no changes are made', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'spinSpeed', value: '1200', valueType: 'number' }],
					},
				],
				selectedCourse: 'courseA',
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(false); // Nothing was added or changed
		});

		it('should add new parameters to existing course entries', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [
					{
						id: 'courseA',
						parameters: [{ name: 'spinSpeed', value: '1200', valueType: 'number' }],
					},
				],
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'spinSpeed', value: 1200, valueType: 'number' },
							{ name: 'waterTemp', value: 60, valueType: 'number' },
							{ name: 'enabled', value: true, valueType: 'boolean' },
						],
					},
				],
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(true);
			expect(washerControl.courses?.[0].parameters).toHaveLength(3);
			expect(washerControl.courses?.[0].parameters.map((p) => p.name)).toEqual(['spinSpeed', 'waterTemp', 'enabled']);
		});

		it('should convert parameter values to strings', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'numParam', value: 1200, valueType: 'number' },
							{ name: 'boolParam', value: true, valueType: 'boolean' },
							{ name: 'strParam', value: 'text', valueType: 'string' },
						],
					},
				],
			};

			// Act
			reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			const params = washerControl.courses?.[0].parameters;
			expect(params?.find((p) => p.name === 'numParam')?.value).toBe('1200');
			expect(params?.find((p) => p.name === 'boolParam')?.value).toBe('true');
			expect(params?.find((p) => p.name === 'strParam')?.value).toBe('text');
		});

		it('should handle empty catalog courses array', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {
				courses: [
					{
						id: 'oldCourse',
						parameters: [],
					},
				],
				// selectedCourse undefined
			};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [], // Empty
			};

			// Act
			const changed = reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			expect(changed).toBe(true); // Sets selectedCourse to defaultCourseId
			expect(washerControl.courses).toHaveLength(1); // Old course still there
			expect(washerControl.selectedCourse).toBe('courseA');
		});

		it('should preserve valueType when storing parameters', () => {
			// Arrange
			const washerControl: ThinqWasherControlConfig = {};
			const catalog: WasherCourseCatalog = {
				defaultCourseId: 'courseA',
				courses: [
					{
						id: 'courseA',
						parameters: [
							{ name: 'numParam', value: 100, valueType: 'number' },
							{ name: 'boolParam', value: false, valueType: 'boolean' },
						],
					},
				],
			};

			// Act
			reconcileWasherCourseConfig(washerControl, catalog);

			// Assert
			const params = washerControl.courses?.[0].parameters;
			expect(params?.find((p) => p.name === 'numParam')?.valueType).toBe('number');
			expect(params?.find((p) => p.name === 'boolParam')?.valueType).toBe('boolean');
		});
	});
});
