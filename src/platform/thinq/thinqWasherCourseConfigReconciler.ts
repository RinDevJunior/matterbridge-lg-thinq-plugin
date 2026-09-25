import type { ThinqWasherControlConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { WasherCourseCatalog } from './thinqWasherCourseCatalogResolver.js';

/**
 * Backfills `washerControl.courses`/`washerControl.selectedCourse` from a freshly resolved course
 * catalog, additive-only: pushes new courses/parameters not yet present, sets `selectedCourse` only
 * if currently unset. Never overwrites an already-stored parameter's `value`/`valueType` or an
 * already-set `selectedCourse` — safe to re-run on every plugin restart. Mutates `washerControl` in
 * place; returns `true` iff something was actually pushed/set. Never throws.
 */
export function reconcileWasherCourseConfig(
	washerControl: ThinqWasherControlConfig,
	catalog: WasherCourseCatalog,
): boolean {
	washerControl.courses ??= [];

	let changed = false;

	for (const catalogCourse of catalog.courses) {
		let existingEntry = washerControl.courses.find((c) => c.id === catalogCourse.id);
		if (!existingEntry) {
			existingEntry = { id: catalogCourse.id, parameters: [] };
			washerControl.courses.push(existingEntry);
			changed = true;
		}

		for (const param of catalogCourse.parameters) {
			const hasParam = existingEntry.parameters.some((p) => p.name === param.name);
			if (!hasParam) {
				existingEntry.parameters.push({
					name: param.name,
					value: String(param.value),
					valueType: param.valueType,
				});
				changed = true;
			}
		}
	}

	if (!washerControl.selectedCourse && catalog.defaultCourseId) {
		washerControl.selectedCourse = catalog.defaultCourseId;
		changed = true;
	}

	return changed;
}
