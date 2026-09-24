import type NodePersist from 'node-persist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asPartial, createMockLogger } from '../../../tests/helpers/testUtils.js';
import { MqttKeyRepository } from './mqttKeyRepository.js';

describe('MqttKeyRepository', () => {
	let mockPersist: NodePersist.LocalStorage;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let repository: MqttKeyRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPersist = asPartial<NodePersist.LocalStorage>({
			getItem: vi.fn(),
			setItem: vi.fn(),
		});
		mockLogger = createMockLogger();
		repository = new MqttKeyRepository(mockPersist, mockLogger);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('getOrCreateKeyPair', () => {
		it('should return cached key pair when it exists', async () => {
			const cachedKeyPair = {
				privateKey: 'cached-private-key',
				publicKey: 'cached-public-key',
			};

			vi.mocked(mockPersist.getItem).mockResolvedValue(cachedKeyPair);

			const result = await repository.getOrCreateKeyPair();

			expect(result).toEqual(cachedKeyPair);
			expect(mockPersist.getItem).toHaveBeenCalledWith('thinq:mqtt:keyPair');
			expect(mockPersist.setItem).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith('Loaded cached MQTT key pair');
		});

		it('should generate and cache new key pair when cache is empty', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vi.mocked(mockPersist.setItem) as any).mockImplementation(() => Promise.resolve());

			const result = await repository.getOrCreateKeyPair();

			expect(result).toBeDefined();
			expect(result.privateKey).toBeDefined();
			expect(result.publicKey).toBeDefined();
			expect(mockPersist.getItem).toHaveBeenCalledWith('thinq:mqtt:keyPair');
			expect(mockPersist.setItem).toHaveBeenCalledWith('thinq:mqtt:keyPair', result);
			expect(mockLogger.debug).toHaveBeenCalledWith('Generating 2048-bit MQTT key pair...');
		});

		it('should persist the generated key pair', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vi.mocked(mockPersist.setItem) as any).mockImplementation(() => Promise.resolve());

			await repository.getOrCreateKeyPair();

			expect(mockPersist.setItem).toHaveBeenCalledWith(
				'thinq:mqtt:keyPair',
				expect.objectContaining({
					privateKey: expect.stringContaining('PRIVATE KEY'),
					publicKey: expect.stringContaining('PUBLIC KEY'),
				}),
			);
		});

		it('should return the same instance on repeated calls', async () => {
			const cachedKeyPair = {
				privateKey: 'cached-private-key',
				publicKey: 'cached-public-key',
			};

			vi.mocked(mockPersist.getItem).mockResolvedValue(cachedKeyPair);

			const result1 = await repository.getOrCreateKeyPair();
			const result2 = await repository.getOrCreateKeyPair();

			expect(result1).toBe(result2);
			// getItem should be called once per call
			expect(mockPersist.getItem).toHaveBeenCalledTimes(2);
		});

		it('should generate keys with RSA format', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vi.mocked(mockPersist.setItem) as any).mockImplementation(() => Promise.resolve());

			const result = await repository.getOrCreateKeyPair();

			expect(result.privateKey).toContain('BEGIN RSA PRIVATE KEY');
			expect(result.publicKey).toContain('BEGIN PUBLIC KEY');
		});
	});

	describe('getOrCreateCsr', () => {
		it('should return cached CSR when it exists', async () => {
			const cachedCsr = 'cached-csr-data';
			const keyPair = { privateKey: 'key', publicKey: 'pubkey' };

			vi.mocked(mockPersist.getItem).mockResolvedValue(cachedCsr);

			const result = await repository.getOrCreateCsr(keyPair);

			expect(result).toBe(cachedCsr);
			expect(mockPersist.getItem).toHaveBeenCalledWith('thinq:mqtt:csr');
			expect(mockPersist.setItem).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith('Loaded cached MQTT CSR');
		});

		it('should generate and cache new CSR when cache is empty', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vi.mocked(mockPersist.setItem) as any).mockImplementation(() => Promise.resolve());

			// Use the actual generateMqttKeyPair to create valid keys
			const { generateMqttKeyPair } = await import('./mqttCertificate.js');
			const keyPair = generateMqttKeyPair();

			const result = await repository.getOrCreateCsr(keyPair);

			expect(result).toBeDefined();
			expect(result).toContain('BEGIN CERTIFICATE REQUEST');
			expect(mockPersist.getItem).toHaveBeenCalledWith('thinq:mqtt:csr');
			expect(mockPersist.setItem).toHaveBeenCalledWith('thinq:mqtt:csr', result);
			expect(mockLogger.debug).toHaveBeenCalledWith('Creating MQTT certification request (CSR)...');
		});

		it('should return the same CSR on repeated calls with cache', async () => {
			const cachedCsr = 'cached-csr';
			const keyPair = { privateKey: 'key', publicKey: 'pubkey' };

			vi.mocked(mockPersist.getItem).mockResolvedValue(cachedCsr);

			const result1 = await repository.getOrCreateCsr(keyPair);
			const result2 = await repository.getOrCreateCsr(keyPair);

			expect(result1).toBe(result2);
			expect(result1).toBe(cachedCsr);
		});

		it('should store CSR under correct storage key', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(vi.mocked(mockPersist.setItem) as any).mockImplementation(() => Promise.resolve());

			const { generateMqttKeyPair } = await import('./mqttCertificate.js');
			const keyPair = generateMqttKeyPair();

			await repository.getOrCreateCsr(keyPair);

			expect(mockPersist.setItem).toHaveBeenCalledWith(
				'thinq:mqtt:csr',
				expect.stringContaining('BEGIN CERTIFICATE REQUEST'),
			);
		});
	});
});
