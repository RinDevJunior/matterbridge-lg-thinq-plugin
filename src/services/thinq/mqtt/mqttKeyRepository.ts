import { AnsiLogger } from 'matterbridge/logger';
import type NodePersist from 'node-persist';

import { createMqttCsr, generateMqttKeyPair, MqttKeyPair } from './mqttCertificate.js';

const KEY_PAIR_STORAGE_KEY = 'thinq:mqtt:keyPair';
const CSR_STORAGE_KEY = 'thinq:mqtt:csr';

/** Persisted RSA keypair/CSR repository for MQTT client certificate enrollment, mirrors `UserDataRepository`. */
export class MqttKeyRepository {
	constructor(
		private readonly persist: NodePersist.LocalStorage,
		private readonly logger: AnsiLogger,
	) {}

	/** Loads the cached MQTT key pair, generating and caching one on first call. */
	public async getOrCreateKeyPair(): Promise<MqttKeyPair> {
		const cached = (await this.persist.getItem(KEY_PAIR_STORAGE_KEY)) as MqttKeyPair | undefined;
		if (cached) {
			this.logger.debug('Loaded cached MQTT key pair');
			return cached;
		}

		this.logger.debug('Generating 2048-bit MQTT key pair...');
		const keys = generateMqttKeyPair();
		await this.persist.setItem(KEY_PAIR_STORAGE_KEY, keys);
		return keys;
	}

	/** Loads the cached MQTT CSR, generating and caching one on first call. */
	public async getOrCreateCsr(keys: MqttKeyPair): Promise<string> {
		const cached = (await this.persist.getItem(CSR_STORAGE_KEY)) as string | undefined;
		if (cached) {
			this.logger.debug('Loaded cached MQTT CSR');
			return cached;
		}

		this.logger.debug('Creating MQTT certification request (CSR)...');
		const csr = createMqttCsr(keys);
		await this.persist.setItem(CSR_STORAGE_KEY, csr);
		return csr;
	}
}
