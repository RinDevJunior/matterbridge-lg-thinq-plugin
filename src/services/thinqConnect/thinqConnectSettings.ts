import type { ThinqConnectPayload } from './thinqConnectApiClient.js';
import { locationNameOf } from './thinqConnectWasher.js';

export type ConnectSettingAccess = 'r' | 'w' | 'rw' | 'fixed' | 'state-only';

export interface ConnectSettingRow {
	property: string;
	access: ConnectSettingAccess;
	type?: string;
	current?: unknown;
	fixedValue?: unknown;
	allowed?: string;
	unit?: string;
}

export interface ConnectSettingGroup {
	name: string;
	label?: string;
	rows: ConnectSettingRow[];
}

export interface ConnectSettingsBlock {
	location?: string;
	groups: ConnectSettingGroup[];
}

export interface ConnectSettingsReport {
	blocks: ConnectSettingsBlock[];
	rowCount: number;
	courseProperties: string[];
}

export const COURSE_PATTERN = /course|program|cycle(type|name|select)/i;

type Node = Record<string, unknown>;

interface ProfileBlock {
	location?: string;
	node: Node;
}

interface GroupSource {
	name: string;
	label?: string;
	unit?: string;
	skipUnitRow: boolean;
	profile?: Node;
	state?: Node;
}

function isPlainObject(value: unknown): value is Node {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringItems(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isDescriptor(value: unknown): value is Node {
	return isPlainObject(value) && (Object.hasOwn(value, 'type') || Object.hasOwn(value, 'mode'));
}

function formatItem(item: unknown): string {
	return typeof item === 'string' ? item : JSON.stringify(item);
}

function formatSpec(spec: unknown): string | undefined {
	if (Array.isArray(spec)) {
		return spec.length > 0 ? spec.map(formatItem).join(', ') : undefined;
	}
	if (!isPlainObject(spec) || !Object.hasOwn(spec, 'min') || !Object.hasOwn(spec, 'max')) {
		return undefined;
	}
	const step: unknown = spec['step'];
	const except: unknown = spec['except'];
	const stepText = step === undefined ? '' : ` step ${formatItem(step)}`;
	const exceptText = Array.isArray(except) && except.length > 0 ? ` except ${except.map(formatItem).join(',')}` : '';
	return `${formatItem(spec['min'])}..${formatItem(spec['max'])}${stepText}${exceptText}`;
}

function allowedOf(value: unknown): string | undefined {
	if (!isPlainObject(value) || (!Object.hasOwn(value, 'r') && !Object.hasOwn(value, 'w'))) {
		return formatSpec(value);
	}
	const readSpec: unknown = value['r'];
	const writeSpec: unknown = value['w'];
	const read = formatSpec(readSpec);
	const write = formatSpec(writeSpec);
	if (read !== undefined && write !== undefined) {
		return JSON.stringify(readSpec) === JSON.stringify(writeSpec) ? read : `read: ${read} / write: ${write}`;
	}
	return write !== undefined ? `write: ${write}` : read;
}

function accessOf(descriptor: Node): 'r' | 'w' | 'rw' {
	const modes = stringItems(descriptor['mode']);
	const canRead = modes.includes('r');
	const canWrite = modes.includes('w');
	if (canRead && canWrite) {
		return 'rw';
	}
	return canWrite ? 'w' : 'r';
}

function unitFromProfile(profile: Node | undefined): string | undefined {
	if (!profile) {
		return undefined;
	}
	const unit: unknown = profile['unit'];
	if (typeof unit === 'string') {
		return unit;
	}
	if (!isDescriptor(unit)) {
		return undefined;
	}
	const value: unknown = unit['value'];
	const reads = isPlainObject(value) ? stringItems(value['r']) : [];
	return reads.length === 1 ? reads[0] : undefined;
}

function groupUnitOf(source: GroupSource): string | undefined {
	const stateUnit: unknown = source.state?.['unit'];
	return source.unit ?? (typeof stateUnit === 'string' ? stateUnit : undefined) ?? unitFromProfile(source.profile);
}

function rowsOf(source: GroupSource): ConnectSettingRow[] {
	const unit = groupUnitOf(source);
	const names = new Set<string>([...Object.keys(source.profile ?? {}), ...Object.keys(source.state ?? {})]);
	names.delete('location');
	if (source.skipUnitRow) {
		names.delete('unit');
	}

	const rows: ConnectSettingRow[] = [];
	for (const property of names) {
		const current: unknown = source.state?.[property];
		if (source.profile === undefined || !Object.hasOwn(source.profile, property)) {
			rows.push({ property, access: 'state-only', current });
			continue;
		}
		const profileValue: unknown = source.profile[property];
		if (!isDescriptor(profileValue)) {
			rows.push({ property, access: 'fixed', fixedValue: profileValue });
			continue;
		}
		const type = typeof profileValue['type'] === 'string' ? profileValue['type'] : undefined;
		const allowed = allowedOf(profileValue['value']);
		const showUnit = (type === 'number' || type === 'range') && property !== 'unit' && unit !== undefined;
		rows.push({
			property,
			access: accessOf(profileValue),
			type,
			current,
			allowed,
			unit: showUnit ? unit : undefined,
		});
	}
	return rows;
}

function arrayGroupSources(name: string, profileValue: unknown, stateValue: unknown): GroupSource[] {
	const profileEntries: unknown[] = Array.isArray(profileValue) ? profileValue : [];
	const stateEntries: unknown[] = Array.isArray(stateValue) ? stateValue : [];
	const usedStateIndexes = new Set<number>();
	const sources: GroupSource[] = [];

	for (const [index, entry] of profileEntries.entries()) {
		if (!isPlainObject(entry)) {
			continue;
		}
		const unit = typeof entry['unit'] === 'string' ? entry['unit'] : undefined;
		const byUnit =
			unit === undefined ? -1 : stateEntries.findIndex((item) => isPlainObject(item) && item['unit'] === unit);
		const stateIndex = byUnit >= 0 ? byUnit : index;
		usedStateIndexes.add(stateIndex);
		const stateEntry: unknown = stateEntries[stateIndex];
		sources.push({
			name,
			label: unit ?? `#${index}`,
			unit,
			skipUnitRow: unit !== undefined,
			profile: entry,
			state: isPlainObject(stateEntry) ? stateEntry : undefined,
		});
	}

	for (const [index, entry] of stateEntries.entries()) {
		if (usedStateIndexes.has(index) || !isPlainObject(entry)) {
			continue;
		}
		const unit = typeof entry['unit'] === 'string' ? entry['unit'] : undefined;
		sources.push({ name, label: unit ?? `#${index}`, unit, skipUnitRow: unit !== undefined, state: entry });
	}
	return sources;
}

function groupSourcesOf(profileBlock: Node, stateBlock: Node | undefined): GroupSource[] {
	const names = new Set<string>([...Object.keys(profileBlock), ...Object.keys(stateBlock ?? {})]);
	names.delete('location');

	const sources: GroupSource[] = [];
	for (const name of names) {
		const profileValue: unknown = profileBlock[name];
		const stateValue: unknown = stateBlock?.[name];
		if (Array.isArray(profileValue) || (Array.isArray(stateValue) && profileValue === undefined)) {
			sources.push(...arrayGroupSources(name, profileValue, stateValue));
			continue;
		}
		sources.push({
			name,
			skipUnitRow: false,
			profile: isPlainObject(profileValue) ? profileValue : undefined,
			state: isPlainObject(stateValue) ? stateValue : undefined,
		});
	}
	return sources;
}

function profileBlocksOf(profile: ThinqConnectPayload | undefined): ProfileBlock[] {
	const root: unknown = isPlainObject(profile) ? profile['property'] : undefined;
	if (isPlainObject(root)) {
		return [{ node: root }];
	}
	if (!Array.isArray(root)) {
		return [];
	}
	return root.filter(isPlainObject).map((node) => ({ location: locationNameOf(node), node }));
}

function stateBlockOf(
	state: ThinqConnectPayload | undefined,
	location: string | undefined,
	singleBlock: boolean,
): Node | undefined {
	if (isPlainObject(state)) {
		return state;
	}
	if (!Array.isArray(state)) {
		return undefined;
	}
	const matched: unknown = location === undefined ? undefined : state.find((item) => locationNameOf(item) === location);
	if (matched !== undefined) {
		return isPlainObject(matched) ? matched : undefined;
	}
	const first: unknown = state[0];
	return singleBlock && isPlainObject(first) ? first : undefined;
}

function courseMatches(names: Iterable<string>): string[] {
	return [...new Set(names)].filter((name) => COURSE_PATTERN.test(name));
}

export function buildConnectSettingsReport(
	profile: ThinqConnectPayload | undefined,
	state: ThinqConnectPayload | undefined,
): ConnectSettingsReport {
	const profileBlocks = profileBlocksOf(profile);
	const blocks: ConnectSettingsBlock[] = [];
	const names: string[] = [];
	let rowCount = 0;

	for (const { location, node } of profileBlocks) {
		const stateBlock = stateBlockOf(state, location, profileBlocks.length === 1);
		const groups: ConnectSettingGroup[] = [];
		for (const source of groupSourcesOf(node, stateBlock)) {
			const rows = rowsOf(source);
			if (rows.length === 0) {
				continue;
			}
			groups.push({ name: source.name, label: source.label, rows });
			rowCount += rows.length;
			names.push(source.name, ...rows.map((row) => row.property));
		}
		blocks.push({ location, groups });
	}

	return { blocks, rowCount, courseProperties: courseMatches(names) };
}

/** undefined when the device is not washer-like. */
export function describeCourseSupport(
	deviceType: string | undefined,
	report: ConnectSettingsReport,
): string | undefined {
	const hasWasherMode = report.blocks.some((block) =>
		block.groups.some((group) => group.rows.some((row) => row.property === 'washerOperationMode')),
	);
	const upperType = (deviceType ?? '').toUpperCase();
	const washerLike = (upperType.includes('WASH') && !upperType.includes('DISH')) || hasWasherMode;
	if (!washerLike) {
		return undefined;
	}
	if (report.courseProperties.length === 0) {
		return 'no course settings in the ThinQ Connect profile for this model (V1 legacy API has them)';
	}
	return `course properties: ${report.courseProperties.join(', ')}`;
}
