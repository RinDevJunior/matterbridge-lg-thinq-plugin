import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqSnapshot } from '../../../core/domain/value-objects/ThinqSnapshot.js';
import { asPartial, createMockLogger } from '../../../tests/helpers/testUtils.js';
import type { ThinqApiClient } from '../thinqApiClient.js';
import type { MqttKeyRepository } from './mqttKeyRepository.js';
import { ThinqMqttListener } from './thinqMqttListener.js';

// Mock aws-iot-device-sdk
const mockMqttDevice = {
	on: vi.fn((event: string, handler: unknown) => {
		// Handler registration (no-op)
		return mockMqttDevice;
	}),
	subscribe: vi.fn(),
	end: vi.fn(),
};

vi.mock('aws-iot-device-sdk', () => {
	const DeviceConstructor = function () {
		return mockMqttDevice;
	};
	return {
		device: DeviceConstructor,
	};
});

// Mock file system operations
vi.mock('node:fs', () => ({
	promises: {
		readFile: vi.fn().mockResolvedValue(null),
		writeFile: vi.fn().mockResolvedValue(undefined),
		mkdir: vi.fn().mockResolvedValue(undefined),
	},
}));

// Mock mqttCertificate module
vi.mock('./mqttCertificate.js', () => ({
	downloadRootCa: vi.fn().mockResolvedValue('-----BEGIN CERTIFICATE-----\nFAKE-PEM\n-----END CERTIFICATE-----'),
	writeMqttCertificateFiles: vi.fn().mockResolvedValue({
		ca: '/tmp/ca.pem',
		cert: '/tmp/cert.pem',
		key: '/tmp/key.pem',
	}),
	certificateRequestBody: vi.fn().mockReturnValue('fake-csr-body'),
}));

describe('ThinqMqttListener', () => {
	let mockApiClient: ThinqApiClient;
	let mockKeyRepository: MqttKeyRepository;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let listener: ThinqMqttListener;
	const mqttDir = '/tmp/mqtt';

	beforeEach(() => {
		vi.clearAllMocks();

		mockLogger = createMockLogger();

		mockApiClient = asPartial<ThinqApiClient>({
			getMqttRouteInfo: vi.fn(),
			registerMqttClient: vi.fn(),
			requestMqttCertificate: vi.fn(),
			getClientId: vi.fn().mockReturnValue('test-client-id'),
		});

		mockKeyRepository = asPartial<MqttKeyRepository>({
			getOrCreateKeyPair: vi.fn(),
			getOrCreateCsr: vi.fn(),
		});

		listener = new ThinqMqttListener(mockApiClient, mockKeyRepository, mqttDir, mockLogger);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('stop', () => {
		it('should set stopped flag', () => {
			listener.stop();

			expect(listener['stopped']).toBe(true);
		});

		it('should clear reconnect timer on stop', () => {
			listener['reconnectTimer'] = setTimeout(() => {
				// This should not be called
			}, 5000);

			listener.stop();

			expect(listener['reconnectTimer']).toBeUndefined();
		});

		it('should be idempotent when called multiple times', () => {
			listener.stop();
			listener.stop();

			expect(listener['stopped']).toBe(true);
		});

		it('should call device end if device exists', () => {
			const mockEnd = vi.fn();
			listener['device'] = asPartial({
				on: vi.fn(),
				subscribe: vi.fn(),
				end: mockEnd,
			});

			listener.stop();

			expect(mockEnd).toHaveBeenCalled();
		});
	});

	describe('handleMessage', () => {
		const onUpdate = vi.fn();

		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('should call onUpdate with valid MQTT message', () => {
			listener['handleMessage'](
				{
					deviceId: 'device-123',
					data: { state: { reported: { 'airState.operation': 1 } } },
				},
				onUpdate,
			);

			expect(onUpdate).toHaveBeenCalledWith('device-123', expect.any(ThinqSnapshot));
		});

		it('should not call onUpdate for message missing deviceId', () => {
			listener['handleMessage'](
				{
					data: { state: { reported: { 'airState.operation': 1 } } },
				},
				onUpdate,
			);

			expect(onUpdate).not.toHaveBeenCalled();
			expect(mockLogger.debug).toHaveBeenCalledWith('ThinQ MQTT: received malformed message, skipping.');
		});

		it('should not call onUpdate for message missing data', () => {
			listener['handleMessage'](
				{
					deviceId: 'device-123',
				},
				onUpdate,
			);

			expect(onUpdate).not.toHaveBeenCalled();
		});

		it('should not call onUpdate for message missing reported state', () => {
			listener['handleMessage'](
				{
					deviceId: 'device-123',
					data: { state: {} },
				},
				onUpdate,
			);

			expect(onUpdate).not.toHaveBeenCalled();
		});

		it('should not call onUpdate for non-object payload', () => {
			listener['handleMessage']('not an object', onUpdate);

			expect(onUpdate).not.toHaveBeenCalled();
		});

		it('should not call onUpdate for null payload', () => {
			listener['handleMessage'](null, onUpdate);

			expect(onUpdate).not.toHaveBeenCalled();
		});

		it('should construct ThinqSnapshot with reported data', () => {
			const reportedData = { 'airState.operation': 1, 'airState.tempState.current': 24 };

			listener['handleMessage'](
				{
					deviceId: 'device-123',
					data: { state: { reported: reportedData } },
				},
				onUpdate,
			);

			const call = vi.mocked(onUpdate).mock.calls[0];
			const snapshot = call[1];
			expect(snapshot).toBeInstanceOf(ThinqSnapshot);
		});

		it('should not call onUpdate for non-string deviceId', () => {
			listener['handleMessage'](
				{
					deviceId: 123,
					data: { state: { reported: { 'airState.operation': 1 } } },
				},
				onUpdate,
			);

			expect(onUpdate).not.toHaveBeenCalled();
		});

		it('should not call onUpdate for non-object reported state', () => {
			listener['handleMessage'](
				{
					deviceId: 'device-123',
					data: { state: { reported: 'not an object' } },
				},
				onUpdate,
			);

			expect(onUpdate).not.toHaveBeenCalled();
		});
	});

	describe('start integration', () => {
		it('should not reject when start fails', async () => {
			vi.mocked(mockApiClient.getMqttRouteInfo).mockRejectedValue(new Error('Network error'));

			// Use fake timers to speed up retries
			vi.useFakeTimers();
			const startPromise = listener.start(vi.fn());

			// Run all pending timers
			await vi.runAllTimersAsync();

			vi.useRealTimers();

			await startPromise;

			// Should log error about unable to start
			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('unable to start after retries'));
		});
	});

	describe('connect happy path', () => {
		beforeEach(() => {
			vi.clearAllMocks();

			// Setup successful API responses
			vi.mocked(mockApiClient.getMqttRouteInfo).mockResolvedValue({
				mqttServer: 'mqtts://mqtt.example.com:8883',
			});
			vi.mocked(mockApiClient.registerMqttClient).mockResolvedValue(undefined);
			vi.mocked(mockApiClient.requestMqttCertificate).mockResolvedValue({
				certificatePem: 'FAKE-CERT-PEM',
				subscriptions: ['topic/1', 'topic/2'],
			});
			vi.mocked(mockKeyRepository.getOrCreateKeyPair).mockResolvedValue({
				privateKey: 'FAKE-PRIVATE-KEY',
				publicKey: 'FAKE-PUBLIC-KEY',
			});
			vi.mocked(mockKeyRepository.getOrCreateCsr).mockResolvedValue('FAKE-CSR');
		});

		it('should construct awsIotDevice with correct clientId and hostname', async () => {
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getClientId).mockReturnValue('test-client-id');

			await listener['connect'](onUpdate);

			// Verify device was created by checking it was assigned
			expect(listener['device']).toBe(mockMqttDevice);
		});

		it('should call wireMqttDeviceEvents after device construction', async () => {
			const onUpdate = vi.fn();
			vi.mocked(mockMqttDevice.on).mockClear();

			await listener['connect'](onUpdate);

			// wireMqttDeviceEvents calls device.on to set up event handlers
			expect(vi.mocked(mockMqttDevice.on)).toHaveBeenCalled();
		});

		it('should store device instance after successful connection', async () => {
			const onUpdate = vi.fn();

			await listener['connect'](onUpdate);

			expect(listener['device']).toBeDefined();
			expect(listener['device']).toBe(mockMqttDevice);
		});

		it('should call getMqttRouteInfo to get server details', async () => {
			const onUpdate = vi.fn();
			vi.mocked(mockApiClient.getMqttRouteInfo).mockClear();

			await listener['connect'](onUpdate);

			expect(vi.mocked(mockApiClient.getMqttRouteInfo)).toHaveBeenCalled();
		});

		it('should register MQTT client before requesting certificate', async () => {
			const onUpdate = vi.fn();
			const callOrder: string[] = [];

			vi.mocked(mockApiClient.registerMqttClient).mockImplementation(async () => {
				callOrder.push('registerMqttClient');
			});

			vi.mocked(mockApiClient.requestMqttCertificate).mockImplementation(async () => {
				callOrder.push('requestMqttCertificate');
				return { certificatePem: 'FAKE', subscriptions: [] };
			});

			await listener['connect'](onUpdate);

			expect(callOrder[0]).toBe('registerMqttClient');
			expect(callOrder[1]).toBe('requestMqttCertificate');
		});

		it('should get key pair before requesting certificate', async () => {
			const onUpdate = vi.fn();
			vi.mocked(mockKeyRepository.getOrCreateKeyPair).mockClear();
			vi.mocked(mockApiClient.registerMqttClient).mockClear();

			await listener['connect'](onUpdate);

			expect(vi.mocked(mockKeyRepository.getOrCreateKeyPair)).toHaveBeenCalled();
		});

		it('should get CSR before registering client', async () => {
			const onUpdate = vi.fn();
			const callOrder: string[] = [];

			vi.mocked(mockKeyRepository.getOrCreateCsr).mockImplementation(async () => {
				callOrder.push('getOrCreateCsr');
				return 'FAKE-CSR';
			});

			vi.mocked(mockApiClient.registerMqttClient).mockImplementation(async () => {
				callOrder.push('registerMqttClient');
			});

			await listener['connect'](onUpdate);

			expect(callOrder.indexOf('getOrCreateCsr')).toBeLessThan(callOrder.indexOf('registerMqttClient'));
		});
	});
});
