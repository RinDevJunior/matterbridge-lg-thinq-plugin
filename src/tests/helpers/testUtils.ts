import type { AnsiLogger } from 'matterbridge/logger';
import { vi } from 'vitest';

import type { GatewayData } from '../../services/thinq/gateway.js';
import type { ThinqDeviceData } from '../../services/thinq/thinqApiClient.js';

/**
 * Creates a mock AnsiLogger for testing.
 * All methods are vitest spies that can be asserted against.
 */
export function createMockLogger(): AnsiLogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		notice: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		setMaxListeners: vi.fn(),
		getMaxListeners: vi.fn(),
		addListener: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
		off: vi.fn(),
		removeAllListeners: vi.fn(),
		listeners: vi.fn(),
		rawListeners: vi.fn(),
		emit: vi.fn(),
		listenerCount: vi.fn(),
		prependListener: vi.fn(),
		prependOnceListener: vi.fn(),
		eventNames: vi.fn(),
	} as unknown as AnsiLogger;
}

/**
 * Helper to create a partial object of a type without `as any`.
 * Used for test fixtures where only specific properties are needed.
 */
export function asPartial<T>(partial: Partial<T>): T {
	return partial as T;
}

/**
 * Builds a mock GatewayData response for testing.
 */
export function buildGatewayResponse(overrides?: Partial<GatewayData>): GatewayData {
	return {
		empTermsUri: 'https://emp-terms.lgecloud.com',
		empSpxUri: 'https://emp-spx.lgecloud.com',
		thinq2Uri: 'https://aic-service.lgecloud.com',
		thinq1Uri: 'https://v1aic-service.lgecloud.com',
		countryCode: 'US',
		languageCode: 'en',
		...overrides,
	};
}

/**
 * Builds a mock ThinqDeviceData response for testing.
 */
export function buildThinqDeviceData(overrides?: Partial<ThinqDeviceData>): ThinqDeviceData {
	return {
		deviceId: '12345678-1234-1234-1234-123456789012',
		alias: 'Living Room AC',
		modelJsonUri: 'https://example.com/model.json',
		deviceType: 401,
		modelName: 'DualCool Plus',
		manufacture: {
			macAddress: '00:00:00:00:00:00',
			salesModel: 'AC123',
			serialNo: 'SN12345',
			manufactureModel: 'AC123-MANU',
		},
		modemInfo: {
			appVersion: '1.0',
			modelName: 'AC123',
		},
		snapshot: {
			online: true,
			'airState.operation': 1,
			'airState.tempState.current': 24,
			'airState.tempState.target': 22,
			'airState.opMode': 0,
			'airState.windStrength': 2,
		},
		platformType: 'THINQ',
		online: true,
		...overrides,
	};
}

/**
 * Creates a mock node-persist LocalStorage for testing.
 */
export function createMockNodePersist() {
	return {
		getItem: vi.fn(),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
		keys: vi.fn(),
		length: vi.fn(),
	};
}

/**
 * Helper to set a readonly property on an object for testing.
 * Useful for testing readonly class properties.
 */
export function setReadOnlyProperty<T, K extends keyof T>(obj: T, key: K, value: T[K]): void {
	Object.defineProperty(obj, key, {
		value,
		writable: false,
		configurable: true,
	});
}
