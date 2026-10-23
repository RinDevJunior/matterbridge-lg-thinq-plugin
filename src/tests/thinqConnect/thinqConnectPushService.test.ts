import type { Mock, MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import type { ThinqConnectMqttConnector } from '../../services/thinqConnect/thinqConnectMqttConnector.js';
import type { ThinqConnectMqttCredentials } from '../../services/thinqConnect/thinqConnectMqttCredentials.js';
import {
	type ThinqConnectPushApi,
	type ThinqConnectPushHandlers,
	ThinqConnectPushService,
} from '../../thinqConnect/thinqConnectPushService.js';
import { createMockLogger } from '../helpers/testUtils.js';

const MQTT_SERVER = 'mqtts://a3x-ats.iot.us-west-2.amazonaws.com:8883';
const CLIENT_ID = 'thinq-open-6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const TOPIC = 'app/clients/TOPIC-SENTINEL/push';
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nPRIVATE-KEY-SENTINEL\n-----END PRIVATE KEY-----';
const CERT_PEM = 'CERT-PEM-SENTINEL';
const ROOT_CA_PEM = 'ROOT-CA-PEM-SENTINEL';
const CSR_BODY = 'CSR-BODY-SENTINEL';
const DEV_A = 'dev-a';
const DEV_B = 'dev-b';
const HOUR_MS = 3_600_000;

interface FakeApi {
	getRoute: Mock<ThinqConnectPushApi['getRoute']>;
	registerClient: Mock<ThinqConnectPushApi['registerClient']>;
	requestClientCertificate: Mock<ThinqConnectPushApi['requestClientCertificate']>;
	subscribeDeviceEvents: Mock<ThinqConnectPushApi['subscribeDeviceEvents']>;
	unsubscribeDeviceEvents: Mock<ThinqConnectPushApi['unsubscribeDeviceEvents']>;
	getClientId: Mock<ThinqConnectPushApi['getClientId']>;
}

/** In-memory MQTT connection: records subscribe/end, lets the test emit events. */
class FakeMqttConnection {
	public readonly subscriptions: { topic: string; options: { qos: 0 | 1 } }[] = [];
	public readonly ends: boolean[] = [];
	public subscribeError: unknown = undefined;
	private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

	public on(event: 'connect' | 'offline' | 'close' | 'reconnect', handler: () => void): this;
	public on(event: 'error', handler: (error: unknown) => void): this;
	public on(event: 'message', handler: (topic: string, payload: Buffer) => void): this;
	public on(event: string, handler: (...args: never[]) => void): this {
		const listener = handler as (...args: unknown[]) => void;
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
		return this;
	}

	public subscribe(topic: string, options: { qos: 0 | 1 }, callback: (error?: unknown) => void): void {
		this.subscriptions.push({ topic, options });
		callback(this.subscribeError);
	}

	public end(force?: boolean): void {
		this.ends.push(force === true);
	}

	public emit(event: string, ...args: unknown[]): void {
		for (const handler of this.listeners.get(event) ?? []) {
			handler(...args);
		}
	}
}

interface Harness {
	service: ThinqConnectPushService;
	api: FakeApi;
	logger: ReturnType<typeof createMockLogger>;
	handlers: {
		onDeviceEvent: Mock<ThinqConnectPushHandlers['onDeviceEvent']>;
		onHealthChange: Mock<ThinqConnectPushHandlers['onHealthChange']>;
	};
	createCredentials: Mock<() => Promise<ThinqConnectMqttCredentials>>;
	downloadRootCa: Mock<() => Promise<string>>;
	connect: Mock<ThinqConnectMqttConnector>;
	connections: FakeMqttConnection[];
}

function createApi(): FakeApi {
	return {
		getRoute: vi.fn<ThinqConnectPushApi['getRoute']>().mockResolvedValue({ mqttServer: MQTT_SERVER }),
		registerClient: vi.fn<ThinqConnectPushApi['registerClient']>().mockResolvedValue(undefined),
		requestClientCertificate: vi
			.fn<ThinqConnectPushApi['requestClientCertificate']>()
			.mockResolvedValue({ certificatePem: CERT_PEM, subscriptions: [TOPIC] }),
		subscribeDeviceEvents: vi.fn<ThinqConnectPushApi['subscribeDeviceEvents']>().mockResolvedValue(undefined),
		unsubscribeDeviceEvents: vi.fn<ThinqConnectPushApi['unsubscribeDeviceEvents']>().mockResolvedValue(undefined),
		getClientId: vi.fn<ThinqConnectPushApi['getClientId']>().mockReturnValue(CLIENT_ID),
	};
}

function createHarness(): Harness {
	const api = createApi();
	const logger = createMockLogger();
	const connections: FakeMqttConnection[] = [];
	const handlers = {
		onDeviceEvent: vi.fn<ThinqConnectPushHandlers['onDeviceEvent']>(),
		onHealthChange: vi.fn<ThinqConnectPushHandlers['onHealthChange']>(),
	};
	const createCredentials = vi
		.fn<() => Promise<ThinqConnectMqttCredentials>>()
		.mockResolvedValue({ privateKeyPem: KEY_PEM, csrBody: CSR_BODY });
	const downloadRootCa = vi.fn<() => Promise<string>>().mockResolvedValue(ROOT_CA_PEM);
	const connect = vi.fn<ThinqConnectMqttConnector>(() => {
		const connection = new FakeMqttConnection();
		connections.push(connection);
		return connection;
	});
	const service = new ThinqConnectPushService({
		api,
		logger,
		createCredentials,
		downloadRootCa,
		connect,
		random: () => 0.5,
		now: () => Date.now(),
	});
	return { service, api, logger, handlers, createCredentials, downloadRootCa, connect, connections };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i += 1) {
		await vi.advanceTimersByTimeAsync(0);
	}
}

async function advance(ms: number): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	await settle();
}

function current(harness: Harness): FakeMqttConnection {
	const connection = harness.connections.at(-1);
	if (!connection) {
		throw new Error('No MQTT connection was created.');
	}
	return connection;
}

async function startSession(harness: Harness, ids: readonly string[] = [DEV_A, DEV_B]): Promise<void> {
	harness.service.start(ids, harness.handlers);
	await settle();
}

async function connectSession(harness: Harness, ids?: readonly string[]): Promise<void> {
	await startSession(harness, ids);
	current(harness).emit('connect');
	await settle();
}

async function becomeHealthy(harness: Harness): Promise<void> {
	await connectSession(harness);
	await advance(60_000);
}

function warnings(harness: Harness): string[] {
	return vi.mocked(harness.logger.warn).mock.calls.map(([message]) => message);
}

function allLogs(harness: Harness): string {
	const { logger } = harness;
	return [logger.debug, logger.info, logger.warn, logger.error]
		.flatMap((fn) => vi.mocked(fn).mock.calls)
		.map((args) => args.map(String).join(' '))
		.join('\n');
}

function deviceStatus(
	deviceId: string,
	report: Record<string, unknown> = { operation: { airConOperationMode: 'POWER_ON' } },
): Buffer {
	return Buffer.from(JSON.stringify({ event: { pushType: 'DEVICE_STATUS', deviceId, report } }));
}

function limitFor(harness: Harness, deviceId: string, code: string): void {
	harness.api.subscribeDeviceEvents.mockImplementation(async (id) => {
		if (id === deviceId) {
			throw new ThinqConnectApiError(`code ${code}`, code);
		}
	});
}

function subscribeCallsFor(harness: Harness, deviceId: string): number {
	return harness.api.subscribeDeviceEvents.mock.calls.filter(([id]) => id === deviceId).length;
}

describe('ThinqConnectPushService', () => {
	let harness: Harness;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		harness = createHarness();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe('start', () => {
		it('should request the route, register, create credentials, request the certificate, download the root CA and connect in order', async () => {
			// Arrange & Act
			await startSession(harness);

			// Assert
			const order = [
				harness.api.getRoute,
				harness.api.registerClient,
				harness.createCredentials,
				harness.api.requestClientCertificate,
				harness.downloadRootCa,
				harness.connect,
			].map((mock) => mock.mock.invocationCallOrder[0]);
			expect(order).toEqual([...order].sort((a, b) => a - b));
			expect(harness.api.requestClientCertificate).toHaveBeenCalledWith(CSR_BODY);
			expect(harness.connect).toHaveBeenCalledWith({
				host: 'a3x-ats.iot.us-west-2.amazonaws.com',
				clientId: CLIENT_ID,
				privateKeyPem: KEY_PEM,
				certificatePem: CERT_PEM,
				rootCaPem: ROOT_CA_PEM,
			});
		});

		it('should do nothing when the device list is empty', async () => {
			// Arrange & Act
			await startSession(harness, []);

			// Assert
			expect(harness.api.getRoute).not.toHaveBeenCalled();
			expect(harness.logger.info).not.toHaveBeenCalled();
		});

		it('should ignore a second start when already started', async () => {
			// Arrange & Act
			await startSession(harness, [DEV_A]);
			await startSession(harness, [DEV_A, DEV_B]);

			// Assert
			expect(harness.api.getRoute).toHaveBeenCalledTimes(1);
			expect(harness.logger.info).toHaveBeenCalledTimes(1);
		});

		it('should log the device count when starting', async () => {
			// Arrange & Act
			await startSession(harness);

			// Assert
			expect(harness.logger.info).toHaveBeenCalledWith('ThinQ Connect push: starting for 2 device(s).');
		});
	});

	describe('connection and subscriptions', () => {
		it('should subscribe the topic at QoS 1 when the connection opens', async () => {
			// Arrange & Act
			await connectSession(harness);

			// Assert
			expect(current(harness).subscriptions).toEqual([{ topic: TOPIC, options: { qos: 1 } }]);
			expect(harness.logger.info).toHaveBeenCalledWith('ThinQ Connect push: connected to the MQTT broker.');
		});

		it('should subscribe each device for 24 hours after the topic is subscribed', async () => {
			// Arrange & Act
			await connectSession(harness);

			// Assert
			expect(harness.api.subscribeDeviceEvents).toHaveBeenCalledWith(DEV_A, 24);
			expect(harness.api.subscribeDeviceEvents).toHaveBeenCalledWith(DEV_B, 24);
		});

		it('should log the covered count when every device is subscribed', async () => {
			// Arrange & Act
			await connectSession(harness);

			// Assert
			expect(harness.logger.info).toHaveBeenCalledWith(
				'ThinQ Connect push: subscribed to events for 2 of 2 device(s).',
			);
		});

		it('should not report healthy before 60 s of continuous coverage', async () => {
			// Arrange & Act
			await connectSession(harness);
			await advance(59_999);

			// Assert
			expect(harness.handlers.onHealthChange).not.toHaveBeenCalled();
		});

		it('should report healthy once after 60 s of continuous coverage', async () => {
			// Arrange & Act
			await connectSession(harness);
			await advance(60_000);

			// Assert
			expect(harness.handlers.onHealthChange).toHaveBeenCalledTimes(1);
			expect(harness.handlers.onHealthChange).toHaveBeenCalledWith(true);
			expect(harness.logger.info).toHaveBeenCalledWith('ThinQ Connect push: healthy, safety poll in use.');
		});

		it.each(['offline', 'close'])('should report unhealthy when the connection emits %s', async (event) => {
			// Arrange
			await becomeHealthy(harness);

			// Act
			current(harness).emit(event);

			// Assert
			expect(harness.handlers.onHealthChange).toHaveBeenLastCalledWith(false);
		});

		it('should retry the topic subscription after 30 s when it fails', async () => {
			// Arrange
			await startSession(harness);
			current(harness).subscribeError = new Error('denied');

			// Act
			current(harness).emit('connect');
			await settle();
			const warned = warnings(harness).at(-1);
			current(harness).subscribeError = undefined;
			await advance(30_000);

			// Assert
			expect(warned).toBe('ThinQ Connect push: topic subscription failed (denied); retry in 30 s.');
			expect(current(harness).subscriptions).toHaveLength(2);
			expect(harness.api.subscribeDeviceEvents).toHaveBeenCalledWith(DEV_A, 24);
		});

		it('should cancel the pending topic retry when stopped', async () => {
			// Arrange
			await startSession(harness);
			current(harness).subscribeError = new Error('denied');
			current(harness).emit('connect');
			await settle();

			// Act
			await harness.service.stop();
			await advance(120_000);

			// Assert
			expect(current(harness).subscriptions).toHaveLength(1);
		});
	});

	describe('reconnect and recovery', () => {
		it('should keep the session when the connection returns within 10 minutes', async () => {
			// Arrange
			await becomeHealthy(harness);
			current(harness).emit('offline');

			// Act
			await advance(9 * 60_000);
			current(harness).emit('connect');
			await settle();
			await advance(60_000);

			// Assert
			expect(harness.api.getRoute).toHaveBeenCalledTimes(1);
			expect(current(harness).ends).toEqual([]);
			expect(harness.handlers.onHealthChange).toHaveBeenLastCalledWith(true);
		});

		it.each(['offline', 'close'])(
			'should end the connection and enroll again after 30 s when %s lasts 10 minutes',
			async (event) => {
				// Arrange
				await becomeHealthy(harness);
				current(harness).emit(event);

				// Act
				await advance(10 * 60_000);
				const endsAfterRecovery = [...current(harness).ends];
				await advance(30_000);

				// Assert
				expect(endsAfterRecovery).toEqual([true]);
				expect(harness.api.getRoute).toHaveBeenCalledTimes(2);
				expect(harness.logger.warn).toHaveBeenCalledWith(
					'ThinQ Connect push: MQTT offline for too long, enrolling again.',
				);
			},
		);

		it('should report unhealthy immediately when the connection drops after being healthy', async () => {
			// Arrange
			await becomeHealthy(harness);

			// Act
			current(harness).emit('offline');

			// Assert
			expect(harness.handlers.onHealthChange).toHaveBeenLastCalledWith(false);
		});

		it('should reset the back-off after 60 s healthy', async () => {
			// Arrange
			harness.api.getRoute.mockRejectedValueOnce(new Error('route down'));
			await startSession(harness);
			await advance(30_000);
			current(harness).emit('connect');
			await settle();
			await advance(60_000);

			// Act
			current(harness).emit('offline');
			await advance(10 * 60_000);

			// Assert
			expect(warnings(harness).at(-1)).toContain('retry in 30 s.');
		});
	});

	describe('setup failures', () => {
		it.each([
			['route', (h: Harness) => h.api.getRoute.mockRejectedValue(new Error('route down')), 'route down'],
			[
				'client certificate',
				(h: Harness) => h.api.requestClientCertificate.mockRejectedValue(new Error('cert down')),
				'cert down',
			],
			['root CA', (h: Harness) => h.downloadRootCa.mockRejectedValue(new Error('ca down')), 'ca down'],
			[
				'connect',
				(h: Harness) =>
					h.connect.mockImplementation(() => {
						throw new Error('connect down');
					}),
				'connect down',
			],
		])(
			'should log unavailable and retry with growing back-off when the %s step fails',
			async (_step, inject, message) => {
				// Arrange
				inject(harness);

				// Act
				await startSession(harness);
				const first = warnings(harness).at(-1);
				await advance(30_000);
				const second = warnings(harness).at(-1);
				await advance(60_000);
				const third = warnings(harness).at(-1);

				// Assert
				expect(first).toBe(`ThinQ Connect push: unavailable (${message}), polling stays on; retry in 30 s.`);
				expect(second).toContain('retry in 60 s.');
				expect(third).toContain('retry in 120 s.');
			},
		);

		it('should retry no sooner than 300 s when the route returns 1306', async () => {
			// Arrange
			harness.api.getRoute.mockRejectedValueOnce(new ThinqConnectApiError('quota', '1306'));

			// Act
			await startSession(harness);

			// Assert
			expect(warnings(harness).at(-1)).toContain('retry in 300 s.');
			expect(harness.api.getRoute).toHaveBeenCalledTimes(1);
		});

		it.each(['1103', '1305', '1308'])(
			'should disable push for the session with one warning when permanent code %s arrives',
			async (code) => {
				// Arrange
				harness.api.getRoute.mockRejectedValue(new ThinqConnectApiError('denied', code));

				// Act
				await startSession(harness);
				await advance(2 * HOUR_MS);

				// Assert
				const disabled = warnings(harness).filter((line) => line.includes('disabled for this session'));
				expect(disabled).toEqual(['ThinQ Connect push: disabled for this session (denied).']);
				expect(vi.getTimerCount()).toBe(0);
				expect(harness.api.getRoute).toHaveBeenCalledTimes(1);
				expect(harness.handlers.onHealthChange).not.toHaveBeenCalledWith(true);
			},
		);

		it('should disable push when a permanent code arrives while subscribing devices', async () => {
			// Arrange
			harness.api.subscribeDeviceEvents.mockRejectedValue(new ThinqConnectApiError('denied', '1305'));

			// Act
			await connectSession(harness);
			await advance(2 * HOUR_MS);

			// Assert
			expect(warnings(harness).filter((line) => line.includes('disabled for this session'))).toHaveLength(1);
			expect(vi.getTimerCount()).toBe(0);
			expect(harness.api.subscribeDeviceEvents).toHaveBeenCalledTimes(1);
		});
	});

	describe('per-device limits', () => {
		it('should mark the device polling-only and warn once when the 1312 subscription limit is reached', async () => {
			// Arrange
			limitFor(harness, DEV_B, '1312');

			// Act
			await connectSession(harness);
			await advance(60_000);

			// Assert
			expect(warnings(harness).filter((line) => line.includes('(1312)'))).toEqual([
				`ThinQ Connect push: event subscription limit reached (1312) for ${DEV_B}; it stays on polling.`,
			]);
			expect(harness.logger.info).toHaveBeenCalledWith(
				'ThinQ Connect push: subscribed to events for 1 of 2 device(s).',
			);
		});

		it('should not report healthy while a device is uncovered', async () => {
			// Arrange
			limitFor(harness, DEV_B, '1312');

			// Act
			await connectSession(harness);
			await advance(5 * 60_000);

			// Assert
			expect(harness.handlers.onHealthChange).not.toHaveBeenCalledWith(true);
		});

		it('should retry the 1312 device only at the 6 h mark', async () => {
			// Arrange
			limitFor(harness, DEV_B, '1312');
			await connectSession(harness);

			// Act
			await advance(6 * HOUR_MS - 60_000);
			const beforeRetry = subscribeCallsFor(harness, DEV_B);
			await advance(60_000);

			// Assert
			expect(beforeRetry).toBe(1);
			expect(subscribeCallsFor(harness, DEV_B)).toBe(2);
		});

		it('should never retry a device refused with 1214', async () => {
			// Arrange
			limitFor(harness, DEV_B, '1214');
			await connectSession(harness);

			// Act
			await advance(13 * HOUR_MS);

			// Assert
			expect(subscribeCallsFor(harness, DEV_B)).toBe(1);
			expect(warnings(harness)).toContain(
				`ThinQ Connect push: ${DEV_B} does not support events (code 1214); it stays on polling.`,
			);
		});
	});

	describe('renewal', () => {
		it('should not renew subscriptions before 12 h remain', async () => {
			// Arrange
			await connectSession(harness);

			// Act
			for (let hour = 0; hour < 12; hour += 1) {
				await advance(HOUR_MS);
			}

			// Assert
			expect(harness.api.subscribeDeviceEvents).toHaveBeenCalledTimes(2);
			expect(harness.logger.info).not.toHaveBeenCalledWith(expect.stringContaining('renewed'));
		});

		it('should renew every device and log renewed when less than 12 h remain', async () => {
			// Arrange
			await connectSession(harness);

			// Act
			await advance(13 * HOUR_MS);

			// Assert
			expect(harness.api.subscribeDeviceEvents).toHaveBeenCalledTimes(4);
			expect(harness.logger.info).toHaveBeenCalledWith(
				'ThinQ Connect push: renewed event subscriptions for 2 device(s).',
			);
		});

		it('should retry a failed renewal after the back-off instead of waiting for the next tick', async () => {
			// Arrange
			await connectSession(harness);
			harness.api.subscribeDeviceEvents.mockRejectedValueOnce(new Error('blip'));

			// Act
			await advance(13 * HOUR_MS);
			const failedRenewal = warnings(harness).at(-1);
			await advance(30_000);

			// Assert
			expect(failedRenewal).toBe('ThinQ Connect push: unavailable (blip), polling stays on; retry in 30 s.');
			expect(harness.logger.info).toHaveBeenCalledWith(
				'ThinQ Connect push: renewed event subscriptions for 2 device(s).',
			);
		});

		it('should skip the hourly renewal pass while a retry timer is pending', async () => {
			// Arrange
			await connectSession(harness);
			harness.api.subscribeDeviceEvents.mockImplementation(async (id) => {
				if (id === DEV_A && harness.api.subscribeDeviceEvents.mock.calls.length > 2) {
					throw new Error('blip');
				}
			});
			await advance(13 * HOUR_MS);
			await advance(HOUR_MS - 1_000);
			const beforeTick = harness.api.subscribeDeviceEvents.mock.calls.length;

			// Act
			await advance(1_000);

			// Assert
			expect(harness.api.subscribeDeviceEvents.mock.calls.length).toBe(beforeTick);
		});
	});

	describe('device events', () => {
		it('should call onDeviceEvent once after the 1 s window for a DEVICE_STATUS of a known device', async () => {
			// Arrange
			await connectSession(harness);

			// Act
			current(harness).emit('message', TOPIC, deviceStatus(DEV_A));
			await advance(999);
			const beforeWindow = harness.handlers.onDeviceEvent.mock.calls.length;
			await advance(1);

			// Assert
			expect(beforeWindow).toBe(0);
			expect(harness.handlers.onDeviceEvent).toHaveBeenCalledTimes(1);
			expect(harness.handlers.onDeviceEvent).toHaveBeenCalledWith(DEV_A);
		});

		it('should coalesce five events inside the window into one call', async () => {
			// Arrange
			await connectSession(harness);

			// Act
			for (let i = 0; i < 5; i += 1) {
				current(harness).emit('message', TOPIC, deviceStatus(DEV_A));
			}
			await advance(1_000);

			// Assert
			expect(harness.handlers.onDeviceEvent).toHaveBeenCalledTimes(1);
		});

		it('should coalesce each device separately', async () => {
			// Arrange
			await connectSession(harness);

			// Act
			current(harness).emit('message', TOPIC, deviceStatus(DEV_A));
			current(harness).emit('message', TOPIC, deviceStatus(DEV_B));
			await advance(1_000);

			// Assert
			expect(harness.handlers.onDeviceEvent).toHaveBeenCalledWith(DEV_A);
			expect(harness.handlers.onDeviceEvent).toHaveBeenCalledWith(DEV_B);
			expect(harness.handlers.onDeviceEvent).toHaveBeenCalledTimes(2);
		});

		it('should log the push type and changed key names only', async () => {
			// Arrange
			await connectSession(harness);

			// Act
			current(harness).emit('message', TOPIC, deviceStatus(DEV_A, { operation: { airConOperationMode: 'POWER_ON' } }));

			// Assert
			expect(harness.logger.debug).toHaveBeenCalledWith(
				`ThinQ Connect push: event DEVICE_STATUS for ${DEV_A} (changed: operation)`,
			);
			expect(allLogs(harness)).not.toContain('POWER_ON');
		});

		it.each([
			['an unknown device', JSON.stringify({ event: { pushType: 'DEVICE_STATUS', deviceId: 'dev-x', report: {} } })],
			['another push type', JSON.stringify({ event: { pushType: 'DEVICE_PUSH', deviceId: DEV_A, report: {} } })],
			['a push envelope', JSON.stringify({ push: { pushType: 'DEVICE_STATUS', deviceId: DEV_A } })],
			['malformed JSON', '{not json'],
			['a null payload', 'null'],
		])('should ignore %s without calling onDeviceEvent', async (_label, body) => {
			// Arrange
			await connectSession(harness);

			// Act
			current(harness).emit('message', TOPIC, Buffer.from(body));
			await advance(2_000);

			// Assert
			expect(harness.handlers.onDeviceEvent).not.toHaveBeenCalled();
		});
	});

	describe('stop', () => {
		it('should clear every timer synchronously and leave only the unsubscribe cap until it settles', async () => {
			// Arrange
			await becomeHealthy(harness);
			const before = vi.getTimerCount();

			// Act
			const stopping = harness.service.stop();
			const afterSyncStop = vi.getTimerCount();
			await stopping;

			// Assert
			expect(before).toBeGreaterThan(0);
			expect(afterSyncStop).toBe(1);
			expect(vi.getTimerCount()).toBe(0);
		});

		it('should end the connection with force when stopped', async () => {
			// Arrange
			await becomeHealthy(harness);

			// Act
			await harness.service.stop();

			// Assert
			expect(current(harness).ends).toEqual([true]);
		});

		it('should unsubscribe every subscribed device when stopped', async () => {
			// Arrange
			await becomeHealthy(harness);

			// Act
			await harness.service.stop();

			// Assert
			expect(harness.api.unsubscribeDeviceEvents).toHaveBeenCalledWith(DEV_A);
			expect(harness.api.unsubscribeDeviceEvents).toHaveBeenCalledWith(DEV_B);
		});

		it('should resolve within 5 s when an unsubscribe never settles', async () => {
			// Arrange
			harness.api.unsubscribeDeviceEvents.mockReturnValue(new Promise<void>(() => undefined));
			await becomeHealthy(harness);
			let finished = false;

			// Act
			const stopping = harness.service.stop().then(() => {
				finished = true;
			});
			await advance(4_999);
			const beforeCap = finished;
			await advance(1);
			await stopping;

			// Assert
			expect(beforeCap).toBe(false);
			expect(finished).toBe(true);
		});

		it('should be a no-op when stop is called a second time', async () => {
			// Arrange
			await becomeHealthy(harness);

			// Act
			await harness.service.stop();
			await harness.service.stop();

			// Assert
			expect(harness.api.unsubscribeDeviceEvents).toHaveBeenCalledTimes(2);
			expect(current(harness).ends).toEqual([true]);
		});

		it('should not schedule a reconnect when the connection drops after stop', async () => {
			// Arrange
			await becomeHealthy(harness);
			await harness.service.stop();

			// Act
			current(harness).emit('offline');
			await advance(HOUR_MS);

			// Assert
			expect(vi.getTimerCount()).toBe(0);
			expect(harness.api.getRoute).toHaveBeenCalledTimes(1);
		});

		it('should not leak a connection when stopped while the route lookup is pending', async () => {
			// Arrange
			const route = deferred<{ mqttServer: string }>();
			harness.api.getRoute.mockReturnValueOnce(route.promise);
			await startSession(harness, [DEV_A]);
			await harness.service.stop();

			// Act
			route.resolve({ mqttServer: MQTT_SERVER });
			await settle();

			// Assert
			expect(harness.connect).not.toHaveBeenCalled();
			expect(harness.api.registerClient).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		});

		it('should drop a debounced device event when stopped', async () => {
			// Arrange
			await connectSession(harness);
			current(harness).emit('message', TOPIC, deviceStatus(DEV_A));

			// Act
			await harness.service.stop();
			await advance(2_000);

			// Assert
			expect(harness.handlers.onDeviceEvent).not.toHaveBeenCalled();
		});
	});

	describe('timers', () => {
		it('should call unref on every timer it creates', async () => {
			// Arrange
			const realSetTimeout = globalThis.setTimeout;
			const unrefSpies: MockInstance[] = [];
			const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
				const timer = realSetTimeout(callback, delay);
				unrefSpies.push(vi.spyOn(timer, 'unref'));
				return timer;
			}) as typeof setTimeout);

			// Act
			await becomeHealthy(harness);
			current(harness).emit('message', TOPIC, deviceStatus(DEV_A));
			await advance(1_000);
			await harness.service.stop();
			spy.mockRestore();

			// Assert
			expect(unrefSpies.length).toBeGreaterThanOrEqual(3);
			for (const unrefSpy of unrefSpies) {
				expect(unrefSpy).toHaveBeenCalled();
			}
		});
	});

	describe('secret hygiene', () => {
		it('should never log the key, certificate, root CA, CSR, topic or full client id, and log only the masked id', async () => {
			// Arrange
			await becomeHealthy(harness);
			current(harness).emit('message', TOPIC, deviceStatus(DEV_A));
			await advance(1_000);

			// Act
			await harness.service.stop();
			const logged = allLogs(harness);

			// Assert
			for (const secret of [KEY_PEM, 'PRIVATE-KEY-SENTINEL', CERT_PEM, ROOT_CA_PEM, CSR_BODY, TOPIC, CLIENT_ID]) {
				expect(logged).not.toContain(secret);
			}
			expect(logged).toContain(`client id ...${CLIENT_ID.slice(-4)}`);
		});
	});
});
