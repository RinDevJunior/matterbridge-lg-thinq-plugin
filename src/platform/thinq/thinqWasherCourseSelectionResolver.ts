import type { ThinqWasherControlConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { WasherCourseSelection } from './thinqWasherStartCommandResolver.js';

/**
 * Reads the config's current `selectedCourse` and that course's current parameter values into a
 * `WasherCourseSelection` — the shape `extractWasherStartCommand()` accepts. No type coercion
 * (parameters remain as strings; coercion happens in `extractWasherStartCommand()` using its own
 * freshly-parsed course defaults as the type source). Pure, never throws.
 */
export function resolveWasherCourseSelectionFromConfig(washerControl: ThinqWasherControlConfig): WasherCourseSelection {
	const courseId = washerControl.selectedCourse;
	const courseEntry = washerControl.courses?.find((c) => c.id === courseId);

	return {
		courseId,
		parameterOverrides: courseEntry?.parameters ? { ...courseEntry.parameters } : undefined,
	};
}
