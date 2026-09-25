import type { ThinqWasherControlConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { WasherCourseSelection } from './thinqWasherStartCommandResolver.js';

/**
 * Reads the config's current `selectedCourse` and that course's current parameter values, coercing
 * each stored string back to its recorded `valueType`, into a `WasherCourseSelection` — the shape
 * `extractWasherStartCommand()` accepts. Pure, never throws.
 */
export function resolveWasherCourseSelectionFromConfig(washerControl: ThinqWasherControlConfig): WasherCourseSelection {
	const courseId = washerControl.selectedCourse;
	const courseEntry = washerControl.courses?.find((c) => c.id === courseId);

	const parameterOverrides: Record<string, unknown> = {};
	for (const param of courseEntry?.parameters ?? []) {
		if (typeof param.name !== 'string' || param.name.length === 0) {
			continue;
		}

		switch (param.valueType) {
			case 'number': {
				const numericValue = Number(param.value);
				if (Number.isFinite(numericValue)) {
					parameterOverrides[param.name] = numericValue;
				}
				break;
			}
			case 'boolean':
				parameterOverrides[param.name] = param.value === 'true';
				break;
			default:
				parameterOverrides[param.name] = param.value;
				break;
		}
	}

	return { courseId, parameterOverrides };
}
