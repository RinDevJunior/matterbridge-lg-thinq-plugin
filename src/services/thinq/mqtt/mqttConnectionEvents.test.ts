import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asPartial, createMockLogger } from '../../../tests/helpers/testUtils.js';
import {
	MQTT_OFFLINE_RECONNECT_DELAY_MS,
	MqttRuntimeDevice,
	MqttRuntimeLogger,
	wireMqttDeviceEvents,
} from './mqttConnectionEvents.js';

describe('mqttConnectionEvents', () => {
	let mockDevice: MqttRuntimeDevice;
	let mockLogger: MqttRuntimeLogger;
	let deviceHandlers: Map<string, unknown[]>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		deviceHandlers = new Map();
		mockLogger = createMockLogger();
		mockDevice = asPartial<MqttRuntimeDevice>({
			on: vi.fn((event: string, handler: unknown) => {
				if (!deviceHandlers.has(event)) {
					deviceHandlers.set(event, []);
				}
				deviceHandlers.get(event)?.push(handler);
			}),
			subscribe: vi.fn(),
			end: vi.fn(),
		});
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('wireMqttDeviceEvents', () => {
		it('should subscribe to all topics on connect event', () => {
			const subscriptions = [
				'$aws/things/device1/shadow/update/accepted',
				'$aws/things/device1/shadow/update/rejected',
			];
			const onMessage = vi.fn();
			const reconnect = vi.fn();

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions,
				onMessage,
				reconnect,
			});

			const connectHandlers = deviceHandlers.get('connect') as (() => void)[];
			expect(connectHandlers).toBeDefined();
			connectHandlers[0]();

			expect(mockDevice.subscribe).toHaveBeenCalledWith(subscriptions[0]);
			expect(mockDevice.subscribe).toHaveBeenCalledWith(subscriptions[1]);
			expect(mockDevice.subscribe).toHaveBeenCalledTimes(2);
		});

		it('should log info and debug on connect', () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn();

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const connectHandlers = deviceHandlers.get('connect') as (() => void)[];
			connectHandlers[0]();

			expect(mockLogger.info).toHaveBeenCalledWith('Successfully connected to the MQTT server.');
			expect(mockLogger.debug).toHaveBeenCalledWith('mqtt connected:', 'mqtt.example.com');
		});

		it('should log error on error event', () => {
			const error = new Error('Connection failed');
			const onMessage = vi.fn();
			const reconnect = vi.fn();

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const errorHandlers = deviceHandlers.get('error') as ((err: unknown) => void)[];
			errorHandlers[0](error);

			expect(mockLogger.error).toHaveBeenCalledWith('mqtt err:', error);
		});

		it('should parse valid JSON payload and call onMessage', () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn();
			const payload = Buffer.from(JSON.stringify({ deviceId: 'device-1', data: { state: { reported: {} } } }));

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const messageHandlers = deviceHandlers.get('message') as ((topic: string, payload: Buffer) => void)[];
			messageHandlers[0]('topic/test', payload);

			expect(onMessage).toHaveBeenCalledWith({ deviceId: 'device-1', data: { state: { reported: {} } } });
			expect(mockLogger.debug).toHaveBeenCalledWith('mqtt message received:', payload.toString());
		});

		it('should log error and debug when JSON parse fails', () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn();
			const invalidJson = Buffer.from('not valid json');

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const messageHandlers = deviceHandlers.get('message') as ((topic: string, payload: Buffer) => void)[];
			messageHandlers[0]('topic/test', invalidJson);

			expect(mockLogger.error).toHaveBeenCalledWith('mqtt message parse error:', expect.any(Error));
			expect(mockLogger.debug).toHaveBeenCalledWith('mqtt invalid message received:', 'not valid json');
			expect(onMessage).not.toHaveBeenCalled();
		});

		it('should not call onMessage when JSON payload is invalid', () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn();

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const messageHandlers = deviceHandlers.get('message') as ((topic: string, payload: Buffer) => void)[];
			messageHandlers[0]('topic/test', Buffer.from('{invalid json}'));

			expect(onMessage).not.toHaveBeenCalled();
		});

		it('should end device connection, log, and schedule reconnect on offline', async () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn().mockResolvedValue(undefined);

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const offlineHandlers = deviceHandlers.get('offline') as (() => void)[];
			offlineHandlers[0]();

			expect(mockDevice.end).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith('MQTT disconnected, retrying in 60 seconds!');

			// Advance timer to trigger reconnect
			await vi.advanceTimersByTimeAsync(MQTT_OFFLINE_RECONNECT_DELAY_MS);

			expect(reconnect).toHaveBeenCalled();
		});

		it('should log error when reconnect fails', async () => {
			const onMessage = vi.fn();
			const reconnectError = new Error('Reconnect failed');
			const reconnect = vi.fn().mockRejectedValue(reconnectError);

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
			});

			const offlineHandlers = deviceHandlers.get('offline') as (() => void)[];
			offlineHandlers[0]();

			await vi.advanceTimersByTimeAsync(MQTT_OFFLINE_RECONNECT_DELAY_MS);

			expect(mockLogger.error).toHaveBeenCalledWith('mqtt reconnect failed:', reconnectError);
		});

		it('should use custom scheduleReconnect when provided', async () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn().mockResolvedValue(undefined);
			const customScheduleReconnect = vi.fn();

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
				scheduleReconnect: customScheduleReconnect,
			});

			const offlineHandlers = deviceHandlers.get('offline') as (() => void)[];
			offlineHandlers[0]();

			expect(customScheduleReconnect).toHaveBeenCalledWith(expect.any(Function), MQTT_OFFLINE_RECONNECT_DELAY_MS);
		});

		it('should call custom scheduleReconnect with the correct handler and delay', async () => {
			const onMessage = vi.fn();
			const reconnect = vi.fn().mockResolvedValue(undefined);
			let capturedHandler: (() => Promise<void> | void) | undefined;
			const customScheduleReconnect = vi.fn((handler) => {
				capturedHandler = handler;
			});

			wireMqttDeviceEvents({
				device: mockDevice,
				logger: mockLogger,
				mqttServer: 'mqtt.example.com',
				subscriptions: [],
				onMessage,
				reconnect,
				scheduleReconnect: customScheduleReconnect,
			});

			const offlineHandlers = deviceHandlers.get('offline') as (() => void)[];
			offlineHandlers[0]();

			expect(customScheduleReconnect).toHaveBeenCalledWith(expect.any(Function), MQTT_OFFLINE_RECONNECT_DELAY_MS);

			// Manually call the captured handler
			if (capturedHandler) {
				const result = capturedHandler();
				if (result instanceof Promise) {
					await result;
				}
			}

			expect(reconnect).toHaveBeenCalled();
		});
	});

	describe('MQTT_OFFLINE_RECONNECT_DELAY_MS', () => {
		it('should be 60000 milliseconds', () => {
			expect(MQTT_OFFLINE_RECONNECT_DELAY_MS).toBe(60000);
		});
	});
});
