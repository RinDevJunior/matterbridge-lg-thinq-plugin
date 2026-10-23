import type { ThinqWasherControlConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import { resolveWasherCourseSelectionFromConfig } from './thinqWasherCourseSelectionResolver.js';
import { getWasherModelOptionValues } from './thinqWasherDownloadCommandResolver.js';
import { resolveWasherCourseData } from './thinqWasherStartCommandResolver.js';
import { buildWasherVtRequest, WASHER_VT_OPTION_KEYS, type WasherVtOptions } from './thinqWasherVtCtrl.js';

export interface WasherVtStagePlan {
	readonly courseId: string;
	readonly options: WasherVtOptions;
	readonly ignoredOptions: readonly string[];
}

/** True when the model has `Config.uniProtocol === true` and `ControlWifi.vtCtrl.command === 'Set'`. */
export function isWasherVtSupported(model: Record<string, unknown>): boolean {
	return buildWasherVtRequest('vt-start', model, { variant: 'a' }) !== undefined;
}

/**
 * Course (and the few option cells worth sending) the user picked in the plugin settings. `undefined`
 * (fail closed) when `selectedCourse` is unset or unknown to the model; never falls back to `Config.defaultCourse`.
 */
export function resolveWasherVtStagePlan(
	model: Record<string, unknown>,
	washerControl: ThinqWasherControlConfig,
): WasherVtStagePlan | undefined {
	const selection = resolveWasherCourseSelectionFromConfig(washerControl);
	if (selection.courseId === undefined) {
		return undefined;
	}
	const data = resolveWasherCourseData(model, selection);
	if (data === undefined || data.resolvedCourseId !== selection.courseId) {
		return undefined;
	}

	const options: WasherVtOptions = {};
	const ignoredOptions: string[] = [];
	for (const key of WASHER_VT_OPTION_KEYS) {
		const configured = selection.parameterOverrides?.[key];
		if (configured === undefined) {
			continue;
		}
		const isDefault = String(data.courseDefaults[key]) === configured;
		const isListed = getWasherModelOptionValues(model, data.resolvedCourseId, key)?.includes(configured) === true;
		if (!isDefault && isListed) {
			options[key] = configured;
		} else {
			ignoredOptions.push(`${key}=${configured}`);
		}
	}
	return { courseId: data.resolvedCourseId, options, ignoredOptions };
}
