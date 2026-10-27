import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { LaundryWasherControls, LaundryWasherMode, TemperatureControl } from 'matterbridge/matter/clusters';

import type { ThinqSnapshot } from '../../core/domain/value-objects/ThinqSnapshot.js';
import { isRecord } from './thinqWasherFields.js';
import { WASHER_VT_OPTION_KEYS, type WasherVtOptionKey } from './thinqWasherVtCtrl.js';

export const WASHER_VT_DISPLAY_OPTION_KEYS = WASHER_VT_OPTION_KEYS;

const MAX_MODE_LABEL_LENGTH = 64;
const MAX_TEMPERATURE_LABEL_LENGTH = 16;
const COURSE_NOT_SELECTED = 'NOT_SELECTED';
const COURSE_DOWNLOAD = 'DOWNLOAD';
const WASHER_POWER_OFF_STATE = 'POWEROFF';

export interface WasherCourseMode {
	readonly courseId: string;
	/** 1-based, from the sorted course id list. */
	readonly mode: number;
	readonly label: string;
	/** Exactly one entry is true. */
	readonly isNormal: boolean;
}

export interface WasherCourseOptionList {
	/** Values the course allows, in model order. Never empty. */
	readonly values: readonly string[];
	/** The course's own `function[]` default. */
	readonly defaultValue: string;
	/** False when the course has no `selectable` for this key (value is fixed by the course). */
	readonly writable: boolean;
}

export type WasherCourseOptions = Partial<Record<WasherVtOptionKey, WasherCourseOptionList>>;

export interface WasherMatterPlan {
	readonly modes: readonly WasherCourseMode[];
	readonly normalCourseId: string;
	/** `undefined` when the course is unknown to the model. */
	readonly optionsOf: (courseId: string) => WasherCourseOptions | undefined;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Like `isRecord`, but an array is not a course map or course entry. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && !Array.isArray(value);
}

/** Reads one `Course.<id>.function[]` entry: its `selectable` list and its `default`. `undefined` when absent. */
export function readWasherCourseOption(
	model: Record<string, unknown>,
	courseId: string,
	key: WasherVtOptionKey,
): WasherCourseOptionList | undefined {
	const courses = model.Course;
	const course = isRecord(courses) ? courses[courseId] : undefined;
	const functionEntries = isRecord(course) ? course.function : undefined;
	if (!Array.isArray(functionEntries)) {
		return undefined;
	}
	const entry: unknown = functionEntries.find((item: unknown) => isRecord(item) && item.value === key);
	if (!isRecord(entry)) {
		return undefined;
	}
	const selectable = isStringArray(entry.selectable) && entry.selectable.length > 0 ? entry.selectable : undefined;
	const defaultValue = typeof entry.default === 'string' && entry.default !== '' ? entry.default : selectable?.[0];
	if (defaultValue === undefined) {
		return undefined;
	}
	return selectable === undefined
		? { values: [defaultValue], defaultValue, writable: false }
		: { values: selectable, defaultValue, writable: true };
}

function titleCase(words: string): string {
	return words
		.toLowerCase()
		.split(/[_\s]+/)
		.filter((word) => word !== '')
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
		.join(' ');
}

/** `'SLEEVEHEMS_AND_COLLARS'` -> `'Sleevehems And Collars'`. */
export function washerCourseLabel(courseId: string): string {
	return titleCase(courseId).slice(0, MAX_MODE_LABEL_LENGTH);
}

function uniqueLabel(base: string, used: Set<string>): string {
	let label = base;
	for (let suffix = 2; used.has(label); suffix++) {
		const tail = ` (${suffix})`;
		label = `${base.slice(0, MAX_MODE_LABEL_LENGTH - tail.length)}${tail}`;
	}
	used.add(label);
	return label;
}

/** `undefined` (fail closed) when the model has no usable `Course` map or fewer than 2 courses (Matter needs >= 2). */
export function resolveWasherMatterPlan(model: Record<string, unknown>): WasherMatterPlan | undefined {
	const courses = model.Course;
	if (!isPlainObject(courses)) {
		return undefined;
	}
	const courseIds = Object.keys(courses)
		.filter((id) => isPlainObject(courses[id]))
		.sort();
	if (courseIds.length < 2) {
		return undefined;
	}

	const config = model.Config;
	const defaultCourse = isRecord(config) ? config.defaultCourse : undefined;
	const normalCourseId =
		typeof defaultCourse === 'string' && courseIds.includes(defaultCourse) ? defaultCourse : courseIds[0];

	const usedLabels = new Set<string>();
	const modes = courseIds.map((courseId, index): WasherCourseMode => ({
		courseId,
		mode: index + 1,
		label: uniqueLabel(washerCourseLabel(courseId), usedLabels),
		isNormal: courseId === normalCourseId,
	}));

	const optionsByCourse = new Map<string, WasherCourseOptions>();
	for (const courseId of courseIds) {
		const options: Partial<Record<WasherVtOptionKey, WasherCourseOptionList>> = {};
		for (const key of WASHER_VT_OPTION_KEYS) {
			const list = readWasherCourseOption(model, courseId, key);
			if (list !== undefined) {
				options[key] = list;
			}
		}
		optionsByCourse.set(courseId, options);
	}

	return { modes, normalCourseId, optionsOf: (courseId) => optionsByCourse.get(courseId) };
}

/** Why `resolveWasherMatterPlan` returned `undefined`, for the log line. */
export function washerMatterPlanRefusalReason(model: Record<string, unknown>): string {
	const courses = model.Course;
	if (!isPlainObject(courses)) {
		return 'model has a missing or malformed Course map';
	}
	const usable = Object.keys(courses).filter((id) => isPlainObject(courses[id])).length;
	return `model has ${usable} usable course(s), Matter needs at least 2`;
}

export function courseIdToMode(plan: WasherMatterPlan, courseId: string): number | undefined {
	return plan.modes.find((entry) => entry.courseId === courseId)?.mode;
}

export function modeToCourseId(plan: WasherMatterPlan, mode: number): string | undefined {
	return plan.modes.find((entry) => entry.mode === mode)?.courseId;
}

function humanize(value: string, prefix: string): string {
	const stripped = value.startsWith(prefix) ? value.slice(prefix.length) : value;
	const text = titleCase(stripped);
	return text === '' ? value : text;
}

/** `'SPIN_1400'` -> `'1400'`, `'NO_SPIN'` -> `'No spin'`; an unknown value passes through unchanged. */
export function spinEnumToLabel(value: string): string {
	if (value.startsWith('NO_')) {
		return `No ${value.slice(3).toLowerCase()}`;
	}
	return value.startsWith('SPIN_') ? humanize(value, 'SPIN_') : value;
}

export function spinLabelsOf(list: WasherCourseOptionList): string[] {
	return list.values.map(spinEnumToLabel);
}

export function spinEnumToIndex(list: WasherCourseOptionList, value: string): number | undefined {
	const index = list.values.indexOf(value);
	return index === -1 ? undefined : index;
}

export function spinIndexToEnum(list: WasherCourseOptionList, index: number): string | undefined {
	return list.values[index];
}

/** `'TEMP_COLD'` -> `'Cold'`, `'TEMP_40'` -> `'40C'`; at most 16 characters (Matter limit). */
export function tempEnumToLabel(value: string): string {
	if (value.startsWith('NO_')) {
		return `No ${value.slice(3).toLowerCase()}`.slice(0, MAX_TEMPERATURE_LABEL_LENGTH);
	}
	const label = humanize(value, 'TEMP_');
	return (/^\d+$/.test(label) ? `${label}C` : label).slice(0, MAX_TEMPERATURE_LABEL_LENGTH);
}

export function tempLabelsOf(list: WasherCourseOptionList): string[] {
	return list.values.map(tempEnumToLabel);
}

export function tempEnumToIndex(list: WasherCourseOptionList, value: string): number | undefined {
	const index = list.values.indexOf(value);
	return index === -1 ? undefined : index;
}

export function tempIndexToEnum(list: WasherCourseOptionList, index: number): string | undefined {
	return list.values[index];
}

export function rinseEnumToMatter(value: string): LaundryWasherControls.NumberOfRinses | undefined {
	switch (value) {
		case 'NO_RINSE':
			return LaundryWasherControls.NumberOfRinses.None;
		case 'RINSE_1':
		case 'RINSE_2':
		case 'RINSE_NORMAL':
			return LaundryWasherControls.NumberOfRinses.Normal;
		case 'RINSE_3':
		case 'RINSE_PLUS':
		case 'RINSE_PLUS2':
			return LaundryWasherControls.NumberOfRinses.Extra;
		case 'RINSE_4':
		case 'RINSE_5':
			return LaundryWasherControls.NumberOfRinses.Max;
		default:
			return undefined;
	}
}

/** The first value of the list that maps to the requested Matter rinse count. */
export function matterRinseToEnum(
	list: WasherCourseOptionList,
	rinses: LaundryWasherControls.NumberOfRinses,
): string | undefined {
	return list.values.find((value) => rinseEnumToMatter(value) === rinses);
}

/** Distinct Matter rinse counts the list can express, in list order. */
export function supportedRinsesOf(list: WasherCourseOptionList): LaundryWasherControls.NumberOfRinses[] {
	const rinses = list.values.flatMap((value) => {
		const mapped = rinseEnumToMatter(value);
		return mapped === undefined ? [] : [mapped];
	});
	return [...new Set(rinses)];
}

/** Constructor options for a vtCtrl washer. Every field is supplied; the whole object is absent when a list is missing. */
export interface WasherEndpointClusterOptions {
	readonly currentMode: number;
	readonly supportedModes: LaundryWasherMode.ModeOption[];
	readonly spinSpeeds: string[];
	readonly spinSpeedCurrent: number;
	readonly supportedTemperatureLevels: string[];
	readonly selectedTemperatureLevel: number;
	readonly numberOfRinses: LaundryWasherControls.NumberOfRinses;
	readonly supportedRinses: LaundryWasherControls.NumberOfRinses[];
}

function readWasherString(snapshot: ThinqSnapshot, key: string): string | undefined {
	const washer = snapshot.raw.washerDryer;
	const value = isRecord(washer) ? washer[key] : undefined;
	return typeof value === 'string' ? value : undefined;
}

function buildSupportedModes(plan: WasherMatterPlan): LaundryWasherMode.ModeOption[] {
	return plan.modes.map((entry) => ({
		label: entry.label,
		mode: entry.mode,
		modeTags: [{ value: entry.isNormal ? LaundryWasherMode.ModeTag.Normal : LaundryWasherMode.ModeTag.Auto }],
	}));
}

/** Resolves the course to build from: the snapshot's course when the plan knows it, else the Normal course. */
function resolveInitialCourseId(plan: WasherMatterPlan, snapshot: ThinqSnapshot): string {
	const course = readWasherString(snapshot, 'course');
	return course !== undefined && courseIdToMode(plan, course) !== undefined ? course : plan.normalCourseId;
}

/** The first list for `key` that passes `usable`: the initial course, then the Normal course, then any course in mode order. */
function findUsableList(
	plan: WasherMatterPlan,
	courseId: string,
	key: WasherVtOptionKey,
	usable: (list: WasherCourseOptionList) => boolean,
): WasherCourseOptionList | undefined {
	const candidates = [courseId, plan.normalCourseId, ...plan.modes.map((entry) => entry.courseId)];
	for (const candidate of candidates) {
		const list = plan.optionsOf(candidate)?.[key];
		if (list !== undefined && usable(list)) {
			return list;
		}
	}
	return undefined;
}

/** The list index of the snapshot's value; the course default's index when the value is absent, else 0. */
function indexOrDefault(
	list: WasherCourseOptionList,
	value: string | undefined,
	resolve: (list: WasherCourseOptionList, value: string) => number | undefined,
	label: string,
	logger?: AnsiLogger,
): number {
	const index = value === undefined ? undefined : resolve(list, value);
	if (index !== undefined) {
		return index;
	}
	if (value !== undefined) {
		logger?.debug(`${label}: '${value}' is not in the course list; using default '${list.defaultValue}'`);
	}
	const defaultIndex = list.values.indexOf(list.defaultValue);
	if (defaultIndex === -1) {
		logger?.debug(`${label}: course default '${list.defaultValue}' is not in its own list; using index 0`);
	}
	return Math.max(defaultIndex, 0);
}

/** `undefined` (today's Matterbridge defaults) when the model has no usable spin, temp or rinse list at all. */
export function buildWasherEndpointClusterOptions(
	plan: WasherMatterPlan,
	snapshot: ThinqSnapshot,
	logger?: AnsiLogger,
): WasherEndpointClusterOptions | undefined {
	const courseId = resolveInitialCourseId(plan, snapshot);
	const spin = findUsableList(plan, courseId, 'spin', (list) => list.values.length > 0);
	const temp = findUsableList(plan, courseId, 'temp', (list) => list.values.length > 0);
	const rinse = findUsableList(plan, courseId, 'rinse', (list) => supportedRinsesOf(list).length > 0);
	if (spin === undefined || temp === undefined || rinse === undefined) {
		const missing = [
			...(spin === undefined ? ['spin'] : []),
			...(temp === undefined ? ['temp'] : []),
			...(rinse === undefined ? ['rinse'] : []),
		].join('/');
		logger?.warn(
			`Washer Matter lists not built: no usable ${missing} list in any course; the washer keeps the Matterbridge defaults`,
		);
		return undefined;
	}

	const powered = snapshot.washerRawState !== WASHER_POWER_OFF_STATE;
	const rinseValue = (powered ? readWasherString(snapshot, 'rinse') : undefined) ?? rinse.defaultValue;
	const supportedRinses = supportedRinsesOf(rinse);
	const mappedRinse = rinseEnumToMatter(rinseValue);

	return {
		currentMode: courseIdToMode(plan, courseId) ?? 1,
		supportedModes: buildSupportedModes(plan),
		spinSpeeds: spinLabelsOf(spin),
		spinSpeedCurrent: indexOrDefault(
			spin,
			powered ? readWasherString(snapshot, 'spin') : undefined,
			spinEnumToIndex,
			`spin (course=${courseId})`,
			logger,
		),
		supportedTemperatureLevels: tempLabelsOf(temp),
		selectedTemperatureLevel: indexOrDefault(
			temp,
			powered ? readWasherString(snapshot, 'temp') : undefined,
			tempEnumToIndex,
			`temp (course=${courseId})`,
			logger,
		),
		supportedRinses,
		numberOfRinses:
			mappedRinse !== undefined && supportedRinses.includes(mappedRinse) ? mappedRinse : supportedRinses[0],
	};
}

/**
 * W3: pushes course/temp/spin/rinse onto the endpoint. Display only, nothing is sent to the appliance.
 * Each list is written BEFORE its index; nothing is written while the washer is powered off (it reports
 * placeholder NO_* values then).
 */
export async function applyWasherSelectionDisplay(
	washer: MatterbridgeEndpoint,
	snapshot: ThinqSnapshot,
	plan: WasherMatterPlan,
	logger: AnsiLogger,
): Promise<void> {
	if (snapshot.washerRawState === WASHER_POWER_OFF_STATE) {
		return;
	}

	const courseId = readWasherString(snapshot, 'course');
	if (courseId === undefined || courseId === COURSE_NOT_SELECTED || courseId === COURSE_DOWNLOAD) {
		logger.debug(`applyWasherSelectionDisplay: skipped (no selectable course): course=${courseId ?? '(absent)'}`);
		return;
	}
	const mode = courseIdToMode(plan, courseId);
	const options = plan.optionsOf(courseId);
	if (mode === undefined || options === undefined) {
		logger.debug(`applyWasherSelectionDisplay: skipped (course not in supportedModes): course=${courseId}`);
		return;
	}

	await washer.updateAttribute(LaundryWasherMode.id, 'currentMode', mode, logger);

	if (options.spin !== undefined) {
		await washer.updateAttribute(LaundryWasherControls.id, 'spinSpeeds', spinLabelsOf(options.spin), logger);
		const spinIndex = indexOrDefault(
			options.spin,
			readWasherString(snapshot, 'spin'),
			spinEnumToIndex,
			`applyWasherSelectionDisplay: spin (course=${courseId})`,
			logger,
		);
		await washer.updateAttribute(LaundryWasherControls.id, 'spinSpeedCurrent', spinIndex, logger);
	}

	if (options.temp !== undefined) {
		await washer.updateAttribute(
			TemperatureControl.id,
			'supportedTemperatureLevels',
			tempLabelsOf(options.temp),
			logger,
		);
		const tempIndex = indexOrDefault(
			options.temp,
			readWasherString(snapshot, 'temp'),
			tempEnumToIndex,
			`applyWasherSelectionDisplay: temp (course=${courseId})`,
			logger,
		);
		await washer.updateAttribute(TemperatureControl.id, 'selectedTemperatureLevel', tempIndex, logger);
	}

	if (options.rinse !== undefined) {
		const supported = supportedRinsesOf(options.rinse);
		if (supported.length > 0) {
			await washer.updateAttribute(LaundryWasherControls.id, 'supportedRinses', supported, logger);
		}
		const rinse = readWasherString(snapshot, 'rinse');
		const mapped = rinse === undefined ? undefined : rinseEnumToMatter(rinse);
		if (mapped === undefined || !supported.includes(mapped)) {
			logger.debug(`applyWasherSelectionDisplay: rinse '${rinse ?? '(absent)'}' not mappable for course=${courseId}`);
		} else {
			await washer.updateAttribute(LaundryWasherControls.id, 'numberOfRinses', mapped, logger);
		}
	}
}
