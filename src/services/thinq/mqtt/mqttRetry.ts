import { AnsiLogger } from 'matterbridge/logger';

export const MQTT_RETRY_ATTEMPTS = 5;
export const MQTT_RETRY_DELAY_MS = 5000;

export function delayMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded-attempt retry with delay for MQTT registration; ports `retryMqttRegistration` from `mqttCertificate.ts`. */
export async function retryMqttRegistration(options: {
	register: () => Promise<void>;
	logger: Pick<AnsiLogger, 'debug' | 'error'>;
	delay?: (ms: number) => Promise<void>;
	attempts?: number;
	retryDelayMs?: number;
}): Promise<boolean> {
	const {
		register,
		logger,
		delay = delayMs,
		attempts = MQTT_RETRY_ATTEMPTS,
		retryDelayMs = MQTT_RETRY_DELAY_MS,
	} = options;
	let tried = attempts;

	while (tried > 0) {
		try {
			await register();
			return true;
		} catch (err) {
			tried--;
			logger.debug(`mqtt err: ${err instanceof Error ? err.message : String(err)}`);
			if (tried > 0) {
				logger.debug('Cannot start MQTT, retrying in 5s.');
				await delay(retryDelayMs);
			}
		}
	}

	logger.error('Cannot start MQTT!');
	return false;
}
