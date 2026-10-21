import { describe, expect, it } from 'vitest';

import type { ThinqConnectPayload } from './thinqConnectApiClient.js';
import { buildConnectSettingsReport, describeCourseSupport } from './thinqConnectSettings.js';

/** Casts a deliberately malformed value to the payload type. */
function asPayload(value: unknown): ThinqConnectPayload {
	return value as ThinqConnectPayload;
}

const WASHER_TIMER_RANGE = { max: 30, min: 0, step: 1, except: [] };
const WASHER_TIMER_STOP_RANGE = { max: 19, min: 3, step: 1, except: [] };

/** Washer profile shaped like the real VCDWL_QEUK dump (property is an ARRAY with one object). */
const WASHER_PROFILE_REAL: ThinqConnectPayload = {
	property: [
		{
			runState: {
				currentState: {
					type: 'enum',
					mode: ['r'],
					value: { r: ['REFRESHING', 'RUNNING', 'POWER_OFF', 'SOAKING', 'END'] },
				},
			},
			operation: {
				washerOperationMode: { type: 'enum', mode: ['w'], value: { w: ['START', 'STOP', 'POWER_OFF', 'POWER_ON'] } },
			},
			detergent: { detergentSetting: 'AUTO' },
			remoteControlEnable: {
				remoteControlEnabled: { type: 'boolean', mode: ['r'], value: { r: [false, true] } },
			},
			timer: {
				remainHour: { type: 'range', mode: ['r'], value: { r: WASHER_TIMER_RANGE } },
				remainMinute: { type: 'range', mode: ['r'], value: { r: { ...WASHER_TIMER_RANGE, max: 59 } } },
				totalHour: { type: 'range', mode: ['r'], value: { r: WASHER_TIMER_RANGE } },
				totalMinute: { type: 'range', mode: ['r'], value: { r: { ...WASHER_TIMER_RANGE, max: 59 } } },
				relativeHourToStop: {
					type: 'range',
					mode: ['r', 'w'],
					value: { r: WASHER_TIMER_STOP_RANGE, w: WASHER_TIMER_STOP_RANGE },
				},
				relativeMinuteToStop: { type: 'range', mode: ['r'], value: { r: WASHER_TIMER_RANGE } },
			},
			location: { locationName: 'MAIN' },
			cycle: { cycleCount: { type: 'number', mode: ['r'] } },
		},
	],
};

/** Washer state shaped like the real dump (state is an ARRAY per location). */
const WASHER_STATE_REAL: ThinqConnectPayload = [
	{
		runState: { currentState: 'POWER_OFF' },
		remoteControlEnable: { remoteControlEnabled: false },
		timer: {
			remainHour: 0,
			remainMinute: 0,
			relativeHourToStop: 0,
			relativeMinuteToStop: 0,
			totalHour: 1,
			totalMinute: 58,
		},
		cycle: { cycleCount: 15 },
		location: { locationName: 'MAIN' },
	},
];

const AC_RANGE_C = { min: 16, max: 30, step: 0.5, except: [] };
const AC_RANGE_F = { min: 60, max: 86, step: 1, except: [] };

/** AC profile shaped like RAC_056905_WW (property is an OBJECT, temperatureInUnits is an ARRAY). */
const AC_PROFILE_STUDY: ThinqConnectPayload = {
	property: {
		runState: { currentState: { type: 'enum', mode: ['r'], value: { r: ['NORMAL', 'ERROR'] } } },
		airConJobMode: {
			currentJobMode: { type: 'enum', mode: ['r', 'w'], value: { r: ['FAN', 'AIR_DRY', 'COOL', 'AUTO'], w: ['COOL'] } },
		},
		operation: {
			airConOperationMode: {
				type: 'enum',
				mode: ['r', 'w'],
				value: { r: ['POWER_ON', 'POWER_OFF'], w: ['POWER_ON', 'POWER_OFF'] },
			},
		},
		temperature: {
			currentTemperature: { type: 'number', mode: ['r'] },
			unit: { type: 'enum', mode: ['r'], value: { r: ['C'] } },
			coolTargetTemperature: { type: 'range', mode: ['w'], value: { w: AC_RANGE_C } },
			targetTemperature: { type: 'range', mode: ['r', 'w'], value: { r: AC_RANGE_C, w: AC_RANGE_C } },
		},
		temperatureInUnits: [
			{
				unit: 'C',
				targetTemperature: { type: 'range', mode: ['r'], value: { r: AC_RANGE_C } },
				coolTargetTemperature: { type: 'range', mode: ['w'], value: { w: AC_RANGE_C } },
			},
			{
				unit: 'F',
				targetTemperature: { type: 'range', mode: ['r'], value: { r: AC_RANGE_F } },
				coolTargetTemperature: { type: 'range', mode: ['w'], value: { w: AC_RANGE_F } },
			},
		],
		airFlow: {
			windStrength: {
				type: 'enum',
				mode: ['r', 'w'],
				value: { r: ['LOW', 'MID', 'HIGH', 'AUTO'], w: ['LOW', 'MID', 'HIGH', 'AUTO'] },
			},
			windStep: {
				type: 'range',
				mode: ['r', 'w'],
				value: { r: { min: 1, max: 5, step: 1, except: [] }, w: { min: 1, max: 5, step: 1, except: [] } },
			},
		},
		timer: {
			absoluteStopTimer: { type: 'enum', mode: ['r', 'w'], value: { r: ['SET', 'UNSET'], w: ['UNSET'] } },
		},
		display: { light: { type: 'enum', mode: ['r', 'w'], value: { r: ['ON', 'OFF'], w: ['ON', 'OFF'] } } },
	},
};

const AC_STATE_STUDY: ThinqConnectPayload = {
	runState: { currentState: 'NORMAL' },
	airConJobMode: { currentJobMode: 'COOL' },
	operation: { airConOperationMode: 'POWER_OFF' },
	temperature: { currentTemperature: 30, unit: 'C', targetTemperature: 27 },
	temperatureInUnits: [
		{ unit: 'C', targetTemperature: 27 },
		{ unit: 'F', targetTemperature: 80 },
	],
	airFlow: { windStrength: 'HIGH', windStep: 5 },
	timer: { absoluteStopTimer: 'UNSET' },
	display: { light: 'ON' },
};

/** Dishwasher course property (openapi dish_washer example shape, trimmed). */
const DISHWASHER_PROFILE: ThinqConnectPayload = {
	property: {
		dishWashingCourse: {
			currentDishWashingCourse: { type: 'enum', mode: ['r'], value: { r: ['AUTO', 'NORMAL'] } },
		},
	},
};

const WASHER_COURSE_NONE = 'no course settings in the ThinQ Connect profile for this model (V1 legacy API has them)';

describe('buildConnectSettingsReport', () => {
	describe('washer profile and state', () => {
		it('should produce one block for the MAIN location with the washer groups and no location row', () => {
			// Arrange
			const profile = WASHER_PROFILE_REAL;
			const state = WASHER_STATE_REAL;

			// Act
			const report = buildConnectSettingsReport(profile, state);

			// Assert
			expect(report.blocks).toHaveLength(1);
			expect(report.blocks[0]?.location).toBe('MAIN');
			expect(report.blocks[0]?.groups.map((group) => group.name)).toEqual([
				'runState',
				'operation',
				'detergent',
				'remoteControlEnable',
				'timer',
				'cycle',
			]);
			expect(report.rowCount).toBe(11);
		});

		it('should show washerOperationMode as write-only with allowed values and no current value when state has no operation group', () => {
			// Arrange
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Act
			const row = report.blocks[0]?.groups.find((group) => group.name === 'operation')?.rows[0];

			// Assert
			expect(row).toEqual({
				property: 'washerOperationMode',
				access: 'w',
				type: 'enum',
				current: undefined,
				allowed: 'write: START, STOP, POWER_OFF, POWER_ON',
				unit: undefined,
			});
		});

		it('should show detergentSetting as a fixed row carrying its plain value', () => {
			// Arrange
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Act
			const row = report.blocks[0]?.groups.find((group) => group.name === 'detergent')?.rows[0];

			// Assert
			expect(row).toEqual({ property: 'detergentSetting', access: 'fixed', fixedValue: 'AUTO' });
		});

		it('should show relativeHourToStop as rw with one shared range when read and write specs are equal', () => {
			// Arrange
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Act
			const row = report.blocks[0]?.groups
				.find((group) => group.name === 'timer')
				?.rows.find((item) => item.property === 'relativeHourToStop');

			// Assert
			expect(row?.access).toBe('rw');
			expect(row?.allowed).toBe('3..19 step 1');
			expect(row?.current).toBe(0);
		});

		it('should show remainHour as read-only with a range text and no unit', () => {
			// Arrange
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Act
			const row = report.blocks[0]?.groups
				.find((group) => group.name === 'timer')
				?.rows.find((item) => item.property === 'remainHour');

			// Assert
			expect(row?.access).toBe('r');
			expect(row?.allowed).toBe('0..30 step 1');
			expect(row?.unit).toBeUndefined();
		});

		it('should show cycleCount as a read-only number with state value and no allowed text', () => {
			// Arrange
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Act
			const row = report.blocks[0]?.groups.find((group) => group.name === 'cycle')?.rows[0];

			// Assert
			expect(row).toEqual({
				property: 'cycleCount',
				access: 'r',
				type: 'number',
				current: 15,
				allowed: undefined,
				unit: undefined,
			});
		});

		it('should not emit the location key as a row or a group', () => {
			// Arrange / Act
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Assert
			const properties = report.blocks.flatMap((block) =>
				block.groups.flatMap((group) => group.rows.map((row) => row.property)),
			);
			expect(properties).not.toContain('location');
			expect(report.blocks[0]?.groups.some((group) => group.name === 'location')).toBe(false);
		});

		it('should match each profile block to the state entry with the same locationName when there are two locations', () => {
			// Arrange
			const profile: ThinqConnectPayload = {
				property: [
					{ location: { locationName: 'MAIN' }, runState: { currentState: { type: 'enum', mode: ['r'] } } },
					{ location: { locationName: 'SUB' }, runState: { currentState: { type: 'enum', mode: ['r'] } } },
				],
			};
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'SUB' }, runState: { currentState: 'RUNNING' } },
				{ location: { locationName: 'MAIN' }, runState: { currentState: 'INITIAL' } },
			];

			// Act
			const report = buildConnectSettingsReport(profile, state);

			// Assert
			expect(report.blocks.map((block) => block.location)).toEqual(['MAIN', 'SUB']);
			expect(report.blocks[0]?.groups[0]?.rows[0]?.current).toBe('INITIAL');
			expect(report.blocks[1]?.groups[0]?.rows[0]?.current).toBe('RUNNING');
		});

		it('should fall back to state[0] when one profile block has no matching locationName', () => {
			// Arrange
			const profile: ThinqConnectPayload = {
				property: [{ location: { locationName: 'OTHER' }, runState: { currentState: { type: 'enum', mode: ['r'] } } }],
			};
			const state: ThinqConnectPayload = [
				{ location: { locationName: 'MAIN' }, runState: { currentState: 'INITIAL' } },
			];

			// Act
			const report = buildConnectSettingsReport(profile, state);

			// Assert
			expect(report.blocks[0]?.location).toBe('OTHER');
			expect(report.blocks[0]?.groups[0]?.rows[0]?.current).toBe('INITIAL');
		});
	});

	describe('AC profile and state', () => {
		it('should produce a single block with no location for the AC object profile', () => {
			// Arrange / Act
			const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

			// Assert
			expect(report.blocks).toHaveLength(1);
			expect(report.blocks[0]?.location).toBeUndefined();
		});

		it('should show targetTemperature as rw with a 16..30 step 0.5 range, current 27 and unit C', () => {
			// Arrange
			const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

			// Act
			const row = report.blocks[0]?.groups
				.find((group) => group.name === 'temperature')
				?.rows.find((item) => item.property === 'targetTemperature');

			// Assert
			expect(row).toEqual({
				property: 'targetTemperature',
				access: 'rw',
				type: 'range',
				current: 27,
				allowed: '16..30 step 0.5',
				unit: 'C',
			});
		});

		it('should show absoluteStopTimer with separate read and write lists when r and w differ', () => {
			// Arrange
			const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

			// Act
			const row = report.blocks[0]?.groups.find((group) => group.name === 'timer')?.rows[0];

			// Assert
			expect(row?.allowed).toBe('read: SET, UNSET / write: UNSET');
		});

		it('should split temperatureInUnits into one group per unit label C and F', () => {
			// Arrange
			const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

			// Act
			const groups = report.blocks[0]?.groups.filter((group) => group.name === 'temperatureInUnits') ?? [];

			// Assert
			expect(groups.map((group) => group.label)).toEqual(['C', 'F']);
		});

		it('should use the F group unit and matching state value and never emit the unit leaf as a row', () => {
			// Arrange
			const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

			// Act
			const fGroup = report.blocks[0]?.groups.find((group) => group.label === 'F');

			// Assert
			expect(fGroup?.rows.map((row) => row.property)).toEqual(['targetTemperature', 'coolTargetTemperature']);
			expect(fGroup?.rows[0]).toMatchObject({ access: 'r', current: 80, allowed: '60..86 step 1', unit: 'F' });
			expect(fGroup?.rows[1]).toMatchObject({ access: 'w', current: undefined, allowed: 'write: 60..86 step 1' });
		});

		it('should show the temperature unit leaf as a read-only enum with allowed C and no unit of its own', () => {
			// Arrange
			const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

			// Act
			const row = report.blocks[0]?.groups
				.find((group) => group.name === 'temperature')
				?.rows.find((item) => item.property === 'unit');

			// Assert
			expect(row).toMatchObject({ access: 'r', current: 'C', allowed: 'C', unit: undefined });
		});
	});

	describe('state-only and descriptor rules', () => {
		it('should emit a state-only row with its current value when state has a property the profile does not', () => {
			// Arrange
			const profile: ThinqConnectPayload = {
				property: { runState: { currentState: { type: 'enum', mode: ['r'], value: { r: ['X'] } } } },
			};
			const state: ThinqConnectPayload = { runState: { currentState: 'X' }, foo: { bar: 1 } };

			// Act
			const report = buildConnectSettingsReport(profile, state);

			// Assert
			const row = report.blocks[0]?.groups.find((group) => group.name === 'foo')?.rows[0];
			expect(row).toEqual({ property: 'bar', access: 'state-only', current: 1 });
		});

		it('should treat a descriptor without mode as read-only', () => {
			// Arrange
			const profile: ThinqConnectPayload = { property: { misc: { level: { type: 'number' } } } };

			// Act
			const report = buildConnectSettingsReport(profile, undefined);

			// Assert
			expect(report.blocks[0]?.groups[0]?.rows[0]).toMatchObject({ property: 'level', access: 'r' });
		});

		it('should describe an unknown device type generically with allowed true, false and access rw', () => {
			// Arrange
			const profile: ThinqConnectPayload = {
				property: {
					powerSave: {
						powerSaveEnabled: { type: 'boolean', mode: ['r', 'w'], value: { r: [true, false], w: [true, false] } },
					},
				},
			};

			// Act
			const report = buildConnectSettingsReport(profile, { powerSave: { powerSaveEnabled: true } });

			// Assert
			expect(report.blocks[0]?.groups[0]?.rows[0]).toMatchObject({
				property: 'powerSaveEnabled',
				access: 'rw',
				allowed: 'true, false',
				current: true,
			});
		});
	});

	describe('course properties', () => {
		it('should report no course properties for the washer fixture', () => {
			// Arrange / Act
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

			// Assert
			expect(report.courseProperties).toEqual([]);
		});

		it('should report dishwasher course group and property names', () => {
			// Arrange / Act
			const report = buildConnectSettingsReport(DISHWASHER_PROFILE, undefined);

			// Assert
			expect(report.courseProperties).toEqual(['dishWashingCourse', 'currentDishWashingCourse']);
		});

		it.each(['Course', 'PROGRAM', 'currentCourse', 'cycleType', 'cycleName', 'cycleSelect'])(
			'should match the course pattern case-insensitively for %s',
			(name) => {
				// Arrange
				const profile: ThinqConnectPayload = {
					property: { misc: { [name]: { type: 'enum', mode: ['r'], value: { r: ['A'] } } } },
				};

				// Act
				const report = buildConnectSettingsReport(profile, undefined);

				// Assert
				expect(report.courseProperties).toContain(name);
			},
		);

		it.each(['cycleCount', 'cycle'])('should not match %s against the course pattern', (name) => {
			// Arrange
			const profile: ThinqConnectPayload = {
				property: { misc: { [name]: { type: 'number', mode: ['r'] } } },
			};

			// Act
			const report = buildConnectSettingsReport(profile, undefined);

			// Assert
			expect(report.courseProperties).toEqual([]);
		});
	});

	describe('malformed input', () => {
		it.each([
			{ label: 'both undefined', profile: undefined, state: undefined },
			{ label: 'empty profile object', profile: {}, state: undefined },
			{ label: 'property is a string', profile: { property: 'x' }, state: undefined },
			{ label: 'profile is null', profile: asPayload(null), state: undefined },
			{ label: 'profile is a string', profile: asPayload('nope'), state: undefined },
			{ label: 'state is a string with no profile', profile: undefined, state: asPayload('nope') },
		])('should return an empty report without throwing when $label', ({ profile, state }) => {
			// Arrange / Act
			const report = buildConnectSettingsReport(profile, state);

			// Assert
			expect(report).toEqual({ blocks: [], rowCount: 0, courseProperties: [] });
		});

		it('should return an empty report when property is a non-object scalar', () => {
			// Arrange / Act
			const report = buildConnectSettingsReport(asPayload({ property: 42 }), undefined);

			// Assert
			expect(report).toEqual({ blocks: [], rowCount: 0, courseProperties: [] });
		});

		it('should skip a non-object group value without throwing when the group is a bare scalar', () => {
			// Arrange
			const profile: ThinqConnectPayload = { property: { runState: 'bad' } };

			// Act
			const report = buildConnectSettingsReport(profile, undefined);

			// Assert
			expect(report.rowCount).toBe(0);
		});

		it('should keep the washer rows without throwing when the state is a string', () => {
			// Arrange / Act
			const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, asPayload('nope'));

			// Assert
			expect(report.rowCount).toBe(11);
			expect(report.blocks[0]?.groups[0]?.rows[0]?.current).toBeUndefined();
		});
	});
});

describe('describeCourseSupport', () => {
	it('should return the no-course line for a washer profile with no course properties', () => {
		// Arrange
		const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

		// Act
		const text = describeCourseSupport('DEVICE_WASHER', report);

		// Assert
		expect(text).toBe(WASHER_COURSE_NONE);
	});

	it('should list the course property names when a washer profile exposes a course group', () => {
		// Arrange
		const profile: ThinqConnectPayload = {
			property: [
				{
					...(WASHER_PROFILE_REAL as { property: Record<string, unknown>[] }).property[0],
					program: { currentProgram: { type: 'enum', mode: ['r'], value: { r: ['COTTON'] } } },
				},
			],
		};
		const report = buildConnectSettingsReport(profile, WASHER_STATE_REAL);

		// Act
		const text = describeCourseSupport('DEVICE_WASHER', report);

		// Assert
		expect(text).toBe('course properties: program, currentProgram');
	});

	it('should return undefined for the AC profile', () => {
		// Arrange
		const report = buildConnectSettingsReport(AC_PROFILE_STUDY, AC_STATE_STUDY);

		// Act
		const text = describeCourseSupport('DEVICE_AIR_CONDITIONER', report);

		// Assert
		expect(text).toBeUndefined();
	});

	it('should return undefined for a dishwasher without a washerOperationMode row', () => {
		// Arrange
		const report = buildConnectSettingsReport(DISHWASHER_PROFILE, undefined);

		// Act
		const text = describeCourseSupport('DEVICE_DISH_WASHER', report);

		// Assert
		expect(text).toBeUndefined();
	});

	it('should list the dishwasher course names when a washerOperationMode row is present', () => {
		// Arrange
		const profile: ThinqConnectPayload = {
			property: {
				...(DISHWASHER_PROFILE as { property: Record<string, unknown> }).property,
				operation: { washerOperationMode: { type: 'enum', mode: ['w'], value: { w: ['START'] } } },
			},
		};
		const report = buildConnectSettingsReport(profile, undefined);

		// Act
		const text = describeCourseSupport('DEVICE_DISH_WASHER', report);

		// Assert
		expect(text).toMatch(/^course properties: /);
		expect(text).toContain('currentDishWashingCourse');
	});

	it('should return the no-course line when the device type is unknown but a washerOperationMode row exists', () => {
		// Arrange
		const report = buildConnectSettingsReport(WASHER_PROFILE_REAL, WASHER_STATE_REAL);

		// Act
		const text = describeCourseSupport(undefined, report);

		// Assert
		expect(text).toBe(WASHER_COURSE_NONE);
	});
});
