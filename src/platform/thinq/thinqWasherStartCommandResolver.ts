export interface WasherCourseSelection {
	readonly courseId?: string;
	readonly parameterOverrides?: Record<string, string>;
}

export interface WasherStartCommandPayload {
	readonly command?: string;
	readonly dataSetList?: Record<string, unknown>;
	readonly resolvedCourseId?: string;
}

export interface WasherResolvedCourseData {
	readonly courseType: string;
	readonly smartCourseType: string;
	readonly resolvedCourseId: string;
	readonly selectedCourseEntry: Record<string, unknown>;
	readonly courseDefaults: Record<string, unknown>;
	readonly coercedOverrides: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Reads the first `dev` block of a `ControlWifi` entry's `data` template. Pure, no I/O — returns
 * `undefined` on any missing/malformed shape.
 */
export function readWasherControlTemplate(
	entry: Record<string, unknown>,
): { dev: string; inner: Record<string, unknown> } | undefined {
	const templateData = entry.data;
	if (!isRecord(templateData)) {
		return undefined;
	}

	const devKeys = Object.keys(templateData);
	if (devKeys.length === 0) {
		return undefined;
	}

	const dev = devKeys[0];
	const templateInner = templateData[dev];
	if (!isRecord(templateInner)) {
		return undefined;
	}

	return { dev, inner: templateInner };
}

/**
 * Resolves the course id, its `function[]` defaults and the coerced parameter overrides from a device's
 * own model JSON (`Config`/`Course`). Unknown override names are dropped (fail closed). Pure, no I/O —
 * returns `undefined` on any missing/malformed shape.
 */
export function resolveWasherCourseData(
	deviceModel: Record<string, unknown>,
	courseSelection?: WasherCourseSelection,
): WasherResolvedCourseData | undefined {
	if (!isRecord(deviceModel)) {
		return undefined;
	}

	const config = deviceModel.Config;
	if (!isRecord(config)) {
		return undefined;
	}

	const { defaultCourse, courseType, smartCourseType } = config;
	if (typeof defaultCourse !== 'string' || typeof courseType !== 'string' || typeof smartCourseType !== 'string') {
		return undefined;
	}

	const course = deviceModel.Course;
	if (!isRecord(course)) {
		return undefined;
	}

	const requestedCourseId = courseSelection?.courseId;
	const resolvedCourseId =
		typeof requestedCourseId === 'string' && isRecord(course[requestedCourseId]) ? requestedCourseId : defaultCourse;

	const selectedCourseEntry = course[resolvedCourseId];
	if (!isRecord(selectedCourseEntry)) {
		return undefined;
	}

	const functionEntries = selectedCourseEntry.function;
	if (!Array.isArray(functionEntries)) {
		return undefined;
	}

	const courseDefaults: Record<string, unknown> = {};
	for (const entry of functionEntries) {
		if (isRecord(entry) && typeof entry.value === 'string' && 'default' in entry) {
			courseDefaults[entry.value] = entry.default;
		}
	}

	if (Object.keys(courseDefaults).length === 0) {
		return undefined;
	}

	const coercedOverrides: Record<string, unknown> = {};
	for (const [name, rawValue] of Object.entries(courseSelection?.parameterOverrides ?? {})) {
		if (!(name in courseDefaults)) {
			continue; // unknown/stale parameter name for this course — fail-closed, never inject raw
		}
		const originalType = typeof courseDefaults[name];
		if (originalType === 'number') {
			const numericValue = Number(rawValue);
			if (Number.isFinite(numericValue)) {
				coercedOverrides[name] = numericValue;
			}
			// else: leave it out — courseDefaults[name]'s own value wins via the merge below (matches the old
			// "skip invalid number override" behavior, just relocated)
		} else if (originalType === 'boolean') {
			coercedOverrides[name] = rawValue === 'true';
		} else {
			coercedOverrides[name] = rawValue;
		}
	}

	return {
		courseType,
		smartCourseType,
		resolvedCourseId,
		selectedCourseEntry,
		courseDefaults,
		coercedOverrides,
	};
}

/**
 * Extracts a real `WMStart` command payload from a device's own downloaded model JSON
 * (`ControlWifi`/`Config`/`Course` slices). Coerces raw string parameter overrides using the
 * device's own freshly-resolved course-default types (no persisted `valueType`, no extra fetch).
 * Drops unknown/stale override names, never injecting raw, uncoerced strings into the payload.
 * Pure, no I/O — returns `undefined` on any missing/malformed shape instead of throwing, so
 * callers can treat "no usable command" as a normal (fail-closed) outcome. Always uses the
 * model-declared default course (`Config.defaultCourse`) and its own `function[]` defaults — no
 * per-device course selection.
 */
export function extractWasherStartCommand(
	deviceModel: Record<string, unknown>,
	courseSelection?: WasherCourseSelection,
): WasherStartCommandPayload | undefined {
	if (!isRecord(deviceModel)) {
		return undefined;
	}

	const controlWifi = deviceModel.ControlWifi;
	if (!isRecord(controlWifi)) {
		return undefined;
	}

	const startEntry = controlWifi.WMStart;
	if (!isRecord(startEntry)) {
		return undefined;
	}

	const template = readWasherControlTemplate(startEntry);
	if (!template) {
		return undefined;
	}

	const courseData = resolveWasherCourseData(deviceModel, courseSelection);
	if (!courseData) {
		return undefined;
	}

	const mergedInner: Record<string, unknown> = {
		...template.inner,
		...courseData.courseDefaults,
		...courseData.coercedOverrides,
		[courseData.courseType]: courseData.resolvedCourseId,
		[courseData.smartCourseType]: 'NOT_SELECTED',
	};

	return {
		command: typeof startEntry.command === 'string' ? startEntry.command : undefined,
		dataSetList: { [template.dev]: mergedInner },
		resolvedCourseId: courseData.resolvedCourseId,
	};
}
