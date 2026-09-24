import { device as awsIotDevice } from 'aws-iot-device-sdk';
import { AnsiLogger } from 'matterbridge/logger';

import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import { ThinqApiClient } from '../thinqApiClient.js';
import { ThinqDeviceUpdateListener } from '../thinqDeviceService.js';
import { certificateRequestBody, downloadRootCa, writeMqttCertificateFiles } from './mqttCertificate.js';
import { MqttReconnectScheduler, MqttRuntimeDevice, wireMqttDeviceEvents } from './mqttConnectionEvents.js';
import { MqttKeyRepository } from './mqttKeyRepository.js';
import { retryMqttRegistration } from './mqttRetry.js';

/**
 * Orchestrates MQTT push updates for ThinQ2 AirConditioner devices, running concurrently alongside
 * `ThinqDeviceService`'s polling loop. Never rejects from `start()` — graceful degradation is structural
 * (bounded retries, then log-and-return), so polling can continue independently on total MQTT failure.
 */
export class ThinqMqttListener {
	private stopped = false;
	private device: MqttRuntimeDevice | undefined;
	private reconnectTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly apiClient: ThinqApiClient,
		private readonly keyRepository: MqttKeyRepository,
		private readonly mqttDir: string,
		private readonly logger: AnsiLogger,
	) {}

	public async start(onUpdate: ThinqDeviceUpdateListener): Promise<void> {
		this.stop();
		this.stopped = false;

		const started = await retryMqttRegistration({
			register: () => this.connect(onUpdate),
			logger: this.logger,
		});

		if (!started) {
			this.logger.error('ThinQ MQTT: unable to start after retries, continuing with polling only.');
		}
	}

	public stop(): void {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.device?.end();
		this.device = undefined;
	}

	private async connect(onUpdate: ThinqDeviceUpdateListener): Promise<void> {
		const route = await this.apiClient.getMqttRouteInfo();
		const hostname = new URL(route.mqttServer).hostname;
		const rootCA = await downloadRootCa(hostname);

		const keys = await this.keyRepository.getOrCreateKeyPair();
		const csr = await this.keyRepository.getOrCreateCsr(keys);

		await this.apiClient.registerMqttClient();
		const certificate = await this.apiClient.requestMqttCertificate(certificateRequestBody(csr));

		const paths = await writeMqttCertificateFiles({
			mqttDir: this.mqttDir,
			rootCA,
			privateKey: keys.privateKey,
			certificatePem: certificate.certificatePem,
		});

		this.logger.debug(`ThinQ MQTT: connecting to ${route.mqttServer}`);
		const device = new awsIotDevice({
			...paths,
			clientId: this.apiClient.getClientId(),
			host: hostname,
		}) as unknown as MqttRuntimeDevice;
		this.device = device;

		const reconnect = async (): Promise<void> => {
			if (this.stopped) {
				return;
			}
			await this.connect(onUpdate);
		};

		const scheduleReconnect: MqttReconnectScheduler = (handler, delayMs) => {
			if (this.stopped) {
				return undefined;
			}
			this.reconnectTimer = setTimeout(handler, delayMs);
			return this.reconnectTimer;
		};

		wireMqttDeviceEvents({
			device,
			logger: this.logger,
			mqttServer: route.mqttServer,
			subscriptions: certificate.subscriptions,
			onMessage: (payload) => this.handleMessage(payload, onUpdate),
			reconnect,
			scheduleReconnect,
		});
	}

	private handleMessage(payload: unknown, onUpdate: ThinqDeviceUpdateListener): void {
		if (typeof payload !== 'object' || payload === null || !('deviceId' in payload) || !('data' in payload)) {
			this.logger.debug('ThinQ MQTT: received malformed message, skipping.');
			return;
		}

		const message = payload as { deviceId: unknown; data?: { state?: { reported?: unknown } } };
		const reported = message.data?.state?.reported;
		if (typeof message.deviceId !== 'string' || typeof reported !== 'object' || reported === null) {
			this.logger.debug('ThinQ MQTT: received message with missing deviceId/reported state, skipping.');
			return;
		}

		onUpdate(message.deviceId, new ThinqSnapshot(reported as Record<string, unknown>));
	}
}
