import type { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasherControls, LaundryWasherMode, TemperatureControl } from 'matterbridge/matter/clusters';
import { describe, expect, it, vi } from 'vitest';

import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import {
	applyWasherSelectionDisplay,
	buildWasherEndpointClusterOptions,
	CANONICAL_RINSE_ENUM,
	courseIdToMode,
	MATTER_RINSE_ORDER,
	matterRinseToEnum,
	modeToCourseId,
	readWasherCourseOption,
	resolveWasherMatterPlan,
	rinseEnumToMatter,
	spinEnumToIndex,
	spinEnumToLabel,
	spinIndexToEnum,
	supportedRinsesOf,
	tempEnumToIndex,
	tempEnumToLabel,
	tempIndexToEnum,
	washerCourseLabel,
	type WasherCourseOptionList,
	type WasherEndpointClusterOptions,
	type WasherMatterPlan,
	washerMatterPlanRefusalReason,
} from '../../../platform/thinq/thinqWasherMatterPlan.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

/**
 * Trimmed model: NORMAL lists all four option keys, COLDWASH has a fixed temp (no selectable),
 * DRUM_CARE lists none of the four keys. Sorted course ids: COLDWASH (1), DRUM_CARE (2), NORMAL (3).
 */
function buildWasherModel(): Record<string, unknown> {
	return {
		Config: { defaultCourse: 'NORMAL', courseType: 'course', smartCourseType: 'SmartCourse' },
		Course: {
			NORMAL: {
				function: [
					{ value: 'spin', default: 'SPIN_1400', selectable: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'] },
					{ value: 'temp', default: 'TEMP_40', selectable: ['TEMP_COLD', 'TEMP_40', 'TEMP_60'] },
					{
						value: 'rinse',
						default: 'RINSE_2',
						selectable: ['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'],
					},
					{ value: 'soilWash', default: 'SOILWASH_NORMAL', selectable: ['SOILWASH_NORMAL', 'SOILWASH_HEAVY'] },
				],
			},
			COLDWASH: {
				function: [{ value: 'temp', default: 'TEMP_COLD' }],
			},
			DRUM_CARE: {
				function: [{ value: 'drumClean', default: 'DRUM_CLEAN_ON', selectable: ['DRUM_CLEAN_ON'] }],
			},
		},
	};
}

/**
 * Shrink model: NORMAL (Normal) lists spin, temp and rinse; LIGHT lists only spin and temp, with
 * a smaller spin/temp set. Sorted ids: LIGHT (1), NORMAL (2).
 */
function buildShrinkModel(): Record<string, unknown> {
	return {
		Config: { defaultCourse: 'NORMAL' },
		Course: {
			NORMAL: {
				function: [
					{ value: 'spin', default: 'SPIN_1400', selectable: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'] },
					{ value: 'temp', default: 'TEMP_40', selectable: ['TEMP_COLD', 'TEMP_40', 'TEMP_60'] },
					{ value: 'rinse', default: 'RINSE_2', selectable: ['RINSE_1', 'RINSE_2'] },
				],
			},
			LIGHT: {
				function: [
					{ value: 'spin', default: 'SPIN_800', selectable: ['SPIN_400', 'SPIN_800'] },
					{ value: 'temp', default: 'TEMP_20', selectable: ['TEMP_COLD', 'TEMP_20'] },
				],
			},
		},
	};
}

/**
 * NORMAL's spin default `SPIN_999` is not in its own selectable list. Temp and rinse are normal.
 * Sorted ids: NORMAL (1), OTHER (2).
 */
function buildDefaultOutsideListModel(): Record<string, unknown> {
	return {
		Config: { defaultCourse: 'NORMAL' },
		Course: {
			NORMAL: {
				function: [
					{ value: 'spin', default: 'SPIN_999', selectable: ['SPIN_800', 'SPIN_1400'] },
					{ value: 'temp', default: 'TEMP_40', selectable: ['TEMP_COLD', 'TEMP_40'] },
					{ value: 'rinse', default: 'RINSE_2', selectable: ['RINSE_1', 'RINSE_2'] },
				],
			},
			OTHER: { function: [] },
		},
	};
}

function buildPlan(model: Record<string, unknown> = buildWasherModel()): WasherMatterPlan {
	const plan = resolveWasherMatterPlan(model);
	if (plan === undefined) {
		throw new Error('fixture model must produce a plan');
	}
	return plan;
}

function listOf(values: string[], defaultValue: string, writable = true): WasherCourseOptionList {
	return { values, defaultValue, writable };
}

function createMockWasherEndpoint(): MatterbridgeEndpoint {
	return asPartial<MatterbridgeEndpoint>({
		updateAttribute: vi.fn().mockResolvedValue(true),
	});
}

function snapshotOf(washerDryer: Record<string, unknown>): ThinqSnapshot {
	return new ThinqSnapshot({ washerDryer });
}

/** Fails the test with a clear message when the fixture does not yield cluster options. */
function buildClusterOptionsOrFail(
	plan: WasherMatterPlan,
	snapshot: ThinqSnapshot,
	logger?: ReturnType<typeof createMockLogger>,
): WasherEndpointClusterOptions {
	const options = buildWasherEndpointClusterOptions(plan, snapshot, logger);
	if (options === undefined) {
		throw new Error('expected cluster options for this fixture, got undefined');
	}
	return options;
}

describe('thinqWasherMatterPlan', () => {
	describe('resolveWasherMatterPlan', () => {
		it('should return modes sorted by course id with a 1-based contiguous mode number', () => {
			// Arrange
			const model = buildWasherModel();

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan?.modes.map((entry) => entry.courseId)).toEqual(['COLDWASH', 'DRUM_CARE', 'NORMAL']);
			expect(plan?.modes.map((entry) => entry.mode)).toEqual([1, 2, 3]);
		});

		it('should mark exactly one mode as Normal and make it Config.defaultCourse', () => {
			// Arrange
			const model = buildWasherModel();

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			const normalModes = plan?.modes.filter((entry) => entry.isNormal) ?? [];
			expect(normalModes).toHaveLength(1);
			expect(normalModes[0]?.courseId).toBe('NORMAL');
			expect(plan?.normalCourseId).toBe('NORMAL');
		});

		it('should make the first sorted id Normal when Config.defaultCourse is missing from Course', () => {
			// Arrange
			const model = { ...buildWasherModel(), Config: { defaultCourse: 'GHOST' } };

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan?.normalCourseId).toBe('COLDWASH');
			expect(plan?.modes.filter((entry) => entry.isNormal).map((entry) => entry.courseId)).toEqual(['COLDWASH']);
		});

		it('should return undefined when the model has no Course map', () => {
			// Arrange
			const model = { Config: { defaultCourse: 'NORMAL' } };

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan).toBeUndefined();
		});

		it('should return undefined when Course is not a record', () => {
			// Arrange
			const model = { Course: ['NORMAL', 'COLDWASH'] };

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan).toBeUndefined();
		});

		it('should skip a course entry that is an array and keep the record courses', () => {
			// Arrange
			const model = {
				Course: {
					NORMAL: { function: [] },
					COLDWASH: { function: [] },
					BROKEN: ['SPIN_800', 'TEMP_40'],
				},
			};

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan?.modes.map((entry) => entry.courseId)).toEqual(['COLDWASH', 'NORMAL']);
			expect(plan?.optionsOf('BROKEN')).toBeUndefined();
		});

		it('should return undefined when Course has fewer than 2 record entries', () => {
			// Arrange
			const model = { Course: { NORMAL: { function: [] }, BROKEN: 'not-a-record' } };

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan).toBeUndefined();
		});

		it('should return undefined when Course is empty', () => {
			// Arrange
			const model = { Course: {} };

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			expect(plan).toBeUndefined();
		});

		it('should give unique labels by adding a disambiguating suffix when two ids normalise to the same label', () => {
			// Arrange
			const model = {
				Course: {
					TURBO_39: { function: [] },
					TURBO__39: { function: [] },
				},
			};

			// Act
			const plan = resolveWasherMatterPlan(model);

			// Assert
			const labels = plan?.modes.map((entry) => entry.label) ?? [];
			expect(labels).toHaveLength(2);
			expect(labels[0]).not.toBe(labels[1]);
			expect(labels[1]).toMatch(/ \(2\)$/);
		});
	});

	describe('washerCourseLabel', () => {
		it('should title-case an underscore-separated id', () => {
			// Arrange
			const courseId = 'SLEEVEHEMS_AND_COLLARS';

			// Act
			const label = washerCourseLabel(courseId);

			// Assert
			expect(label).toBe('Sleevehems And Collars');
		});

		it('should title-case a digit-suffixed id without splitting it', () => {
			// Arrange
			const courseId = 'TURBO39';

			// Act
			const label = washerCourseLabel(courseId);

			// Assert
			expect(label).toBe('Turbo39');
		});

		it('should cap the label at 64 characters', () => {
			// Arrange
			const courseId = 'A'.repeat(100);

			// Act
			const label = washerCourseLabel(courseId);

			// Assert
			expect(label.length).toBeLessThanOrEqual(64);
		});
	});

	describe('readWasherCourseOption', () => {
		it('should return the selectable list and default as writable for a course with selectable', () => {
			// Arrange
			const model = buildWasherModel();

			// Act
			const option = readWasherCourseOption(model, 'NORMAL', 'spin');

			// Assert
			expect(option).toEqual({
				values: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'],
				defaultValue: 'SPIN_1400',
				writable: true,
			});
		});

		it('should return a single fixed value and writable false for a course without selectable', () => {
			// Arrange
			const model = buildWasherModel();

			// Act
			const option = readWasherCourseOption(model, 'COLDWASH', 'temp');

			// Assert
			expect(option).toEqual({ values: ['TEMP_COLD'], defaultValue: 'TEMP_COLD', writable: false });
		});

		it('should return undefined when the course does not list the key', () => {
			// Arrange
			const model = buildWasherModel();

			// Act
			const option = readWasherCourseOption(model, 'DRUM_CARE', 'spin');

			// Assert
			expect(option).toBeUndefined();
		});

		it('should return undefined for an unknown course', () => {
			// Arrange
			const model = buildWasherModel();

			// Act
			const option = readWasherCourseOption(model, 'GHOST', 'spin');

			// Assert
			expect(option).toBeUndefined();
		});
	});

	describe('course <-> mode mapping', () => {
		it('should round-trip every course id through its mode number', () => {
			// Arrange
			const plan = buildPlan();

			// Act / Assert
			for (const entry of plan.modes) {
				expect(courseIdToMode(plan, entry.courseId)).toBe(entry.mode);
				expect(modeToCourseId(plan, entry.mode)).toBe(entry.courseId);
			}
		});

		it('should return undefined for an unknown course id or an out-of-range mode', () => {
			// Arrange
			const plan = buildPlan();

			// Act / Assert
			expect(courseIdToMode(plan, 'GHOST')).toBeUndefined();
			expect(modeToCourseId(plan, 0)).toBeUndefined();
			expect(modeToCourseId(plan, 99)).toBeUndefined();
		});
	});

	describe('spin mapping', () => {
		it('should label NO_SPIN as "No spin" and SPIN_1400 as "1400"', () => {
			// Act / Assert
			expect(spinEnumToLabel('NO_SPIN')).toBe('No spin');
			expect(spinEnumToLabel('SPIN_1400')).toBe('1400');
		});

		it('should pass an unknown spin value through unchanged', () => {
			// Arrange
			const unknownValue = 'GARBAGE';

			// Act
			const label = spinEnumToLabel(unknownValue);

			// Assert
			expect(label).toBe('GARBAGE');
		});

		it('should round-trip every member of a 6-entry spin list through index and enum', () => {
			// Arrange
			const list = listOf(['NO_SPIN', 'SPIN_400', 'SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'], 'SPIN_1400');

			// Act / Assert
			list.values.forEach((value, index) => {
				expect(spinEnumToIndex(list, value)).toBe(index);
				expect(spinIndexToEnum(list, index)).toBe(value);
			});
		});

		it('should return undefined for a value not in the list and for negative or out-of-range indexes', () => {
			// Arrange
			const list = listOf(['SPIN_800', 'SPIN_1400'], 'SPIN_1400');

			// Act / Assert
			expect(spinEnumToIndex(list, 'SPIN_400')).toBeUndefined();
			expect(spinIndexToEnum(list, -1)).toBeUndefined();
			expect(spinIndexToEnum(list, 2)).toBeUndefined();
		});
	});

	describe('temperature mapping', () => {
		it('should label TEMP_COLD as "Cold" and TEMP_40 as "40C"', () => {
			// Act / Assert
			expect(tempEnumToLabel('TEMP_COLD')).toBe('Cold');
			expect(tempEnumToLabel('TEMP_40')).toBe('40C');
		});

		it('should keep every temperature label within 16 characters', () => {
			// Arrange
			const values = ['NO_TEMP', 'TEMP_COLD', 'TEMP_20', 'TEMP_30', 'TEMP_40', 'TEMP_60', 'TEMP_95', 'TEMP_HOT'];

			// Act / Assert
			for (const value of values) {
				expect(tempEnumToLabel(value).length).toBeLessThanOrEqual(16);
			}
		});

		it('should round-trip every member of a temperature list through index and enum', () => {
			// Arrange
			const list = listOf(['TEMP_COLD', 'TEMP_20', 'TEMP_30', 'TEMP_40', 'TEMP_60', 'TEMP_95'], 'TEMP_40');

			// Act / Assert
			list.values.forEach((value, index) => {
				expect(tempEnumToIndex(list, value)).toBe(index);
				expect(tempIndexToEnum(list, index)).toBe(value);
			});
		});

		it('should return undefined for a value not in the list and for negative or out-of-range indexes', () => {
			// Arrange
			const list = listOf(['TEMP_COLD', 'TEMP_40'], 'TEMP_40');

			// Act / Assert
			expect(tempEnumToIndex(list, 'TEMP_95')).toBeUndefined();
			expect(tempIndexToEnum(list, -1)).toBeUndefined();
			expect(tempIndexToEnum(list, 2)).toBeUndefined();
		});
	});

	describe('rinse mapping', () => {
		it.each([
			['NO_RINSE', LaundryWasherControls.NumberOfRinses.None],
			['RINSE_1', LaundryWasherControls.NumberOfRinses.Normal],
			['RINSE_2', LaundryWasherControls.NumberOfRinses.Normal],
			['RINSE_3', LaundryWasherControls.NumberOfRinses.Extra],
			['RINSE_4', LaundryWasherControls.NumberOfRinses.Max],
			['RINSE_5', LaundryWasherControls.NumberOfRinses.Max],
			['RINSE_NORMAL', LaundryWasherControls.NumberOfRinses.Normal],
			['RINSE_PLUS', LaundryWasherControls.NumberOfRinses.Extra],
		])('should map %s to the Matter rinse count %s', (value, expected) => {
			// Act / Assert
			expect(rinseEnumToMatter(value)).toBe(expected);
		});

		it('should return undefined for an unknown rinse value', () => {
			// Act / Assert
			expect(rinseEnumToMatter('GARBAGE')).toBeUndefined();
		});

		it('should produce distinct Matter rinse counts when two values map to the same count', () => {
			// Arrange
			const list = listOf(['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3'], 'RINSE_2');

			// Act
			const supported = supportedRinsesOf(list);

			// Assert
			expect(supported).toEqual([
				LaundryWasherControls.NumberOfRinses.None,
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Extra,
			]);
		});

		it('should return the canonical value for the requested Matter rinse count when the list allows it', () => {
			// Arrange
			const list = listOf(['NO_RINSE', 'RINSE_2', 'RINSE_3'], 'RINSE_2');

			// Act
			const value = matterRinseToEnum(list, LaundryWasherControls.NumberOfRinses.Normal);

			// Assert
			expect(value).toBe('RINSE_2');
		});

		it('should return undefined when the list has no member for the requested Matter rinse count', () => {
			// Arrange
			const list = listOf(['NO_RINSE', 'RINSE_2'], 'RINSE_2');

			// Act
			const value = matterRinseToEnum(list, LaundryWasherControls.NumberOfRinses.Max);

			// Assert
			expect(value).toBeUndefined();
		});
	});

	describe('canonical rinse write map', () => {
		const FULL_LIST = listOf(['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'], 'RINSE_2');

		it('should map each Matter rinse count to its one canonical LG value', () => {
			// Act / Assert
			expect(CANONICAL_RINSE_ENUM).toEqual({
				[LaundryWasherControls.NumberOfRinses.None]: 'NO_RINSE',
				[LaundryWasherControls.NumberOfRinses.Normal]: 'RINSE_2',
				[LaundryWasherControls.NumberOfRinses.Extra]: 'RINSE_3',
				[LaundryWasherControls.NumberOfRinses.Max]: 'RINSE_4',
			});
		});

		it('should list the Matter rinse counts in enum order None, Normal, Extra, Max', () => {
			// Act / Assert
			expect(MATTER_RINSE_ORDER).toEqual([
				LaundryWasherControls.NumberOfRinses.None,
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Extra,
				LaundryWasherControls.NumberOfRinses.Max,
			]);
		});

		it.each(MATTER_RINSE_ORDER)(
			'should round-trip Matter count %s through its canonical value to the same count',
			(count) => {
				// Act / Assert
				expect(rinseEnumToMatter(CANONICAL_RINSE_ENUM[count])).toBe(count);
			},
		);

		it.each([
			[LaundryWasherControls.NumberOfRinses.None, 'NO_RINSE'],
			[LaundryWasherControls.NumberOfRinses.Normal, 'RINSE_2'],
			[LaundryWasherControls.NumberOfRinses.Extra, 'RINSE_3'],
			[LaundryWasherControls.NumberOfRinses.Max, 'RINSE_4'],
		])('should write LG value for Matter count %s on a full writable list as %s', (count, value) => {
			// Act / Assert
			expect(matterRinseToEnum(FULL_LIST, count)).toBe(value);
		});

		it('should return undefined for None and the canonical values for the rest when NO_RINSE is not listed', () => {
			// Arrange
			const list = listOf(['RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'], 'RINSE_1');

			// Act / Assert
			expect(matterRinseToEnum(list, LaundryWasherControls.NumberOfRinses.None)).toBeUndefined();
			expect(matterRinseToEnum(list, LaundryWasherControls.NumberOfRinses.Normal)).toBe('RINSE_2');
			expect(matterRinseToEnum(list, LaundryWasherControls.NumberOfRinses.Extra)).toBe('RINSE_3');
			expect(matterRinseToEnum(list, LaundryWasherControls.NumberOfRinses.Max)).toBe('RINSE_4');
		});

		it.each(MATTER_RINSE_ORDER)('should return undefined for Matter count %s on a non-writable list', (count) => {
			// Arrange: the one value's own default maps to Normal, so Normal is the tricky case.
			const list = listOf(['RINSE_2'], 'RINSE_2', false);

			// Act / Assert
			expect(matterRinseToEnum(list, count)).toBeUndefined();
		});
	});

	describe('supportedRinsesOf write-aware list', () => {
		it('should offer None, Normal, Extra and Max on the full VCDWL_QEUK list', () => {
			// Arrange
			const list = listOf(['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'], 'RINSE_2');

			// Act / Assert
			expect(supportedRinsesOf(list)).toEqual([
				LaundryWasherControls.NumberOfRinses.None,
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Extra,
				LaundryWasherControls.NumberOfRinses.Max,
			]);
		});

		it('should not offer None on the TURBO39 / SPEED14 / RINSE_SPIN list', () => {
			// Arrange
			const list = listOf(['RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'], 'RINSE_1');

			// Act / Assert
			expect(supportedRinsesOf(list)).toEqual([
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Extra,
				LaundryWasherControls.NumberOfRinses.Max,
			]);
		});

		it('should offer only Normal on the TUB_CLEAN fixed list', () => {
			// Arrange
			const list = listOf(['RINSE_2'], 'RINSE_2', false);

			// Act / Assert
			expect(supportedRinsesOf(list)).toEqual([LaundryWasherControls.NumberOfRinses.Normal]);
		});

		it('should offer only None on the SPIN_ONLY fixed list', () => {
			// Arrange
			const list = listOf(['NO_RINSE'], 'NO_RINSE', false);

			// Act / Assert
			expect(supportedRinsesOf(list)).toEqual([LaundryWasherControls.NumberOfRinses.None]);
		});

		it('should not duplicate Max when the shown value is RINSE_5 on a full list', () => {
			// Arrange
			const list = listOf(['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'], 'RINSE_2');

			// Act
			const supported = supportedRinsesOf(list, 'RINSE_5');

			// Assert
			expect(supported).toEqual([
				LaundryWasherControls.NumberOfRinses.None,
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Extra,
				LaundryWasherControls.NumberOfRinses.Max,
			]);
		});

		it('should always include the shown count so numberOfRinses stays a member on a non-writable list', () => {
			// Arrange
			const list = listOf(['RINSE_1'], 'RINSE_1', false);

			// Act / Assert
			expect(supportedRinsesOf(list, 'RINSE_1')).toEqual([LaundryWasherControls.NumberOfRinses.Normal]);
		});

		it('should return distinct counts in enum order, not input order, for a shuffled list', () => {
			// Arrange
			const list = listOf(['RINSE_4', 'NO_RINSE', 'RINSE_2'], 'RINSE_2');

			// Act / Assert
			expect(supportedRinsesOf(list)).toEqual([
				LaundryWasherControls.NumberOfRinses.None,
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Max,
			]);
		});
	});

	describe('buildWasherEndpointClusterOptions', () => {
		it('should return the current mode, matching indices and a Normal-tagged supportedModes for an INITIAL snapshot', () => {
			// Arrange
			const plan = buildPlan();
			const snapshot = snapshotOf({
				state: 'INITIAL',
				course: 'NORMAL',
				temp: 'TEMP_COLD',
				spin: 'SPIN_800',
				rinse: 'RINSE_2',
			});

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot);

			// Assert
			expect(options.currentMode).toBe(3);
			expect(options.spinSpeedCurrent).toBe(0);
			expect(options.selectedTemperatureLevel).toBe(0);
			expect(options.numberOfRinses).toBe(LaundryWasherControls.NumberOfRinses.Normal);
			const normalTagged = options.supportedModes.filter((mode) =>
				mode.modeTags.some((tag) => tag.value === LaundryWasherMode.ModeTag.Normal),
			);
			expect(normalTagged.map((mode) => mode.mode)).toEqual([3]);
		});

		it('should fall back to each list default index for a POWEROFF snapshot without an out-of-range index', () => {
			// Arrange
			const plan = buildPlan();
			const snapshot = snapshotOf({
				state: 'POWEROFF',
				course: 'NORMAL',
				temp: 'NO_TEMP',
				spin: 'NO_SPIN',
				rinse: 'NO_RINSE',
			});

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot);

			// Assert
			expect(options.spinSpeedCurrent).toBe(3); // SPIN_1400 default
			expect(options.selectedTemperatureLevel).toBe(1); // TEMP_40 default
			expect(options.numberOfRinses).toBe(LaundryWasherControls.NumberOfRinses.Normal); // RINSE_2 default
		});

		it('should use the Normal course mode when the snapshot course is unknown to the plan', () => {
			// Arrange
			const plan = buildPlan();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'DOWNLOAD' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot);

			// Assert
			expect(options.currentMode).toBe(3);
		});

		it('should ignore a stale spin value while POWEROFF and log no unknown-value line', () => {
			// Arrange
			const plan = buildPlan();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'POWEROFF', course: 'NORMAL', spin: 'SPIN_400' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(options.spinSpeedCurrent).toBe(3); // SPIN_1400 default, the stale value is ignored while off
			expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('not in the course list'));
		});

		it('should clamp a spin value that is not in the initial course list to the default index', () => {
			// Arrange
			const plan = buildPlan(buildShrinkModel());
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'LIGHT', spin: 'SPIN_1400', temp: 'TEMP_40' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(options.spinSpeeds).toEqual(['400', '800']);
			expect(options.spinSpeedCurrent).toBe(1); // LIGHT default SPIN_800, not index 0
			expect(options.selectedTemperatureLevel).toBe(1); // LIGHT default TEMP_20, not index 0
		});

		it('should log one debug line with the value and course when a present spin value is unknown', () => {
			// Arrange
			const plan = buildPlan();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL', spin: 'SPIN_400' });

			// Act
			buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(logger.debug).toHaveBeenCalledTimes(1);
			expect(logger.debug).toHaveBeenCalledWith(
				"spin (course=NORMAL): 'SPIN_400' is not in the course list; using default 'SPIN_1400'",
			);
		});

		it('should log no unknown-value debug line when the spin value is absent', () => {
			// Arrange
			const plan = buildPlan();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(options.spinSpeedCurrent).toBe(3);
			expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('not in the course list'));
		});

		it('should use index 0 and log one debug line naming the course and the missing default when the default is not in its own list', () => {
			// Arrange
			const plan = buildPlan(buildDefaultOutsideListModel());
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL', temp: 'TEMP_40', rinse: 'RINSE_2' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(options.spinSpeedCurrent).toBe(0);
			expect(logger.debug).toHaveBeenCalledTimes(1);
			expect(logger.debug).toHaveBeenCalledWith(
				"spin (course=NORMAL): course default 'SPIN_999' is not in its own list; using index 0",
			);
		});

		it('should log no missing-default debug line when the course default is in its own list', () => {
			// Arrange
			const plan = buildPlan();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL' });

			// Act
			buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('not in its own list'));
		});

		it('should fall back to the Normal course spin list when the initial course lacks spin', () => {
			// Arrange
			const plan = buildPlan();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'COLDWASH', spin: 'SPIN_800', temp: 'TEMP_COLD' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot, logger);

			// Assert
			expect(options.currentMode).toBe(1); // COLDWASH is still the current mode
			expect(options.spinSpeeds).toEqual(['800', '1000', '1200', '1400']); // Normal course (NORMAL) spin list
			expect(options.spinSpeedCurrent).toBe(0);
			expect(options.supportedTemperatureLevels).toEqual(['Cold']); // COLDWASH's own fixed temp
			expect(options.numberOfRinses).toBe(LaundryWasherControls.NumberOfRinses.Normal); // NORMAL rinse default
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it('should fall back to the first course in mode order that lists spin when neither the initial nor the Normal course does', () => {
			// Arrange
			const model = {
				Config: { defaultCourse: 'NORMAL' },
				Course: {
					ALPHA: {
						function: [{ value: 'spin', default: 'SPIN_800', selectable: ['SPIN_400', 'SPIN_800'] }],
					},
					NORMAL: {
						function: [
							{ value: 'temp', default: 'TEMP_40', selectable: ['TEMP_COLD', 'TEMP_40'] },
							{ value: 'rinse', default: 'RINSE_2', selectable: ['RINSE_1', 'RINSE_2'] },
						],
					},
				},
			};
			const plan = buildPlan(model);
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot);

			// Assert
			expect(options.spinSpeeds).toEqual(['400', '800']);
			expect(options.spinSpeedCurrent).toBe(1); // ALPHA default SPIN_800
		});

		it('should return undefined and warn once naming spin and temp when no course lists either', () => {
			// Arrange
			const model = {
				Config: { defaultCourse: 'NORMAL' },
				Course: {
					NORMAL: { function: [{ value: 'rinse', default: 'RINSE_2', selectable: ['RINSE_1', 'RINSE_2'] }] },
					OTHER: { function: [] },
				},
			};
			const plan = buildPlan(model);
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL' });

			// Act
			const options = buildWasherEndpointClusterOptions(plan, snapshot, logger);

			// Assert
			expect(options).toBeUndefined();
			expect(logger.warn).toHaveBeenCalledTimes(1);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no usable spin/temp list in any course'));
		});

		it('should return undefined and warn naming rinse when no value maps to a Matter rinse count', () => {
			// Arrange
			const model = {
				Config: { defaultCourse: 'NORMAL' },
				Course: {
					NORMAL: {
						function: [
							{ value: 'spin', default: 'SPIN_800', selectable: ['SPIN_800'] },
							{ value: 'temp', default: 'TEMP_40', selectable: ['TEMP_40'] },
							{ value: 'rinse', default: 'RINSE_GARBAGE', selectable: ['RINSE_GARBAGE'] },
						],
					},
					OTHER: { function: [] },
				},
			};
			const plan = buildPlan(model);
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL' });

			// Act
			const options = buildWasherEndpointClusterOptions(plan, snapshot, logger);

			// Assert
			expect(options).toBeUndefined();
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no usable rinse list in any course'));
		});
	});

	describe('applyWasherSelectionDisplay', () => {
		it('should write no option attribute while the washer is POWEROFF', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({
				state: 'POWEROFF',
				course: 'NORMAL',
				temp: 'NO_TEMP',
				spin: 'NO_SPIN',
				rinse: 'NO_RINSE',
			});

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			expect(washer.updateAttribute).not.toHaveBeenCalled();
		});

		it('should write each list before its index when INITIAL', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({
				state: 'INITIAL',
				course: 'NORMAL',
				temp: 'TEMP_COLD',
				spin: 'SPIN_800',
				rinse: 'RINSE_2',
			});

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			const attributes = vi.mocked(washer.updateAttribute).mock.calls.map((call: unknown[]) => call[1]);
			expect(attributes.indexOf('spinSpeeds')).toBeLessThan(attributes.indexOf('spinSpeedCurrent'));
			expect(attributes.indexOf('supportedTemperatureLevels')).toBeLessThan(
				attributes.indexOf('selectedTemperatureLevel'),
			);
			expect(attributes.indexOf('supportedRinses')).toBeLessThan(attributes.indexOf('numberOfRinses'));
		});

		it('should not write currentMode when the snapshot course is not in supportedModes', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'GHOST', spin: 'SPIN_800' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, logger);

			// Assert
			const attributes = vi.mocked(washer.updateAttribute).mock.calls.map((call: unknown[]) => call[1]);
			expect(attributes).not.toContain('currentMode');
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('not in supportedModes'));
		});

		it('should leave the option attributes untouched but still write currentMode for a course that lists none of the keys', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'DRUM_CARE' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			const calls = vi.mocked(washer.updateAttribute).mock.calls;
			expect(calls).toContainEqual([LaundryWasherMode.id, 'currentMode', 2, expect.anything()]);
			const writtenAttributes = calls.map((call: unknown[]) => call[1]);
			expect(writtenAttributes).not.toContain('spinSpeeds');
			expect(writtenAttributes).not.toContain('supportedTemperatureLevels');
			expect(writtenAttributes).not.toContain('supportedRinses');
			expect(calls.filter((call: unknown[]) => call[0] === TemperatureControl.id)).toHaveLength(0);
		});

		it('should always write the spin and temp index inside the new list when the snapshot has no value for them', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			const calls = vi.mocked(washer.updateAttribute).mock.calls;
			expect(calls).toContainEqual([LaundryWasherControls.id, 'spinSpeedCurrent', 3, expect.anything()]);
			expect(calls).toContainEqual([TemperatureControl.id, 'selectedTemperatureLevel', 1, expect.anything()]);
		});

		it('should clamp a stale spin and temp value to the course default index and still write each index after its list', async () => {
			// Arrange
			const plan = buildPlan(buildShrinkModel());
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'LIGHT', spin: 'SPIN_1400', temp: 'TEMP_40' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			const calls = vi.mocked(washer.updateAttribute).mock.calls;
			expect(calls).toContainEqual([LaundryWasherControls.id, 'spinSpeedCurrent', 1, expect.anything()]);
			expect(calls).toContainEqual([TemperatureControl.id, 'selectedTemperatureLevel', 1, expect.anything()]);
			const attributes = calls.map((call: unknown[]) => call[1]);
			expect(attributes.indexOf('spinSpeeds')).toBeLessThan(attributes.indexOf('spinSpeedCurrent'));
			expect(attributes.indexOf('supportedTemperatureLevels')).toBeLessThan(
				attributes.indexOf('selectedTemperatureLevel'),
			);
		});

		it('should log a debug line naming the spin list when a present spin value is unknown', async () => {
			// Arrange
			const plan = buildPlan();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL', spin: 'SPIN_400' });

			// Act
			await applyWasherSelectionDisplay(createMockWasherEndpoint(), snapshot, plan, logger);

			// Assert
			expect(logger.debug).toHaveBeenCalledWith(
				expect.stringContaining(
					"applyWasherSelectionDisplay: spin (course=NORMAL): 'SPIN_400' is not in the course list",
				),
			);
		});

		it('should write spin index 0 and log one missing-default debug line on the display path when the default is not in its own list', async () => {
			// Arrange
			const plan = buildPlan(buildDefaultOutsideListModel());
			const washer = createMockWasherEndpoint();
			const logger = createMockLogger();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL', temp: 'TEMP_40', rinse: 'RINSE_2' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, logger);

			// Assert
			expect(washer.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'spinSpeedCurrent',
				0,
				expect.anything(),
			);
			const missingDefaultLines = vi
				.mocked(logger.debug)
				.mock.calls.filter((call: unknown[]) => String(call[0]).includes('not in its own list'));
			expect(missingDefaultLines).toEqual([
				[
					"applyWasherSelectionDisplay: spin (course=NORMAL): course default 'SPIN_999' is not in its own list; using index 0",
				],
			]);
		});

		it('should write no option attribute and no currentMode while POWEROFF even with a stale course and spin', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({ state: 'POWEROFF', course: 'LIGHT', spin: 'SPIN_400', temp: 'TEMP_20' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			expect(washer.updateAttribute).not.toHaveBeenCalled();
		});
	});

	describe('rinse list refresh on the display path', () => {
		it('should write supportedRinses before numberOfRinses and show Max for RINSE_5 on a full writable list', async () => {
			// Arrange
			const plan = buildPlan();
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL', rinse: 'RINSE_5' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, plan, createMockLogger());

			// Assert
			const attributes = vi.mocked(washer.updateAttribute).mock.calls.map((call: unknown[]) => call[1]);
			expect(attributes.indexOf('supportedRinses')).toBeLessThan(attributes.indexOf('numberOfRinses'));
			expect(washer.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Max,
				expect.anything(),
			);
		});

		it('should publish only Normal and show Normal for RINSE_1 on a non-writable single-value list', async () => {
			// Arrange
			const model = {
				Config: { defaultCourse: 'NORMAL' },
				Course: {
					NORMAL: { function: [{ value: 'rinse', default: 'RINSE_2' }] },
					OTHER: { function: [] },
				},
			};
			const washer = createMockWasherEndpoint();
			const snapshot = snapshotOf({ state: 'INITIAL', course: 'NORMAL', rinse: 'RINSE_1' });

			// Act
			await applyWasherSelectionDisplay(washer, snapshot, buildPlan(model), createMockLogger());

			// Assert
			expect(washer.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'supportedRinses',
				[LaundryWasherControls.NumberOfRinses.Normal],
				expect.anything(),
			);
			expect(washer.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Normal,
				expect.anything(),
			);
		});

		it('should fall back to the course default count and keep numberOfRinses a member on a POWEROFF snapshot', () => {
			// Arrange
			const plan = buildPlan();
			const snapshot = snapshotOf({ state: 'POWEROFF', course: 'NORMAL', rinse: 'RINSE_5' });

			// Act
			const options = buildClusterOptionsOrFail(plan, snapshot);

			// Assert
			expect(options.numberOfRinses).toBe(LaundryWasherControls.NumberOfRinses.Normal);
			expect(options.supportedRinses).toContain(options.numberOfRinses);
			expect(options.supportedRinses).toEqual([
				LaundryWasherControls.NumberOfRinses.None,
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Extra,
				LaundryWasherControls.NumberOfRinses.Max,
			]);
		});
	});

	describe('washerMatterPlanRefusalReason', () => {
		it('should name a missing or malformed Course map when Course is absent', () => {
			// Arrange
			const model = { Config: { defaultCourse: 'NORMAL' } };

			// Act
			const reason = washerMatterPlanRefusalReason(model);

			// Assert
			expect(reason).toBe('model has a missing or malformed Course map');
		});

		it('should name a missing or malformed Course map when Course is a string, null or array', () => {
			// Arrange
			const stringCourse = { Course: 'NORMAL' };
			const nullCourse = { Course: null };
			const arrayCourse = { Course: ['NORMAL', 'COLDWASH'] };

			// Act / Assert
			expect(washerMatterPlanRefusalReason(stringCourse)).toBe('model has a missing or malformed Course map');
			expect(washerMatterPlanRefusalReason(nullCourse)).toBe('model has a missing or malformed Course map');
			expect(washerMatterPlanRefusalReason(arrayCourse)).toBe('model has a missing or malformed Course map');
			expect(resolveWasherMatterPlan(arrayCourse)).toBeUndefined();
		});

		it('should not count an array course entry as usable', () => {
			// Arrange
			const model = { Course: { NORMAL: { function: [] }, BROKEN: ['SPIN_800'] } };

			// Act
			const reason = washerMatterPlanRefusalReason(model);

			// Assert
			expect(reason).toBe('model has 1 usable course(s), Matter needs at least 2');
		});

		it('should report the usable course count when only 1 course is a record', () => {
			// Arrange
			const model = { Course: { NORMAL: { function: [] }, BROKEN: 'not-a-record' } };

			// Act
			const reason = washerMatterPlanRefusalReason(model);

			// Assert
			expect(reason).toBe('model has 1 usable course(s), Matter needs at least 2');
			expect(resolveWasherMatterPlan(model)).toBeUndefined();
		});

		it('should report zero usable courses when Course is an empty record', () => {
			// Arrange
			const model = { Course: {} };

			// Act
			const reason = washerMatterPlanRefusalReason(model);

			// Assert
			expect(reason).toBe('model has 0 usable course(s), Matter needs at least 2');
		});
	});
});
