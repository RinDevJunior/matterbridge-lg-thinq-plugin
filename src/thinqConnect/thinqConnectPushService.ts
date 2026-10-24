import type { AnsiLogger } from 'matterbridge/logger';

import type { ThinqConnectApiClient } from '../services/thinqConnect/thinqConnectApiClient.js';
import {
	connectThinqConnectMqtt,
	type ThinqConnectMqttConnection,
	type ThinqConnectMqttConnector,
} from '../services/thinqConnect/thinqConnectMqttConnector.js';
import {
	createThinqConnectMqttCredentials,
	downloadThinqConnectRootCa,
	type ThinqConnectMqttCredentials,
} from '../services/thinqConnect/thinqConnectMqttCredentials.js';
import {
	classifyThinqConnectPushError,
	computeThinqConnectPushBackoffMs,
	parseThinqConnectEventMessage,
	parseThinqConnectMqttHost,
	THINQ_CONNECT_EVENT_DEBOUNCE_MS,
	THINQ_CONNECT_EVENT_EXPIRE_HOURS,
	THINQ_CONNECT_EVENT_LIMIT_RETRY_MS,
	THINQ_CONNECT_EVENT_MAINTENANCE_MS,
	THINQ_CONNECT_EVENT_RENEW_BEFORE_MS,
	THINQ_CONNECT_PUSH_RECOVERY_MS,
	THINQ_CONNECT_PUSH_STABLE_MS,
	THINQ_CONNECT_PUSH_UNSUBSCRIBE_TIMEOUT_MS,
	type ThinqConnectPushErrorKind,
} from '../services/thinqConnect/thinqConnectPush.js';
import { maskClientId } from './thinqConnectClientId.js';

export type ThinqConnectPushApi = Pick<
	ThinqConnectApiClient,
	| 'getRoute'
	| 'registerClient'
	| 'requestClientCertificate'
	| 'subscribeDeviceEvents'
	| 'unsubscribeDeviceEvents'
	| 'getClientId'
>;

export interface ThinqConnectPushHandlers {
	onDeviceEvent(deviceId: string): void;
	onHealthChange(healthy: boolean): void;
}

export interface ThinqConnectPushDependencies {
	api: ThinqConnectPushApi;
	logger: AnsiLogger;
	createCredentials?: () => Promise<ThinqConnectMqttCredentials>;
	downloadRootCa?: () => Promise<string>;
	connect?: ThinqConnectMqttConnector;
	random?: () => number;
	now?: () => number;
}

interface DeviceSubscription {
	status: 'pending' | 'subscribed' | 'polling-only';
	expiresAt: number;
	retryAt: number | undefined;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Receives ThinQ Connect device events over MQTT. Events only trigger a refresh; failures never affect polling. */
export class ThinqConnectPushService {
	private readonly api: ThinqConnectPushApi;
	private readonly logger: AnsiLogger;
	private readonly createCredentials: () => Promise<ThinqConnectMqttCredentials>;
	private readonly downloadRootCa: () => Promise<string>;
	private readonly connect: ThinqConnectMqttConnector;
	private readonly random: () => number;
	private readonly now: () => number;

	private readonly devices = new Map<string, DeviceSubscription>();
	private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
	private handlers: ThinqConnectPushHandlers | undefined;
	private connection: ThinqConnectMqttConnection | undefined;
	private generation = 0;
	private started = false;
	private stopped = false;
	private disabled = false;
	private connected = false;
	private healthy = false;
	private attempt = 0;
	private sessionTimer: NodeJS.Timeout | undefined;
	private recoveryTimer: NodeJS.Timeout | undefined;
	private stableTimer: NodeJS.Timeout | undefined;
	private maintenanceTimer: NodeJS.Timeout | undefined;
	private subscribeRetryTimer: NodeJS.Timeout | undefined;
	private topicRetryTimer: NodeJS.Timeout | undefined;
	private subscribeRunning = false;
	private stopPromise: Promise<void> | undefined;

	constructor(deps: ThinqConnectPushDependencies) {
		this.api = deps.api;
		this.logger = deps.logger;
		this.createCredentials = deps.createCredentials ?? createThinqConnectMqttCredentials;
		this.downloadRootCa = deps.downloadRootCa ?? downloadThinqConnectRootCa;
		this.connect = deps.connect ?? connectThinqConnectMqtt;
		this.random = deps.random ?? Math.random;
		this.now = deps.now ?? Date.now;
	}

	/** Non-blocking; never throws. */
	public start(deviceIds: readonly string[], handlers: ThinqConnectPushHandlers): void {
		if (this.started || this.stopped || deviceIds.length === 0) {
			return;
		}
		this.started = true;
		this.handlers = handlers;
		for (const id of deviceIds) {
			this.devices.set(id, { status: 'pending', expiresAt: 0, retryAt: undefined });
		}
		this.logger.info(`ThinQ Connect push: starting for ${this.devices.size} device(s).`);
		this.logger.debug(`ThinQ Connect push: client id ${maskClientId(this.api.getClientId())}`);
		void this.runSession();
	}

	public stop(): Promise<void> {
		this.stopPromise ??= this.doStop();
		return this.stopPromise;
	}

	public isHealthy(): boolean {
		return this.healthy;
	}

	private async doStop(): Promise<void> {
		this.stopped = true;
		this.generation += 1;
		this.clearTimers();
		const subscribed = [...this.devices].filter(([, entry]) => entry.status === 'subscribed').map(([id]) => id);
		this.endConnection(true);
		this.setHealthy(false, false);
		if (subscribed.length === 0) {
			return;
		}
		let capTimer: NodeJS.Timeout | undefined;
		const cap = new Promise<void>((resolve) => {
			capTimer = setTimeout(resolve, THINQ_CONNECT_PUSH_UNSUBSCRIBE_TIMEOUT_MS);
			capTimer.unref?.();
		});
		const unsubscribeAll = Promise.allSettled(subscribed.map((id) => this.api.unsubscribeDeviceEvents(id))).then(
			() => undefined,
		);
		await Promise.race([unsubscribeAll, cap]);
		clearTimeout(capTimer);
	}

	private clearTimers(): void {
		for (const timer of [
			this.sessionTimer,
			this.recoveryTimer,
			this.stableTimer,
			this.maintenanceTimer,
			this.subscribeRetryTimer,
			this.topicRetryTimer,
			...this.debounceTimers.values(),
		]) {
			clearTimeout(timer);
		}
		this.sessionTimer = undefined;
		this.recoveryTimer = undefined;
		this.stableTimer = undefined;
		this.maintenanceTimer = undefined;
		this.subscribeRetryTimer = undefined;
		this.topicRetryTimer = undefined;
		this.debounceTimers.clear();
	}

	private endConnection(force: boolean): void {
		const { connection } = this;
		this.connection = undefined;
		this.connected = false;
		if (!connection) {
			return;
		}
		try {
			connection.end(force);
		} catch {
			// best effort: the connection is being discarded
		}
	}

	private isActive(generation: number): boolean {
		return !this.stopped && !this.disabled && generation === this.generation;
	}

	private async runSession(): Promise<void> {
		this.generation += 1;
		const generation = this.generation;
		this.sessionTimer = undefined;
		try {
			const { mqttServer } = await this.api.getRoute();
			const host = parseThinqConnectMqttHost(mqttServer);
			if (!this.isActive(generation)) {
				return;
			}
			await this.api.registerClient();
			const credentials = await this.createCredentials();
			const { certificatePem, subscriptions } = await this.api.requestClientCertificate(credentials.csrBody);
			const rootCaPem = await this.downloadRootCa();
			if (!this.isActive(generation)) {
				return;
			}
			const connection = this.connect({
				host,
				clientId: this.api.getClientId(),
				privateKeyPem: credentials.privateKeyPem,
				certificatePem,
				rootCaPem,
			});
			this.connection = connection;
			this.attachConnection(connection, subscriptions[0] ?? '', generation);
		} catch (error) {
			this.handleFailure(error, generation);
		}
	}

	private attachConnection(connection: ThinqConnectMqttConnection, topic: string, generation: number): void {
		let subscribedTopic = false;
		const subscribeTopic = (): void => {
			connection.subscribe(topic, { qos: 1 }, (error) => {
				if (!this.isActive(generation)) {
					return;
				}
				if (error) {
					subscribedTopic = false;
					const delay = computeThinqConnectPushBackoffMs(this.attempt, this.random);
					this.attempt += 1;
					this.logger.warn(
						`ThinQ Connect push: topic subscription failed (${errorMessage(error)}); retry in ${Math.round(delay / 1000)} s.`,
					);
					this.topicRetryTimer = setTimeout(() => {
						this.topicRetryTimer = undefined;
						if (this.isActive(generation) && this.connected && !subscribedTopic) {
							subscribedTopic = true;
							subscribeTopic();
						}
					}, delay);
					this.topicRetryTimer.unref?.();
					return;
				}
				void this.subscribeDevices(generation);
			});
		};
		connection.on('connect', () => {
			if (!this.isActive(generation)) {
				return;
			}
			this.connected = true;
			clearTimeout(this.recoveryTimer);
			this.recoveryTimer = undefined;
			this.logger.info('ThinQ Connect push: connected to the MQTT broker.');
			if (subscribedTopic) {
				this.updateHealth();
				return;
			}
			subscribedTopic = true;
			subscribeTopic();
		});
		const onDown = (): void => {
			if (!this.isActive(generation)) {
				return;
			}
			this.connected = false;
			this.updateHealth();
			if (!this.recoveryTimer) {
				this.recoveryTimer = setTimeout(() => this.recover(generation), THINQ_CONNECT_PUSH_RECOVERY_MS);
				this.recoveryTimer.unref?.();
			}
		};
		connection.on('offline', onDown);
		connection.on('close', onDown);
		connection.on('error', (error) => {
			if (this.isActive(generation)) {
				this.logger.debug(`ThinQ Connect push: MQTT error (${errorMessage(error)}).`);
			}
		});
		connection.on('message', (_topic, payload) => {
			if (this.isActive(generation)) {
				this.handleMessage(payload);
			}
		});
	}

	private handleMessage(payload: Buffer): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload.toString('utf8'));
		} catch {
			return;
		}
		const event = parseThinqConnectEventMessage(parsed);
		if (!event || event.pushType !== 'DEVICE_STATUS' || !this.devices.has(event.deviceId)) {
			return;
		}
		this.logger.debug(
			`ThinQ Connect push: event ${event.pushType} for ${event.deviceId} (changed: ${event.reportKeys.join(', ')})`,
		);
		if (this.debounceTimers.has(event.deviceId)) {
			return;
		}
		const timer = setTimeout(() => {
			this.debounceTimers.delete(event.deviceId);
			this.handlers?.onDeviceEvent(event.deviceId);
		}, THINQ_CONNECT_EVENT_DEBOUNCE_MS);
		timer.unref?.();
		this.debounceTimers.set(event.deviceId, timer);
	}

	private recover(generation: number): void {
		this.recoveryTimer = undefined;
		if (!this.isActive(generation)) {
			return;
		}
		this.logger.warn('ThinQ Connect push: MQTT offline for too long, enrolling again.');
		this.teardownSession();
		this.scheduleSession('transient', 'connection lost');
	}

	private teardownSession(): void {
		this.generation += 1;
		this.endConnection(true);
		clearTimeout(this.recoveryTimer);
		clearTimeout(this.maintenanceTimer);
		clearTimeout(this.subscribeRetryTimer);
		clearTimeout(this.topicRetryTimer);
		this.topicRetryTimer = undefined;
		this.recoveryTimer = undefined;
		this.maintenanceTimer = undefined;
		this.subscribeRetryTimer = undefined;
		for (const entry of this.devices.values()) {
			if (entry.status === 'subscribed') {
				entry.status = 'pending';
			}
		}
		this.updateHealth();
	}

	private handleFailure(error: unknown, generation: number): void {
		if (!this.isActive(generation)) {
			return;
		}
		const kind = classifyThinqConnectPushError(error);
		if (kind === 'permanent') {
			this.disable(errorMessage(error));
			return;
		}
		this.teardownSession();
		this.scheduleSession(kind, errorMessage(error));
	}

	private scheduleSession(kind: ThinqConnectPushErrorKind, message: string): void {
		const delay = computeThinqConnectPushBackoffMs(this.attempt, this.random, kind);
		this.attempt += 1;
		this.logger.warn(
			`ThinQ Connect push: unavailable (${message}), polling stays on; retry in ${Math.round(delay / 1000)} s.`,
		);
		this.sessionTimer = setTimeout(() => void this.runSession(), delay);
		this.sessionTimer.unref?.();
	}

	private disable(message: string): void {
		this.disabled = true;
		this.logger.warn(`ThinQ Connect push: disabled for this session (${message}).`);
		this.clearTimers();
		this.generation += 1;
		this.endConnection(true);
		this.setHealthy(false);
	}

	private async subscribeDevices(generation: number): Promise<void> {
		if (this.subscribeRunning || !this.isActive(generation)) {
			return;
		}
		this.subscribeRunning = true;
		let fresh = 0;
		let renewed = 0;
		try {
			for (const [id, entry] of this.devices) {
				if (!this.needsSubscribe(entry)) {
					continue;
				}
				const wasSubscribed = entry.status === 'subscribed';
				const ok = await this.subscribeOne(id, entry, generation);
				if (!this.isActive(generation)) {
					return;
				}
				if (ok === 'stop') {
					return;
				}
				if (ok === 'done') {
					if (wasSubscribed) {
						renewed += 1;
					} else {
						fresh += 1;
					}
				}
			}
		} finally {
			this.subscribeRunning = false;
		}
		this.logSubscribed(fresh, renewed);
		this.maintenanceTimer ??= this.scheduleMaintenance(generation);
		this.updateHealth();
	}

	private logSubscribed(fresh: number, renewed: number): void {
		if (fresh > 0) {
			const covered = [...this.devices.values()].filter((entry) => entry.status === 'subscribed').length;
			this.logger.info(`ThinQ Connect push: subscribed to events for ${covered} of ${this.devices.size} device(s).`);
		}
		if (renewed > 0) {
			this.logger.info(`ThinQ Connect push: renewed event subscriptions for ${renewed} device(s).`);
		}
	}

	private needsSubscribe(entry: DeviceSubscription): boolean {
		const now = this.now();
		switch (entry.status) {
			case 'pending':
				return true;
			case 'subscribed':
				return entry.expiresAt - now < THINQ_CONNECT_EVENT_RENEW_BEFORE_MS;
			case 'polling-only':
				return entry.retryAt !== undefined && entry.retryAt <= now;
		}
	}

	/** 'done' = subscribed, 'skip' = this device stays on polling, 'stop' = the pass was aborted (retry scheduled). */
	private async subscribeOne(
		id: string,
		entry: DeviceSubscription,
		generation: number,
	): Promise<'done' | 'skip' | 'stop'> {
		try {
			await this.api.subscribeDeviceEvents(id, THINQ_CONNECT_EVENT_EXPIRE_HOURS);
			entry.status = 'subscribed';
			entry.expiresAt = this.now() + THINQ_CONNECT_EVENT_EXPIRE_HOURS * 3_600_000;
			entry.retryAt = undefined;
			return 'done';
		} catch (error) {
			if (!this.isActive(generation)) {
				return 'stop';
			}
			return this.handleSubscribeError(id, entry, error, generation);
		}
	}

	private handleSubscribeError(
		id: string,
		entry: DeviceSubscription,
		error: unknown,
		generation: number,
	): 'skip' | 'stop' {
		const kind = classifyThinqConnectPushError(error);
		if (kind === 'subscription-limit' || kind === 'device-unsupported') {
			const firstTime = entry.status !== 'polling-only';
			entry.status = 'polling-only';
			entry.retryAt = kind === 'subscription-limit' ? this.now() + THINQ_CONNECT_EVENT_LIMIT_RETRY_MS : undefined;
			if (firstTime) {
				this.logger.warn(
					kind === 'subscription-limit'
						? `ThinQ Connect push: event subscription limit reached (1312) for ${id}; it stays on polling.`
						: `ThinQ Connect push: ${id} does not support events (${errorMessage(error)}); it stays on polling.`,
				);
			}
			return 'skip';
		}
		if (kind === 'permanent') {
			this.disable(errorMessage(error));
			return 'stop';
		}
		this.updateHealth();
		const delay = computeThinqConnectPushBackoffMs(this.attempt, this.random, kind);
		this.attempt += 1;
		this.logger.warn(
			`ThinQ Connect push: unavailable (${errorMessage(error)}), polling stays on; retry in ${Math.round(delay / 1000)} s.`,
		);
		this.subscribeRetryTimer = setTimeout(() => {
			this.subscribeRetryTimer = undefined;
			void this.subscribeDevices(generation);
		}, delay);
		this.subscribeRetryTimer.unref?.();
		return 'stop';
	}

	private scheduleMaintenance(generation: number): NodeJS.Timeout {
		const timer = setTimeout(() => {
			this.maintenanceTimer = undefined;
			if (!this.isActive(generation)) {
				return;
			}
			if (this.connected && !this.subscribeRetryTimer) {
				void this.subscribeDevices(generation).finally(() => {
					this.maintenanceTimer ??= this.isActive(generation) ? this.scheduleMaintenance(generation) : undefined;
				});
			} else {
				this.maintenanceTimer = this.scheduleMaintenance(generation);
			}
			this.updateHealth();
		}, THINQ_CONNECT_EVENT_MAINTENANCE_MS);
		timer.unref?.();
		return timer;
	}

	private isCovered(): boolean {
		if (!this.connected) {
			return false;
		}
		const now = this.now();
		return [...this.devices.values()].every((entry) => entry.status === 'subscribed' && entry.expiresAt > now);
	}

	private updateHealth(): void {
		if (this.stopped || this.disabled) {
			return;
		}
		if (!this.isCovered()) {
			clearTimeout(this.stableTimer);
			this.stableTimer = undefined;
			this.setHealthy(false);
			return;
		}
		if (this.healthy || this.stableTimer) {
			return;
		}
		this.stableTimer = setTimeout(() => {
			this.stableTimer = undefined;
			if (!this.isCovered()) {
				return;
			}
			this.attempt = 0;
			this.logger.info('ThinQ Connect push: healthy, safety poll in use.');
			this.setHealthy(true);
		}, THINQ_CONNECT_PUSH_STABLE_MS);
		this.stableTimer.unref?.();
	}

	private setHealthy(healthy: boolean, notify = true): void {
		if (this.healthy === healthy) {
			return;
		}
		this.healthy = healthy;
		if (notify) {
			this.handlers?.onHealthChange(healthy);
		}
	}
}
