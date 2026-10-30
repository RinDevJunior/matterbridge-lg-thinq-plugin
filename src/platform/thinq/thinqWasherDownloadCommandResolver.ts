import {
	readWasherControlTemplate,
	resolveWasherCourseData,
	type WasherCourseSelection,
	type WasherStartCommandPayload,
} from './thinqWasherStartCommandResolver.js';

export type WasherDownloadRemoteStart = 'REMOTE_START_ON' | 'REMOTE_START_OFF';

export type WasherDownloadOverrideKey = 'spin' | 'temp';

export interface WasherDownloadOverrides {
	readonly spin?: string;
	readonly temp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Values the selected course allows for a download override key: the `selectable` string array of the
 * course's own `function[]` entry whose `value` equals the key. Returns `undefined` (fail closed) when the
 * course or entry is missing or `selectable` is not a non-empty string array. The model-wide
 * `MonitoringValue.<key>.valueMapping` enum is deliberately NOT used: it lists values a course may not allow.
 */
export function getWasherModelOptionValues(
	deviceModel: Record<string, unknown>,
	courseId: string,
	key: string,
): string[] | undefined {
	const course = deviceModel.Course;
	const selectedCourse = isRecord(course) ? course[courseId] : undefined;
	const functionEntries = isRecord(selectedCourse) ? selectedCourse.function : undefined;
	if (!Array.isArray(functionEntries)) {
		return undefined;
	}
	const entry = functionEntries.find((item: unknown) => isRecord(item) && item.value === key);
	if (!isRecord(entry)) {
		return undefined;
	}
	const selectable = entry.selectable;
	if (!Array.isArray(selectable) || selectable.length === 0 || !selectable.every((item) => typeof item === 'string')) {
		return undefined;
	}
	return selectable;
}

/** Key the signature body writes its course type under: the model's `Config.downloadedCourseType`, or `undefined` when absent (fail closed). */
export function getWasherDownloadedCourseKey(deviceModel: Record<string, unknown>): string | undefined {
	const config = deviceModel.Config;
	return isRecord(config) && typeof config.downloadedCourseType === 'string' && config.downloadedCourseType !== ''
		? config.downloadedCourseType
		: undefined;
}

/** The course id the download builder uses for a given selection (requested course, else `Config.defaultCourse`). */
export function resolveWasherCourseId(
	deviceModel: Record<string, unknown>,
	courseSelection?: WasherCourseSelection,
): string | undefined {
	return resolveWasherCourseData(deviceModel, courseSelection)?.resolvedCourseId;
}

/**
 * Builds a `WMDownload` payload from the template's own keys, with the model-default (or requested)
 * course and the given `remoteStart` flag. Optional `overrides` replace only the `spin`/`temp` keys,
 * and only with a value listed in `Course.<id>.function[].selectable` (fail closed otherwise). The
 * `signature` variant needs `Config.downloadedCourseType` and returns `undefined` without it. CLI only;
 * not wired into the plugin runtime. Pure, no I/O — returns `undefined` on any missing/malformed shape.
 */
export function extractWasherDownloadCommand(
	deviceModel: Record<string, unknown>,
	remoteStart: WasherDownloadRemoteStart,
	courseSelection?: WasherCourseSelection,
	overrides?: WasherDownloadOverrides,
	signature?: boolean,
): WasherStartCommandPayload | undefined {
	if (!isRecord(deviceModel)) {
		return undefined;
	}

	const controlWifi = deviceModel.ControlWifi;
	if (!isRecord(controlWifi)) {
		return undefined;
	}

	const downloadEntry = controlWifi.WMDownload;
	if (!isRecord(downloadEntry)) {
		return undefined;
	}

	const template = readWasherControlTemplate(downloadEntry);
	if (!template) {
		return undefined;
	}

	const courseData = resolveWasherCourseData(deviceModel, courseSelection);
	if (!courseData) {
		return undefined;
	}

	// The template key is `Course` while `Config.courseType` is lowercase `course`: never use the Config name as a payload key.
	const courseTypeKey = courseData.selectedCourseEntry.courseType;
	const courseKey = typeof courseTypeKey === 'string' && courseTypeKey in template.inner ? courseTypeKey : undefined;
	if (courseKey === undefined || !('remoteStart' in template.inner)) {
		return undefined;
	}

	const merged: Record<string, unknown> = { ...template.inner };
	for (const [name, value] of Object.entries({ ...courseData.courseDefaults, ...courseData.coercedOverrides })) {
		if (name in template.inner && name !== courseKey && typeof template.inner[name] === typeof value) {
			merged[name] = value;
		}
	}

	for (const [key, value] of Object.entries(template.inner)) {
		if (value === 'temp' && key !== courseKey) {
			merged[key] = 'NOT_SELECTED';
		}
	}

	for (const key of ['spin', 'temp'] as const) {
		const override = overrides?.[key];
		if (override === undefined) {
			continue;
		}
		const allowedValues = getWasherModelOptionValues(deviceModel, courseData.resolvedCourseId, key);
		if (typeof template.inner[key] !== 'string' || !allowedValues?.includes(override)) {
			return undefined;
		}
		merged[key] = override;
	}

	if (signature) {
		// Mirrors ioBroker.lg-thinq's "signature" washer branch: lib/helper.js:1327 (isSig), :1356-1357
		// (COURSE_TYPE_COURSE for a Course entry), :1385-1392 (courseDownloadType/Length dropped), and
		// :1392-1396 (downloadedCourseType key, downloadSlotNumber 0, categoryNumber 0). Key name comes from
		// Config.downloadedCourseType (ioBroker main.js:2181). Fail closed: no hard-coded fallback key.
		const downloadedCourseKey = getWasherDownloadedCourseKey(deviceModel);
		if (downloadedCourseKey === undefined) {
			return undefined;
		}
		delete merged.courseDownloadType;
		delete merged.courseDownloadDataLength;
		merged[downloadedCourseKey] = 'COURSE_TYPE_COURSE';
		merged.downloadSlotNumber = 0;
		merged.categoryNumber = 0;
	}

	merged[courseKey] = courseData.resolvedCourseId;
	merged.remoteStart = remoteStart;

	return {
		command: typeof downloadEntry.command === 'string' ? downloadEntry.command : undefined,
		dataSetList: { [template.dev]: merged },
		resolvedCourseId: courseData.resolvedCourseId,
	};
}
