import crypto from 'node:crypto';

import axios from 'axios';
import { AnsiLogger } from 'matterbridge/logger';

import { AuthenticationError, TokenExpiredError } from '../../errors/index.js';
import { maskSensitiveFields } from '../../utils/mask.js';
import {
	formatRfc2822Utc,
	Gateway,
	GatewayData,
	signThinqMessage,
	THINQ_APPLICATION_KEY,
	THINQ_CLIENT_ID,
	THINQ_OAUTH_SECRET_KEY,
} from './gateway.js';
import { ThinqSession } from './session.js';

const GATEWAY_URL = 'https://route.lgthinq.com:46030/v1/service/application/gateway-uri';
export const MQTT_ROUTE_URL = 'https://common.lgthinq.com/route';
const API_KEY = 'VGhpblEyLjAgU0VSVklDRQ==';
const API_CLIENT_ID = 'c713ea8e50f657534ff8b9d373dfebfc2ed70b88285c26b8ade49868c0b164d9';
/**
 * LG's own signal that the ThinQ access token has expired, returned as HTTP 400 with this `resultCode`
 * on some endpoints (e.g. `control-sync`) instead of a true 401. Mirrors `homebridge-lg-thinq`'s
 * `TokenExpiredErrorCode` (`errors/TokenExpiredError.ts:1`).
 */
const THINQ_TOKEN_EXPIRED_RESULT_CODE = '0102';

export interface ThinqHome {
	homeId: string;
	[key: string]: unknown;
}

export interface ThinqDeviceData {
	deviceId: string;
	alias: string;
	modelJsonUri: string;
	deviceType: number;
	modelName?: string;
	manufacture?: {
		macAddress?: string;
		salesModel?: string;
		serialNo?: string;
		manufactureModel?: string;
	};
	modemInfo?: {
		appVersion?: string;
		modelName?: string;
	};
	snapshot: { online?: boolean } & Record<string, unknown>;
	platformType?: string;
	online?: boolean;
}

export interface ThinqCommandPayload {
	dataKey?: string | null;
	dataValue?: unknown;
	dataSetList?: Record<string, unknown>;
	/** Field list for `Get` commands, e.g. `filterMngStateCtrl`'s `dataGetList`. */
	dataGetList?: string[];
	/** Overrides `sendCommand`'s default `'Set'`, e.g. `'Operation'` for AC power (homebridge-lg-thinq parity). */
	command?: string;
	/** Overrides `sendCommand`'s default `'basicCtrl'`, e.g. `'favoriteCtrl'` for swing mode compound writes (homebridge-lg-thinq parity). */
	ctrlKey?: string;
}

function randomMessageId(length = 22): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return result;
}

/**
 * REST client for the LG ThinQ2 cloud API. Ports `API.ts` (`homebridge-lg-thinq`) — gateway discovery,
 * home/device listing, device control, and reactive token refresh on 401.
 */
export class ThinqApiClient {
	private gateway: Gateway | undefined;
	private homesCache: ThinqHome[] | undefined;
	private userNumber: string | undefined;
	private clientId: string | undefined;

	constructor(
		private session: ThinqSession,
		private readonly country: string,
		private readonly language: string,
		private readonly logger: AnsiLogger,
	) {}

	/** Replaces the active session, e.g. once authentication completes. */
	public setSession(session: ThinqSession): void {
		this.session = session;
	}

	/**
	 * Records the user's numeric profile ID (`userNo`, from `getUserNumber`) for this client instance and
	 * computes a fresh per-session `x-client-id` from it (`sha256(userNumber + Date.now())`), mirroring
	 * `API.ready()` (`API.ts:392-399`). Must be called once after every successful authentication before any
	 * ThinQ2 listing call (`service/homes`, etc.), otherwise those calls 400.
	 */
	public setUserNumber(userNumber: string): void {
		this.userNumber = userNumber;
		this.clientId = crypto.createHash('sha256').update(`${userNumber}${Date.now()}`).digest('hex');
	}

	public async getGateway(): Promise<GatewayData> {
		if (!this.gateway) {
			const headers = this.defaultHeaders;
			this.logger.debug(
				`ThinQ getGateway request -> GET ${GATEWAY_URL} headers=${JSON.stringify(maskSensitiveFields(headers))}`,
			);

			const response = await axios.get<{ result: GatewayData }>(GATEWAY_URL, { headers });
			this.gateway = new Gateway(response.data.result);
		}

		return this.gateway.data;
	}

	/**
	 * Fetches a device's model JSON from its own CDN `modelJsonUri` (an absolute URL, not gateway-relative),
	 * so this bypasses the private `request()` helper entirely — direct unauthenticated `axios.get`, mirroring
	 * how both reference implementations fetch model JSON.
	 */
	public async getDeviceModel(modelJsonUri: string): Promise<Record<string, unknown>> {
		this.logger.debug(`ThinQ getDeviceModel request -> GET ${modelJsonUri}`);
		const response = await axios.get<Record<string, unknown>>(modelJsonUri);
		return response.data;
	}

	public async getListHomes(): Promise<ThinqHome[]> {
		if (!this.homesCache) {
			const data = await this.request<{ result: { item: ThinqHome[] } }>('get', 'service/homes');
			this.homesCache = data.result?.item ?? [];
		}

		return this.homesCache;
	}

	public async getListDevices(): Promise<ThinqDeviceData[]> {
		const homes = await this.getListHomes();
		const devices: ThinqDeviceData[] = [];

		for (const home of homes) {
			const data = await this.request<{ result: { devices: ThinqDeviceData[] } }>(
				'get',
				`service/homes/${home.homeId}`,
			);
			devices.push(...(data.result?.devices ?? []));
		}

		return devices;
	}

	public async sendCommand(deviceId: string, payload: ThinqCommandPayload): Promise<void> {
		if (!deviceId.trim()) {
			throw new Error('Invalid deviceId: must be a non-empty string.');
		}

		await this.request('post', `service/devices/${deviceId}/control-sync`, {
			ctrlKey: 'basicCtrl',
			command: 'Set',
			...payload,
		});
	}

	/**
	 * Same wire shape as `sendCommand`, but returns the raw response body instead of discarding it. Used both
	 * for diagnostic probes (e.g. `--probe-filter`) and real production polling (e.g. `getFilterState`) that
	 * need to inspect what the cloud actually returns for a given `Get` command, rather than fire-and-forget
	 * `Set` commands.
	 */
	public async sendCommandAndGetResponse<T = unknown>(deviceId: string, payload: ThinqCommandPayload): Promise<T> {
		if (!deviceId.trim()) {
			throw new Error('Invalid deviceId: must be a non-empty string.');
		}

		return this.request<T>('post', `service/devices/${deviceId}/control-sync`, {
			ctrlKey: 'basicCtrl',
			command: 'Set',
			...payload,
		});
	}

	/**
	 * Fetches the filter-life state for an AC device (`filterMngStateCtrl` `Get`). Returns
	 * `undefined` if the response contains no data (e.g. devices with no filter sensor).
	 */
	public async getFilterState(deviceId: string): Promise<Record<string, unknown> | undefined> {
		if (!deviceId.trim()) {
			throw new Error('Invalid deviceId: must be a non-empty string.');
		}

		const response = await this.sendCommandAndGetResponse<{ result?: { data?: Record<string, unknown> } }>(deviceId, {
			ctrlKey: 'filterMngStateCtrl',
			command: 'Get',
			dataGetList: [
				'airState.filterMngState.useTime',
				'airState.filterMngState.remainTime',
				'airState.filterMngState.maxTime',
				'airState.filterMngState.changeDate',
				'airState.filterMngState.type',
			],
		});

		return response.result?.data;
	}

	/**
	 * Sends a keep-alive command to an AC device to maintain MQTT push updates from LG's cloud.
	 * POSTs to `service/devices/{id}/control` (not `control-sync`) with `ctrlKey: 'allEventEnable'`
	 * to refresh the 70-second MQTT event window.
	 */
	public async sendKeepAlive(deviceId: string): Promise<void> {
		if (!deviceId.trim()) {
			throw new Error('Invalid deviceId: must be a non-empty string.');
		}

		await this.request('post', `service/devices/${deviceId}/control`, {
			ctrlKey: 'allEventEnable',
			command: 'Set',
			dataKey: 'airState.mon.timeout',
			dataValue: '70',
		});
	}

	/** Exchanges a refresh token for a new access token (`grant_type=refresh_token`), mutating and returning `session`. */
	public async refreshToken(session: ThinqSession): Promise<ThinqSession> {
		const tokenUrl = `https://${this.country.toLowerCase()}.lgeapi.com/oauth/1.0/oauth2/token`;
		const data = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
		const timestamp = formatRfc2822Utc(new Date());
		const requestUrl = `/oauth/1.0/oauth2/token?${data.toString()}`;
		const signature = signThinqMessage(`${requestUrl}\n${timestamp}`, THINQ_OAUTH_SECRET_KEY);
		const headers = {
			'x-lge-app-os': 'ADR',
			'x-lge-appkey': THINQ_CLIENT_ID,
			'x-lge-oauth-signature': signature,
			'x-lge-oauth-date': timestamp,
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
		};

		this.logger.debug(
			`ThinQ refreshToken request -> POST ${tokenUrl} headers=${JSON.stringify(maskSensitiveFields(headers))} body=${JSON.stringify(maskSensitiveFields(Object.fromEntries(data.entries())))}`,
		);

		try {
			const response = await axios.post<{ access_token: string; expires_in: string }>(tokenUrl, data.toString(), {
				headers,
			});

			session.updateAccessToken(
				response.data.access_token,
				ThinqSession.expiryFromExpiresIn(Number.parseInt(response.data.expires_in, 10)),
			);
			this.session = session;
			return session;
		} catch (error) {
			this.logger.error(`ThinQ token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
			throw new TokenExpiredError();
		}
	}

	/**
	 * Fetches the user's numeric profile ID (`userNo`) required for `x-user-no`/`x-client-id`. Port of
	 * `Auth.ts:399-422` (`getUserNumber`) — `GET {lgeapi_url}users/profile` with `Authorization: Bearer`
	 * plus the same HMAC signing primitive used by `refreshToken()`. Does not mutate client state; call
	 * `setUserNumber()` with the result to activate it on subsequent requests.
	 */
	public async getUserNumber(accessToken: string): Promise<string> {
		const profileUrl = `https://${this.country.toLowerCase()}.lgeapi.com/users/profile`;
		const timestamp = formatRfc2822Utc(new Date());
		const signature = signThinqMessage(`/users/profile\n${timestamp}`, THINQ_OAUTH_SECRET_KEY);
		const headers = {
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
			'X-Lge-Svccode': 'SVC202',
			'X-Application-Key': THINQ_APPLICATION_KEY,
			'lgemp-x-app-key': THINQ_CLIENT_ID,
			'X-Device-Type': 'M01',
			'X-Device-Platform': 'ADR',
			'x-lge-oauth-date': timestamp,
			'x-lge-oauth-signature': signature,
		};

		this.logger.debug(
			`ThinQ getUserNumber request -> GET ${profileUrl} headers=${JSON.stringify(maskSensitiveFields(headers))}`,
		);

		try {
			const response = await axios.get<{ status?: number; message?: string; account: { userNo: string } }>(profileUrl, {
				headers,
			});

			if (response.data.status === 2) {
				throw new AuthenticationError(response.data.message ?? 'LG user profile lookup failed.');
			}

			return response.data.account.userNo;
		} catch (error) {
			this.logger.error(`ThinQ getUserNumber failed: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}
	}

	/** Fetches the MQTT broker route (`GET https://common.lgthinq.com/route`), first step of MQTT cert setup. */
	public async getMqttRouteInfo(): Promise<{ mqttServer: string }> {
		const data = await this.request<{ result: { mqttServer: string } }>('get', MQTT_ROUTE_URL);
		return data.result;
	}

	/** Registers this account as an MQTT client (`POST service/users/client`), required before requesting a certificate. */
	public async registerMqttClient(): Promise<void> {
		await this.request('post', 'service/users/client', {});
	}

	/** Submits the CSR body and returns the signed client certificate + broker subscription topics. */
	public async requestMqttCertificate(csrBody: string): Promise<{ certificatePem: string; subscriptions: string[] }> {
		const data = await this.request<{ result: { certificatePem: string; subscriptions: string[] } }>(
			'post',
			'service/users/client/certificate',
			{ csr: csrBody },
		);
		return data.result;
	}

	/** Returns the per-session client id (`x-client-id`), falling back to the static default like `defaultHeaders`. */
	public getClientId(): string {
		return this.clientId ?? API_CLIENT_ID;
	}

	private get defaultHeaders(): Record<string, string> {
		const authHeaders: Record<string, string> = {};
		if (this.session.accessToken) {
			authHeaders['x-emp-token'] = this.session.accessToken;
		}
		if (this.userNumber) {
			authHeaders['x-user-no'] = this.userNumber;
		}
		authHeaders['x-client-id'] = this.clientId ?? API_CLIENT_ID;

		return {
			'x-api-key': API_KEY,
			'x-thinq-app-ver': '3.6.1200',
			'x-thinq-app-type': 'NUTS',
			'x-thinq-app-level': 'PRD',
			'x-thinq-app-os': 'ANDROID',
			'x-thinq-app-logintype': 'LGE',
			'x-service-code': 'SVC202',
			'x-country-code': this.country,
			'x-language-code': this.language,
			'x-service-phase': 'OP',
			'x-origin': 'app-native',
			'x-model-name': 'samsung/SM-G930L',
			'x-os-version': 'AOS/7.1.2',
			'x-app-version': 'LG ThinQ/3.6.12110',
			'x-message-id': randomMessageId(),
			'user-agent': 'okhttp/3.14.9',
			...authHeaders,
		};
	}

	/**
	 * True when `error` signals an expired ThinQ access token — either a real HTTP 401, or LG's own
	 * `resultCode: '0102'` expiry signal returned as HTTP 400 by some endpoints (e.g. `control-sync`).
	 * Mirrors homebridge-lg-thinq's dual check (`request.ts:80-97`).
	 */
	private isTokenExpiredError(error: unknown): boolean {
		if (!axios.isAxiosError(error)) {
			return false;
		}
		if (error.response?.status === 401) {
			return true;
		}
		const data = error.response?.data as Record<string, unknown> | undefined;
		return typeof data?.resultCode === 'string' && data.resultCode === THINQ_TOKEN_EXPIRED_RESULT_CODE;
	}

	private async request<T>(method: 'get' | 'post', uri: string, data?: unknown, retry = false): Promise<T> {
		await this.getGateway();
		const gateway = this.gateway;
		if (!gateway) {
			throw new Error('ThinQ gateway is unavailable.');
		}

		const url = new URL(uri, gateway.thinq2Url).href;
		const headers = this.defaultHeaders;
		this.logger.debug(
			`ThinQ request -> ${method.toUpperCase()} ${url} headers=${JSON.stringify(maskSensitiveFields(headers))} data=${JSON.stringify(maskSensitiveFields(data as Record<string, unknown> | undefined))}`,
		);

		try {
			const response = await axios.request<T>({ method, url, data, headers });
			return response.data;
		} catch (error) {
			if (this.isTokenExpiredError(error)) {
				if (retry) {
					throw new TokenExpiredError();
				}

				await this.refreshToken(this.session);
				return this.request<T>(method, uri, data, true);
			}

			if (axios.isAxiosError(error)) {
				this.logger.debug(
					`ThinQ request failed <- ${method.toUpperCase()} ${url} status=${error.response?.status} data=${JSON.stringify(error.response?.data)}`,
				);
			}

			throw error;
		}
	}
}
