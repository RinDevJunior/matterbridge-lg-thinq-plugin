export const MQTT_OFFLINE_RECONNECT_DELAY_MS = 60000;

export interface MqttRuntimeDevice {
	on(event: 'error', handler: (err: unknown) => void): unknown;
	on(event: 'connect' | 'offline', handler: () => void): unknown;
	on(event: 'message', handler: (topic: string, payload: Buffer) => void): unknown;
	subscribe(subscription: string): unknown;
	end(): unknown;
}

export interface MqttRuntimeLogger {
	debug(...args: unknown[]): void;
	error(...args: unknown[]): void;
	info(...args: unknown[]): void;
}

export type MqttReconnectScheduler = (handler: () => void | Promise<void>, delayMs: number) => unknown;

/** Wires connect/message/error/offline handlers onto an MQTT device, ports `mqttConnection.ts` verbatim. */
export function wireMqttDeviceEvents(options: {
	device: MqttRuntimeDevice;
	logger: MqttRuntimeLogger;
	mqttServer: string;
	subscriptions: string[];
	onMessage: (data: unknown) => void;
	reconnect: () => Promise<void>;
	scheduleReconnect?: MqttReconnectScheduler;
}): void {
	const {
		device,
		logger,
		mqttServer,
		subscriptions,
		onMessage,
		reconnect,
		scheduleReconnect = (handler, delayMs) => setTimeout(handler, delayMs),
	} = options;

	device.on('error', (err) => {
		logger.error('mqtt err:', err);
	});

	device.on('connect', () => {
		logger.info('Successfully connected to the MQTT server.');
		logger.debug('mqtt connected:', mqttServer);
		for (const subscription of subscriptions) {
			device.subscribe(subscription);
		}
	});

	device.on('message', (_topic, payload) => {
		const payloadText = payload.toString();
		let parsedPayload: unknown;
		try {
			parsedPayload = JSON.parse(payloadText);
		} catch (err) {
			logger.error('mqtt message parse error:', err);
			logger.debug('mqtt invalid message received:', payloadText);
			return;
		}

		onMessage(parsedPayload);
		logger.debug('mqtt message received:', payloadText);
	});

	device.on('offline', () => {
		device.end();

		logger.info('MQTT disconnected, retrying in 60 seconds!');
		scheduleReconnect(() => {
			reconnect().catch((err: unknown) => {
				logger.error('mqtt reconnect failed:', err);
			});
		}, MQTT_OFFLINE_RECONNECT_DELAY_MS);
	});
}
