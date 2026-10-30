import type { ThinqConnectEnergyPeriod, ThinqConnectResource } from './thinqConnectApiClient.js';

export interface EnergyUsageRow {
	usedDate: string;
	useAmount: number;
}

const RESULT_CODE_MEANINGS: Readonly<Record<string, string>> = {
	'0000': 'OK',
	'1212': 'Not an owned device',
	'1220': 'Property not supported',
	'1221': 'Product not supported by the Energy API',
	'1307': 'Country not supported',
	'2214': 'Request failed',
};

const NOT_SUPPORTED_CODES: ReadonlySet<string> = new Set(['1220', '1221', '1307']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readEnergyResultCode(response: ThinqConnectResource): string | undefined {
	const { resultCode } = response;
	return typeof resultCode === 'string' ? resultCode : undefined;
}

export function describeEnergyResultCode(code: string | undefined): string {
	if (code === undefined) {
		return 'No resultCode in the response';
	}
	return RESULT_CODE_MEANINGS[code] ?? `Unknown result code ${code}`;
}

export function isEnergyNotSupportedCode(code: string | undefined): boolean {
	return code !== undefined && NOT_SUPPORTED_CODES.has(code);
}

function stringItems(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function readEnergyProperties(response: ThinqConnectResource): string[] {
	const { result } = response;
	if (isRecord(result) && Array.isArray(result.property)) {
		return stringItems(result.property);
	}
	return stringItems(response.property);
}

/** The amount key is named after the requested property (e.g. `energyUsage`); `useAmount` is the documented fallback. */
export function readEnergyUsageRows(response: ThinqConnectResource, property?: string): EnergyUsageRow[] {
	const { result } = response;
	if (!isRecord(result) || !Array.isArray(result.dataList)) {
		return [];
	}
	const rows: EnergyUsageRow[] = [];
	for (const item of result.dataList as unknown[]) {
		if (!isRecord(item) || typeof item.usedDate !== 'string') {
			continue;
		}
		const named = property === undefined ? undefined : item[property];
		const amount = typeof named === 'number' ? named : item.useAmount;
		if (typeof amount === 'number' && Number.isFinite(amount)) {
			rows.push({ usedDate: item.usedDate, useAmount: amount });
		}
	}
	return rows;
}

export function summarizeEnergyUsage(rows: readonly EnergyUsageRow[]): { count: number; total: number } {
	return { count: rows.length, total: rows.reduce((sum, row) => sum + row.useAmount, 0) };
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** Local-time default window: DAILY = last 7 days (YYYYMMDD), MONTHLY = last 3 months (YYYYMM). */
export function defaultEnergyRange(
	period: ThinqConnectEnergyPeriod,
	now: Date,
): { startDate: string; endDate: string } {
	if (period === 'DAILY') {
		const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
		const format = (date: Date): string =>
			`${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`;
		return { startDate: format(start), endDate: format(now) };
	}
	const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
	const format = (date: Date): string => `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1, 2)}`;
	return { startDate: format(start), endDate: format(now) };
}
