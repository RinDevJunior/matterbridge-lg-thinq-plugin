export interface WasherCourseCatalogParameter {
	readonly name: string;
	readonly value: unknown;
	readonly valueType: 'string' | 'number' | 'boolean' | 'other';
}

export interface WasherCourseCatalogEntry {
	readonly id: string;
	readonly parameters: readonly WasherCourseCatalogParameter[];
}

export interface WasherCourseCatalog {
	readonly defaultCourseId?: string;
	readonly courses: readonly WasherCourseCatalogEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function resolveValueType(defaultValue: unknown): WasherCourseCatalogParameter['valueType'] {
	if (typeof defaultValue === 'string') return 'string';
	if (typeof defaultValue === 'number') return 'number';
	if (typeof defaultValue === 'boolean') return 'boolean';
	return 'other';
}

/**
 * Extracts every wash course (not just the model-declared default) and its `function[]` parameters
 * from a device's own downloaded model JSON, for config auto-fill. Pure, no I/O — returns `undefined`
 * on any missing/malformed shape instead of throwing, mirroring `extractWasherStartCommand`'s
 * fail-closed style. Deliberately does not share its `isRecord()` helper with any other resolver file.
 */
export function extractWasherCourseCatalog(deviceModel: Record<string, unknown>): WasherCourseCatalog | undefined {
	if (!isRecord(deviceModel)) {
		return undefined;
	}

	const course = deviceModel.Course;
	if (!isRecord(course)) {
		return undefined;
	}

	const courses: WasherCourseCatalogEntry[] = [];
	for (const courseId of Object.keys(course)) {
		const courseEntry = course[courseId];
		if (!isRecord(courseEntry)) {
			continue;
		}

		const functionEntries = courseEntry.function;
		if (!Array.isArray(functionEntries)) {
			continue;
		}

		const parameters: WasherCourseCatalogParameter[] = [];
		for (const entry of functionEntries) {
			if (isRecord(entry) && typeof entry.value === 'string' && 'default' in entry) {
				parameters.push({
					name: entry.value,
					value: entry.default,
					valueType: resolveValueType(entry.default),
				});
			}
		}

		if (parameters.length === 0) {
			continue;
		}

		courses.push({ id: courseId, parameters });
	}

	if (courses.length === 0) {
		return undefined;
	}

	const config = deviceModel.Config;
	const defaultCourseId =
		isRecord(config) && typeof config.defaultCourse === 'string' ? config.defaultCourse : undefined;

	return { defaultCourseId, courses };
}
