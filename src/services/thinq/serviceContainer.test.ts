import type { LocalStorage } from 'node-persist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformConfigManager } from '../../platform/platformConfigManager.js';
import { asPartial, createMockLogger } from '../../tests/helpers/testUtils.js';
import { ThinqServiceContainer } from './serviceContainer.js';

describe('ThinqServiceContainer', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockPersist: LocalStorage;
	let mockConfigManager: PlatformConfigManager;
	let container: ThinqServiceContainer;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockPersist = asPartial<LocalStorage>({
			getItem: vi.fn(),
			setItem: vi.fn(),
		});
		mockConfigManager = asPartial<PlatformConfigManager>({
			country: 'US',
			language: 'en',
		});
		container = new ThinqServiceContainer(mockLogger, mockPersist, mockConfigManager, '/tmp/mqtt');
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('apiClient', () => {
		it('should return a ThinqApiClient instance', () => {
			const apiClient = container.apiClient;

			expect(apiClient).toBeDefined();
		});

		it('should return the same instance on repeated access', () => {
			const apiClient1 = container.apiClient;
			const apiClient2 = container.apiClient;

			expect(apiClient1).toBe(apiClient2);
		});
	});

	describe('getUserDataRepository', () => {
		it('should return a UserDataRepository instance', () => {
			const repo = container.getUserDataRepository();

			expect(repo).toBeDefined();
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const repo1 = container.getUserDataRepository();
			const repo2 = container.getUserDataRepository();

			expect(repo1).toBe(repo2);
		});
	});

	describe('getAuthenticationCoordinator', () => {
		it('should return an AuthenticationCoordinator instance', () => {
			const coordinator = container.getAuthenticationCoordinator();

			expect(coordinator).toBeDefined();
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const coordinator1 = container.getAuthenticationCoordinator();
			const coordinator2 = container.getAuthenticationCoordinator();

			expect(coordinator1).toBe(coordinator2);
		});

		it('should construct coordinator with apiClient instance', () => {
			const coordinator = container.getAuthenticationCoordinator();

			expect(coordinator['apiClient']).toBe(container.apiClient);
		});
	});

	describe('getDeviceService', () => {
		it('should return a ThinqDeviceService instance', () => {
			const service = container.getDeviceService();

			expect(service).toBeDefined();
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const service1 = container.getDeviceService();
			const service2 = container.getDeviceService();

			expect(service1).toBe(service2);
		});
	});

	describe('getDeviceDiscovery', () => {
		it('should return a ThinqDeviceDiscovery instance', () => {
			const discovery = container.getDeviceDiscovery();

			expect(discovery).toBeDefined();
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const discovery1 = container.getDeviceDiscovery();
			const discovery2 = container.getDeviceDiscovery();

			expect(discovery1).toBe(discovery2);
		});

		it('should reuse the same ThinqDeviceService instance', () => {
			const deviceService = container.getDeviceService();
			const discovery = container.getDeviceDiscovery();

			expect(discovery['deviceService']).toBe(deviceService);
		});
	});

	describe('getDeviceConfigurator', () => {
		it('should return a ThinqDeviceConfigurator instance', () => {
			const configurator = container.getDeviceConfigurator();

			expect(configurator).toBeDefined();
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const configurator1 = container.getDeviceConfigurator();
			const configurator2 = container.getDeviceConfigurator();

			expect(configurator1).toBe(configurator2);
		});
	});

	describe('getMqttListener', () => {
		it('should return a ThinqMqttListener instance', () => {
			const listener = container.getMqttListener();

			expect(listener).toBeDefined();
			expect(listener).toHaveProperty('start');
			expect(listener).toHaveProperty('stop');
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const listener1 = container.getMqttListener();
			const listener2 = container.getMqttListener();

			expect(listener1).toBe(listener2);
		});

		it('should pass the mqttCertDir to the listener instance', () => {
			const mqttDir = '/custom/mqtt/dir';
			const customContainer = new ThinqServiceContainer(mockLogger, mockPersist, mockConfigManager, mqttDir);

			const listener = customContainer.getMqttListener();

			expect(listener).toBeDefined();
			// Verify by checking the private mqttDir field (if accessible, or through behavior)
			expect(listener['mqttDir']).toBe(mqttDir);
		});

		it('should use the apiClient instance for the listener', () => {
			const listener = container.getMqttListener();

			expect(listener['apiClient']).toBe(container.apiClient);
		});

		it('should use the correct logger for the listener', () => {
			const listener = container.getMqttListener();

			expect(listener['logger']).toBe(mockLogger);
		});
	});

	describe('getFilterMonitoringService', () => {
		it('should return a ThinqFilterMonitoringService instance', () => {
			const service = container.getFilterMonitoringService();

			expect(service).toBeDefined();
			expect(service).toHaveProperty('startPolling');
			expect(service).toHaveProperty('stopPolling');
		});

		it('should return the same instance on repeated calls (singleton)', () => {
			const service1 = container.getFilterMonitoringService();
			const service2 = container.getFilterMonitoringService();

			expect(service1).toBe(service2);
		});

		it('should use the apiClient instance', () => {
			const service = container.getFilterMonitoringService();

			expect(service['apiClient']).toBe(container.apiClient);
		});

		it('should use the correct logger', () => {
			const service = container.getFilterMonitoringService();

			expect(service['logger']).toBe(mockLogger);
		});
	});
});
