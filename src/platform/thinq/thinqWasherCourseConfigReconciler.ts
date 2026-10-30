import type { ThinqWasherControlConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import type { WasherCourseCatalog } from './thinqWasherCourseCatalogResolver.js';

/**
 * Backfills `washerControl.courses` with ONLY the currently-selected course's parameters (not
 * every catalog course, to keep the config page short). Maintains `availableCourseIds` as a
 * lightweight list of all valid course IDs. On a course selection change, replaces the entry with
 * the new course's fresh defaults. Additive-only for parameters within the selected entry: never
 * overwrites an already-stored parameter's `value`/`valueType`. Sets `selectedCourse` only if
 * currently unset. Safe to re-run on every plugin restart. Mutates `washerControl` in place;
 * returns `true` iff something was changed. Never throws.
 */
export function reconcileWasherCourseConfig(
	washerControl: ThinqWasherControlConfig,
	catalog: WasherCourseCatalog,
): boolean {
	let changed = false;

	// Step 1: Maintain availableCourseIds list
	const availableCourseIds = catalog.courses.map((c) => c.id);
	const oldAvailableCourseIds = washerControl.availableCourseIds ?? [];
	if (
		availableCourseIds.length !== oldAvailableCourseIds.length ||
		availableCourseIds.some((id, i) => id !== oldAvailableCourseIds[i])
	) {
		washerControl.availableCourseIds = availableCourseIds;
		changed = true;
	}

	// Step 2: Set selectedCourse to default if unset
	if (!washerControl.selectedCourse && catalog.defaultCourseId) {
		washerControl.selectedCourse = catalog.defaultCourseId;
		changed = true;
	}

	// Step 3: Early return if no selectedCourse
	const selectedCourseId = washerControl.selectedCourse;
	if (!selectedCourseId) {
		return changed;
	}

	// Step 4: Look up the selected course in the catalog
	const catalogCourse = catalog.courses.find((c) => c.id === selectedCourseId);
	if (!catalogCourse) {
		// Fail-closed: stale or typo'd selectedCourse, don't touch courses[]
		return changed;
	}

	// Step 5: Initialize courses array if needed
	washerControl.courses ??= [];
	const existingEntry = washerControl.courses.find((c) => c.id === selectedCourseId);

	// Guard: Check if existing entry has a valid parameters shape (Record<string, string>)
	// If not (e.g., legacy array, null, or contains non-string values), treat as "no entry"
	const existingEntryHasValidParametersShape =
		existingEntry !== undefined &&
		existingEntry.parameters !== null &&
		typeof existingEntry.parameters === 'object' &&
		!Array.isArray(existingEntry.parameters) &&
		Object.values(existingEntry.parameters).every((value) => typeof value === 'string');

	// Step 6: If no entry exists for the selected course, replace entire courses[] with a fresh entry
	if (!existingEntry || !existingEntryHasValidParametersShape) {
		const parameters: Record<string, string> = {};
		for (const p of catalogCourse.parameters) {
			parameters[p.name] = String(p.value);
		}
		washerControl.courses = [{ id: catalogCourse.id, parameters }];
		return true;
	}

	// Step 7: Entry exists for selected course: additive-only merge
	let entryChanged = false;
	for (const param of catalogCourse.parameters) {
		if (!(param.name in existingEntry.parameters)) {
			existingEntry.parameters[param.name] = String(param.value);
			entryChanged = true;
		}
	}

	// Step 8: Prune any stale entries down to just the selected one
	if (washerControl.courses.length > 1) {
		washerControl.courses = [existingEntry];
		return true;
	}

	// Step 9: Return whether anything changed
	return changed || entryChanged;
}
