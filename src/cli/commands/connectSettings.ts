import { AnsiLogger } from 'matterbridge/logger';

import {
	ThinqConnectApiClient,
	type ThinqConnectDevice,
	type ThinqConnectPayload,
} from '../../services/thinqConnect/thinqConnectApiClient.js';
import {
	buildConnectSettingsReport,
	type ConnectSettingRow,
	type ConnectSettingsReport,
	describeCourseSupport,
} from '../../services/thinqConnect/thinqConnectSettings.js';
import type { CliPatSession } from '../types.js';

export interface ConnectSettingsOptions {
	deviceId?: string;
	brief: boolean;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function formatValue(value: unknown): string {
	if (value === undefined) {
		return '-';
	}
	if (typeof value === 'string') {
		return value;
	}
	return typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function formatRow(row: ConnectSettingRow, nameWidth: number, accessWidth: number): string {
	const name = row.property.padEnd(nameWidth);
	const access = row.access.padEnd(accessWidth);
	if (row.access === 'fixed') {
		return `      ${name}${access}= ${formatValue(row.fixedValue)}`;
	}
	const current = row.current === undefined ? '-' : formatValue(row.current);
	const value = row.unit !== undefined && row.current !== undefined ? `${current} ${row.unit}` : current;
	const allowed = row.allowed !== undefined ? `  (${row.allowed})` : '';
	return `      ${name}${access}= ${value}${allowed}`;
}

/** Pure: lines for the settings summary (2-space base indent; location, group, row levels). */
export function formatConnectSettings(report: ConnectSettingsReport): string[] {
	const lines: string[] = [];
	for (const block of report.blocks) {
		if (block.location !== undefined) {
			lines.push(`  location ${block.location}`);
		}
		for (const group of block.groups) {
			const header = group.label !== undefined ? `    [${group.name} ${group.label}]` : `    [${group.name}]`;
			lines.push(header);
			const nameWidth = Math.max(...group.rows.map((row) => row.property.length)) + 2;
			const accessWidth = Math.max(...group.rows.map((row) => row.access.length)) + 2;
			for (const row of group.rows) {
				lines.push(formatRow(row, nameWidth, accessWidth));
			}
		}
	}
	return lines;
}

export async function cmdConnectSettings(
	session: CliPatSession,
	options: ConnectSettingsOptions,
	logger: AnsiLogger,
): Promise<void> {
	console.log(`Country: ${session.country}`);

	let client: ThinqConnectApiClient;
	try {
		client = new ThinqConnectApiClient(session.personalAccessToken, session.country, logger);
	} catch (error) {
		console.error('Settings failed:', errorMessage(error));
		process.exitCode = 1;
		return;
	}

	let targets: ThinqConnectDevice[];
	let notListed = false;
	if (options.deviceId) {
		const deviceId = options.deviceId;
		try {
			const listed = await client.getDevices();
			const entry = listed.find((d) => d.deviceId === deviceId);
			notListed = entry === undefined;
			targets = [entry ?? { deviceId }];
		} catch (error) {
			console.log(`Warning: device list failed, reading by id only: ${errorMessage(error)}`);
			notListed = true;
			targets = [{ deviceId }];
		}
	} else {
		try {
			targets = await client.getDevices();
		} catch (error) {
			console.error('Settings failed:', errorMessage(error));
			process.exitCode = 1;
			return;
		}
	}

	if (targets.length === 0) {
		console.log('No devices visible for this token.');
		return;
	}

	// Sequential on purpose: ThinQ Connect rate-limits bursts (code 1306).
	for (const device of targets) {
		const info = device.deviceInfo;
		console.log(
			`Device: ${info?.alias ?? '(no alias)'} [${info?.deviceType ?? 'unknown'}] ${info?.modelName ?? ''} (${device.deviceId})`,
		);
		if (notListed) {
			console.log('  (device not present in GET /devices)');
		}

		let profile: ThinqConnectPayload | undefined;
		let state: ThinqConnectPayload | undefined;
		try {
			profile = await client.getDeviceProfile(device.deviceId);
		} catch (error) {
			console.log(`  profile: ERROR ${errorMessage(error)}`);
			process.exitCode = 1;
		}
		try {
			state = await client.getDeviceState(device.deviceId);
		} catch (error) {
			console.log(`  state: ERROR ${errorMessage(error)}`);
			process.exitCode = 1;
		}

		if (profile === undefined && state === undefined) {
			continue;
		}

		const report = buildConnectSettingsReport(profile, state);
		console.log('  settings:');
		for (const line of formatConnectSettings(report)) {
			console.log(line);
		}
		const courses = describeCourseSupport(info?.deviceType, report);
		if (courses !== undefined) {
			console.log(`  courses: ${courses}`);
		}
		if (!options.brief) {
			if (profile !== undefined) {
				console.log(`  raw profile: ${JSON.stringify(profile, null, 2)}`);
			}
			if (state !== undefined) {
				console.log(`  raw state: ${JSON.stringify(state, null, 2)}`);
			}
		}
	}
}
