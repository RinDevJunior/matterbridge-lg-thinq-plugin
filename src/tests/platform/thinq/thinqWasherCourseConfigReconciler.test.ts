import { describe, expect, it } from 'vitest';

import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import type { WasherCourseCatalog } from '../../../platform/thinq/thinqWasherCourseCatalogResolver.js';
import { reconcileWasherCourseConfig } from '../../../platform/thinq/thinqWasherCourseConfigReconciler.js';

describe('thinqWasherCourseConfigReconciler', () => {
	describe('reconcileWasherCourseConfig', () => {
		describe('availableCourseIds backfill', () => {
			it('should populate availableCourseIds with all catalog course ids when empty', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{ id: 'courseA', parameters: [] },
						{ id: 'courseB', parameters: [] },
						{ id: 'courseC', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.availableCourseIds).toEqual(['courseA', 'courseB', 'courseC']);
			});

			it('should not reassign availableCourseIds when already in sync with catalog', () => {
				// Arrange
				const availableCourseIds = ['courseA', 'courseB', 'courseC'];
				const washerControl: ThinqWasherControlConfig = {
					availableCourseIds,
					selectedCourse: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '1200' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
						},
						{ id: 'courseB', parameters: [] },
						{ id: 'courseC', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(false); // No changes: courses already reconciled, availableCourseIds in sync
				expect(washerControl.availableCourseIds).toBe(availableCourseIds); // Same reference (not reassigned)
			});

			it('should replace availableCourseIds when catalog gains new course id', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {
					availableCourseIds: ['courseA', 'courseB'],
					selectedCourse: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '1200' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
						},
						{ id: 'courseB', parameters: [] },
						{ id: 'courseC', parameters: [] }, // New course
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.availableCourseIds).toEqual(['courseA', 'courseB', 'courseC']);
			});
		});

		describe('selecting for the first time (no selectedCourse yet)', () => {
			it('should set selectedCourse to defaultCourseId and backfill only that course', () => {
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
				expect(washerControl.selectedCourse).toBe('courseA');
				expect(washerControl.courses).toHaveLength(1); // ONLY courseA, NOT courseB
				expect(washerControl.courses?.[0]).toEqual({
					id: 'courseA',
					parameters: {
						spinSpeed: '1200',
						waterTemp: '60',
					},
				});
			});

			it('should not set selectedCourse or backfill when defaultCourseId is undefined', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {};
				const catalog: WasherCourseCatalog = {
					// defaultCourseId undefined
					courses: [
						{ id: 'courseA', parameters: [] },
						{ id: 'courseB', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true); // availableCourseIds was populated
				expect(washerControl.availableCourseIds).toEqual(['courseA', 'courseB']);
				expect(washerControl.selectedCourse).toBeUndefined(); // Not set without defaultCourseId
				expect(washerControl.courses).toBeUndefined(); // Not backfilled without selection
			});
		});

		describe('selecting a DIFFERENT course (switch behavior)', () => {
			it('should replace courses with fresh defaults when selectedCourse changes to different course', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseB',
					courses: [
						{
							id: 'courseA',
							parameters: {
								spinSpeed: '900', // User-edited from courseA default 1200
							},
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
						},
						{
							id: 'courseB',
							parameters: [
								{ name: 'spinSpeed', value: 800, valueType: 'number' }, // Different default than courseA
								{ name: 'waterTemp', value: 40, valueType: 'number' },
							],
						},
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.courses).toHaveLength(1);
				expect(washerControl.courses?.[0].id).toBe('courseB');
				// courseB's fresh defaults used, NOT courseA's old values
				expect(washerControl.courses?.[0].parameters).toEqual({
					spinSpeed: '800',
					waterTemp: '40',
				});
			});

			it('should use fresh defaults for shared parameter names when switching courses', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseB',
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '900' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
						},
						{
							id: 'courseB',
							parameters: [{ name: 'spinSpeed', value: 500, valueType: 'number' }], // Same param name, different default
						},
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.courses?.[0].parameters['spinSpeed']).toBe('500'); // courseB's default, NOT courseA's old value of '900'
			});
		});

		describe('preserving user edits on the currently selected course', () => {
			it('should preserve user-edited parameter value on the same selected course', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					availableCourseIds: ['courseA'], // Pre-populated so it doesn't change
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '900' }, // User-edited from 1200
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }], // Model default
						},
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(false); // Nothing changed (availableCourseIds in sync, no new params)
				expect(washerControl.courses?.[0].parameters['spinSpeed']).toBe('900'); // User's edit preserved exactly
			});

			it('should append new parameters while preserving user edits on selected course', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '900' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [
								{ name: 'spinSpeed', value: 1200, valueType: 'number' }, // Existing (user-edited)
								{ name: 'waterTemp', value: 60, valueType: 'number' }, // New parameter
							],
						},
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.courses).toHaveLength(1); // Still 1 course, NOT added others
				expect(Object.keys(washerControl.courses?.[0].parameters ?? {})).toHaveLength(2);
				// Existing spinSpeed preserved
				expect(washerControl.courses?.[0].parameters['spinSpeed']).toBe('900');
				// New waterTemp appended
				expect(washerControl.courses?.[0].parameters['waterTemp']).toBe('60');
			});
		});

		describe('migration self-healing (pre-fix bloat cleanup)', () => {
			it('should prune multiple course entries down to selected course on first pass', () => {
				// Arrange: simulate a config bloated by pre-fix code (3 courses stored)
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '900' }, // User-edited
						},
						{
							id: 'courseB',
							parameters: { mode: 'delicate' },
						},
						{
							id: 'courseC',
							parameters: { temp: '40' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
						},
						{ id: 'courseB', parameters: [] },
						{ id: 'courseC', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.courses).toHaveLength(1); // Pruned to just courseA
				expect(washerControl.courses?.[0].id).toBe('courseA');
				// User's spinSpeed edit preserved
				expect(washerControl.courses?.[0].parameters['spinSpeed']).toBe('900');
			});

			it('should return false on second reconcile after pruning (idempotent)', () => {
				// Arrange: already pruned config from previous pass (all fields in sync)
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					availableCourseIds: ['courseA', 'courseB', 'courseC'], // Pre-synced
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: '900' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: 1200, valueType: 'number' }],
						},
						{ id: 'courseB', parameters: [] },
						{ id: 'courseC', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(false); // No changes on second pass
				expect(washerControl.courses).toHaveLength(1); // Unchanged
			});
		});

		describe('malformed existing entry self-heal (legacy shape)', () => {
			it('should detect legacy array-shaped parameters and force full rebuild', () => {
				// Arrange: simulate a legacy config with array-shaped parameters (pre-Amendment 2)
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [{ name: 'spinSpeed', value: '900', valueType: 'number' }] as unknown as Record<
								string,
								string
							>, // Cast to prove runtime guard, not compiler
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
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert: force full rebuild, not merge
				expect(changed).toBe(true);
				expect(washerControl.courses).toHaveLength(1);
				expect(washerControl.courses?.[0].id).toBe('courseA');
				// Verify fresh parameters from catalog (old '900' array value is gone)
				expect(washerControl.courses?.[0].parameters).toEqual({
					spinSpeed: '1200',
					waterTemp: '60',
				});
			});

			it('should detect object parameters with non-string values and force full rebuild', () => {
				// Arrange: object-shaped parameters with a stray non-string value
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: { spinSpeed: 900 } as unknown as Record<string, string>, // Raw number, not string
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
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert: force full rebuild, not additive merge (which would keep bad 900 forever)
				expect(changed).toBe(true);
				expect(washerControl.courses).toHaveLength(1);
				expect(washerControl.courses?.[0].id).toBe('courseA');
				// Verify fresh parameters from catalog, bad value gone
				expect(washerControl.courses?.[0].parameters).toEqual({
					spinSpeed: '1200',
					waterTemp: '60',
				});
			});
		});

		describe('stale/invalid selectedCourse (fail-closed)', () => {
			it('should leave courses untouched when selectedCourse does not exist in catalog', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'staleOldCourse', // Not in catalog
					courses: [
						{
							id: 'staleOldCourse',
							parameters: { spinSpeed: '900' },
						},
					],
				};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{ id: 'courseA', parameters: [] },
						{ id: 'courseB', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				// availableCourseIds still updated
				expect(washerControl.availableCourseIds).toEqual(['courseA', 'courseB']);
				// But courses[] left untouched (fail-closed)
				expect(washerControl.courses).toHaveLength(1);
				expect(washerControl.courses?.[0].id).toBe('staleOldCourse');
				// changed may be true (for availableCourseIds) or false (if availableCourseIds didn't change)
				// so we test it separately from the courses preservation
			});
		});

		describe('idempotency / no-op case', () => {
			it('should return false and not reassign when fully reconciled', () => {
				// Arrange: fully reconciled config
				const courses: ThinqWasherControlConfig['courses'] = [
					{
						id: 'courseA',
						parameters: {
							spinSpeed: '1200',
							waterTemp: '60',
						},
					},
				];
				const availableCourseIds = ['courseA', 'courseB'];
				const washerControl: ThinqWasherControlConfig = {
					selectedCourse: 'courseA',
					courses,
					availableCourseIds,
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
						{ id: 'courseB', parameters: [] },
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(false);
				// Reference equality: arrays not reassigned (no object recreation)
				expect(washerControl.courses).toBe(courses);
				expect(washerControl.availableCourseIds).toBe(availableCourseIds);
				expect(washerControl.courses?.[0]).toBe(courses[0]);
			});
		});

		describe('value stringification', () => {
			it('should convert parameter values to strings on fresh backfill', () => {
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
				expect(params?.['numParam']).toBe('1200');
				expect(params?.['boolParam']).toBe('true');
				expect(params?.['strParam']).toBe('text');
			});
		});

		describe('edge cases', () => {
			it('should handle empty catalog gracefully when selectedCourse is unset', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {};
				const catalog: WasherCourseCatalog = {
					// defaultCourseId undefined
					courses: [], // Empty
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(false); // availableCourseIds comparison finds [] === [], no assignment needed
				expect(washerControl.availableCourseIds).toBeUndefined(); // Not assigned when equal
				expect(washerControl.selectedCourse).toBeUndefined();
				expect(washerControl.courses).toBeUndefined();
			});

			it('should handle empty parameter list for a course', () => {
				// Arrange
				const washerControl: ThinqWasherControlConfig = {};
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [{ id: 'courseA', parameters: [] }],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				expect(changed).toBe(true);
				expect(washerControl.selectedCourse).toBe('courseA');
				expect(washerControl.courses?.[0]).toEqual({ id: 'courseA', parameters: {} });
			});

			it('should not add duplicate parameters if catalog has duplicates', () => {
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
				const catalog: WasherCourseCatalog = {
					defaultCourseId: 'courseA',
					courses: [
						{
							id: 'courseA',
							parameters: [
								{ name: 'spinSpeed', value: 1200, valueType: 'number' },
								{ name: 'spinSpeed', value: 1400, valueType: 'number' }, // Duplicate name (shouldn't happen in real data)
							],
						},
					],
				};

				// Act
				const changed = reconcileWasherCourseConfig(washerControl, catalog);

				// Assert
				// Object keys are inherently unique, so duplicate names naturally collapse
				expect(Object.keys(washerControl.courses?.[0].parameters ?? {})).toHaveLength(1);
			});
		});
	});
});
