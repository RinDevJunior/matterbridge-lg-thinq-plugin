import crypto from 'node:crypto';

import axios from 'axios';
import { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiError } from '../../errors/index.js';
import { describeThinqConnectResultCode } from './thinqConnectErrorCodes.js';
import { getThinqConnectBaseUrl } from './thinqConnectRegions.js';

/** Public SDK constant from pythinqconnect; not a secret. */
const API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3';
const SERVICE_PHASE = 'OP';
const REQUEST_TIMEOUT_MS = 15000;
const PAT_PATTERN = /^[A-Za-z0-9._~+/=-]+$/;
const PAT_MIN_LENGTH = 20;
const PAT_MAX_LENGTH = 512;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface ThinqConnectDevice {
	deviceId: string;
	deviceInfo?: {
		deviceType?: string;
		modelName?: string;
		alias?: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface ThinqConnectValidationResult {
	deviceCount: number;
	devices: ThinqConnectDevice[];
}

interface ThinqConnectErrorBody {
	error?: {
		code?: string | number;
		message?: string;
	};
}

interface ThinqConnectDevicesResponse {
	response?: ThinqConnectDevice[];
}

export type ThinqConnectResource = Record<string, unknown>;

/** Washers return a per-location array (`[{ location, runState, ... }]`); ACs return an object. */
export type ThinqConnectPayload = ThinqConnectResource | unknown[];

interface ThinqConnectResourceResponse {
	response?: unknown;
}

export const THINQ_CONNECT_ENERGY_PERIODS = ['DAILY', 'MONTHLY'] as const;

export type ThinqConnectEnergyPeriod = (typeof THINQ_CONNECT_ENERGY_PERIODS)[number];

export interface ThinqConnectEnergyUsageQuery {
	period: ThinqConnectEnergyPeriod;
	startDate: string;
	endDate: string;
	property?: string;
}

const ENERGY_PROPERTY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const MAX_DAILY_SPAN_DAYS = 31;
const MAX_MONTHLY_SPAN_MONTHS = 12;
const MS_PER_DAY = 86_400_000;

function isPlainResource(value: unknown): value is ThinqConnectResource {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertValidDeviceId(deviceId: string): void {
	if (!DEVICE_ID_PATTERN.test(deviceId)) {
		throw new ThinqConnectApiError('ThinQ Connect device id has an invalid format');
	}
}

/** Parses `YYYYMMDD` as a real calendar day (UTC day number), or `undefined`. */
function parseDailyDate(value: string): number | undefined {
	if (!/^\d{8}$/.test(value)) {
		return undefined;
	}
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(4, 6));
	const day = Number(value.slice(6, 8));
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
		return undefined;
	}
	return date.getTime() / MS_PER_DAY;
}

/** Parses `YYYYMM` into a month index (year * 12 + month), or `undefined`. */
function parseMonthlyDate(value: string): number | undefined {
	if (!/^\d{6}$/.test(value)) {
		return undefined;
	}
	const month = Number(value.slice(4, 6));
	if (month < 1 || month > 12) {
		return undefined;
	}
	return Number(value.slice(0, 4)) * 12 + (month - 1);
}

function assertValidEnergyQuery(query: ThinqConnectEnergyUsageQuery): void {
	if (!THINQ_CONNECT_ENERGY_PERIODS.includes(query.period)) {
		throw new ThinqConnectApiError('ThinQ Connect energy period must be DAILY or MONTHLY');
	}
	if (query.property !== undefined && !ENERGY_PROPERTY_PATTERN.test(query.property)) {
		throw new ThinqConnectApiError('ThinQ Connect energy property has an invalid format');
	}
	const daily = query.period === 'DAILY';
	const parse = daily ? parseDailyDate : parseMonthlyDate;
	const format = daily ? 'YYYYMMDD' : 'YYYYMM';
	const start = parse(query.startDate);
	const end = parse(query.endDate);
	if (start === undefined || end === undefined) {
		throw new ThinqConnectApiError(`ThinQ Connect energy dates must be valid ${format} values for ${query.period}`);
	}
	if (start > end) {
		throw new ThinqConnectApiError('ThinQ Connect energy startDate must not be after endDate');
	}
	const span = end - start + 1;
	if (daily && span > MAX_DAILY_SPAN_DAYS) {
		throw new ThinqConnectApiError(`ThinQ Connect energy DAILY range is limited to ${MAX_DAILY_SPAN_DAYS} days`);
	}
	if (!daily && span > MAX_MONTHLY_SPAN_MONTHS) {
		throw new ThinqConnectApiError(
			`ThinQ Connect energy MONTHLY range is limited to ${MAX_MONTHLY_SPAN_MONTHS} months`,
		);
	}
}

/** Client for the official LG ThinQ Connect API, authenticated with a Personal Access Token; the only write is `controlDevice`. */
export class ThinqConnectApiClient {
	private readonly personalAccessToken: string;
	private readonly baseUrl: string;
	private readonly countryCode: string;

	constructor(
		personalAccessToken: string,
		country: string,
		private readonly logger: AnsiLogger,
		private readonly clientId = `thinq-open-${crypto.randomUUID()}`,
	) {
		const token = personalAccessToken.trim();
		if (!token) {
			throw new ThinqConnectApiError('A ThinQ Personal Access Token is required', '1103');
		}
		if (token.length < PAT_MIN_LENGTH || token.length > PAT_MAX_LENGTH || !PAT_PATTERN.test(token)) {
			throw new ThinqConnectApiError('ThinQ Personal Access Token has an invalid format', '1103');
		}
		this.personalAccessToken = token;
		this.baseUrl = getThinqConnectBaseUrl(country);
		this.countryCode = country.trim().toUpperCase();
	}

	public async getDevices(): Promise<ThinqConnectDevice[]> {
		const data = await this.get<ThinqConnectDevicesResponse>('/devices');
		return Array.isArray(data.response) ? data.response : [];
	}

	public async getDeviceProfile(deviceId: string): Promise<ThinqConnectPayload> {
		return this.getResource(deviceId, 'profile');
	}

	public async getDeviceState(deviceId: string): Promise<ThinqConnectPayload> {
		return this.getResource(deviceId, 'state');
	}

	public async controlDevice(deviceId: string, payload: ThinqConnectResource): Promise<ThinqConnectPayload> {
		const data = await this.post<ThinqConnectResourceResponse>(this.devicePath(deviceId, '/control'), payload, {
			'x-conditional-control': 'true',
		});
		const response = data?.response;
		if (Array.isArray(response)) {
			return response;
		}
		return typeof response === 'object' && response !== null ? (response as ThinqConnectResource) : {};
	}

	public async getEnergyProfile(deviceId: string): Promise<ThinqConnectResource> {
		assertValidDeviceId(deviceId);
		return this.getEnergyResource(`/devices/energy/${encodeURIComponent(deviceId)}/profile`);
	}

	public async getEnergyUsage(deviceId: string, query: ThinqConnectEnergyUsageQuery): Promise<ThinqConnectResource> {
		assertValidDeviceId(deviceId);
		assertValidEnergyQuery(query);
		const params = new URLSearchParams();
		if (query.property !== undefined) {
			params.set('property', query.property);
		}
		params.set('period', query.period);
		params.set('startDate', query.startDate);
		params.set('endDate', query.endDate);
		return this.getEnergyResource(`/devices/energy/${encodeURIComponent(deviceId)}/usage?${params.toString()}`);
	}

	public async validateToken(): Promise<ThinqConnectValidationResult> {
		const devices = await this.getDevices();
		return { deviceCount: devices.length, devices };
	}

	private async getResource(deviceId: string, kind: 'profile' | 'state'): Promise<ThinqConnectPayload> {
		const data = await this.get<ThinqConnectResourceResponse>(this.devicePath(deviceId, `/${kind}`));
		const response = data.response;
		if (Array.isArray(response)) {
			return response;
		}
		return typeof response === 'object' && response !== null ? (response as ThinqConnectResource) : {};
	}

	private async getEnergyResource(path: string): Promise<ThinqConnectResource> {
		const data = await this.get<ThinqConnectResourceResponse>(path);
		const { response } = data;
		return isPlainResource(response) ? response : {};
	}

	private devicePath(deviceId: string, suffix: '/control' | '/profile' | '/state'): string {
		assertValidDeviceId(deviceId);
		return `/devices/${encodeURIComponent(deviceId)}${suffix}`;
	}

	private async get<T>(path: string): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		this.logger.debug(`ThinQ Connect request -> GET ${url}`);
		try {
			const { data } = await axios.get<T>(url, {
				headers: this.buildHeaders(),
				timeout: REQUEST_TIMEOUT_MS,
			});
			return data;
		} catch (error) {
			throw this.toApiError(error);
		}
	}

	private async post<T>(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		this.logger.debug(`ThinQ Connect request -> POST ${url}`);
		try {
			const { data } = await axios.post<T>(url, body, {
				headers: { ...this.buildHeaders(), 'Content-Type': 'application/json', ...extraHeaders },
				timeout: REQUEST_TIMEOUT_MS,
			});
			return data;
		} catch (error) {
			throw this.toApiError(error);
		}
	}

	private buildHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.personalAccessToken}`,
			'x-country': this.countryCode,
			'x-message-id': Buffer.from(crypto.randomUUID().replace(/-/g, ''), 'hex').toString('base64url'),
			'x-client-id': this.clientId,
			'x-api-key': API_KEY,
			'x-service-phase': SERVICE_PHASE,
			Accept: 'application/json',
		};
	}

	private toApiError(error: unknown): ThinqConnectApiError {
		if (!axios.isAxiosError(error)) {
			const message = error instanceof Error ? error.message : String(error);
			return new ThinqConnectApiError(`ThinQ Connect request failed: ${message}`);
		}
		if (!error.response) {
			return new ThinqConnectApiError(`ThinQ Connect request failed: ${error.message}`);
		}

		const status = error.response.status;
		const body = error.response.data as ThinqConnectErrorBody | undefined;
		const code = body?.error?.code;
		if (code === undefined || code === null) {
			return new ThinqConnectApiError(`ThinQ Connect request failed (HTTP ${status})`, undefined, status);
		}

		const resultCode = String(code);
		const reason = describeThinqConnectResultCode(resultCode) ?? body?.error?.message ?? 'ThinQ Connect request failed';
		return new ThinqConnectApiError(`${reason} (code ${resultCode})`, resultCode, status);
	}
}
