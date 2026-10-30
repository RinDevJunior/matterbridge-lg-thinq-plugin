import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
	reconcileThinqConnectDeviceConfigEntries,
	syncThinqConnectDeviceConfigEntries,
	type ThinqConnectConfigEntry,
	type ThinqConnectConfigSyncDeps,
	type ThinqConnectDeviceRef,
} from '../../thinqConnect/thinqConnectDeviceConfigReconciler.js';
import { createMockLogger } from '../helpers/testUtils.js';

interface UserOwnedKeys {
	ignore?: boolean;
	productName?: string;
	productId?: number;
}
type UserEntry = ThinqConnectConfigEntry & UserOwnedKeys;

function createAcDevice(deviceId = 'connect-ac-001'): ThinqConnectDeviceRef {
	return { deviceId, deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER' } };
}

function createWasherDevice(deviceId = 'connect-washer-001'): ThinqConnectDeviceRef {
	return { deviceId, deviceInfo: { deviceType: 'DEVICE_WASHER' } };
}

function createUserEntry(entry: UserEntry): UserEntry {
	return entry;
}

function createMockListDevices(): Mock<() => Promise<ThinqConnectDeviceRef[]>> {
	return vi.fn<() => Promise<ThinqConnectDeviceRef[]>>().mockResolvedValue([]);
}

function createMockSaveConfig(): Mock<() => void> {
	return vi.fn<() => void>();
}

function createSyncDeps(overrides: Partial<ThinqConnectConfigSyncDeps> = {}): ThinqConnectConfigSyncDeps {
	return {
		listDevices: createMockListDevices(),
		thinqConfig: {},
		saveConfig: createMockSaveConfig(),
		logger: createMockLogger(),
		...overrides,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childOf(node: unknown, key: string): unknown {
	if (!isRecord(node)) {
		throw new Error(`expected an object before "${key}"`);
	}
	return node[key];
}

function navigate(root: unknown, path: string[]): unknown {
	return path.reduce<unknown>((node, key) => childOf(node, key), root);
}

const SCHEMA_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../matterbridge-lg-thinq-plugin.schema.json',
);
const LOGIN_TYPE_PATH = ['properties', 'thinq', 'dependencies', 'loginType'];

describe('thinqConnectDeviceConfigReconciler', () => {
	describe('reconcileThinqConnectDeviceConfigEntries', () => {
		it('should push AC and WASHER entries for an empty config with one of each device type', () => {
			// Arrange
			const configDevices: ThinqConnectConfigEntry[] = [];
			const devices = [createWasherDevice(), createAcDevice()];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, devices);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toEqual([
				{ deviceId: 'connect-washer-001', deviceType: 'WASHER' },
				{ deviceId: 'connect-ac-001', deviceType: 'AC' },
			]);
		});

		it.each([
			[
				'an unsupported device type',
				{ deviceId: 'connect-fridge-001', deviceInfo: { deviceType: 'DEVICE_REFRIGERATOR' } },
			],
			['a missing deviceInfo', { deviceId: 'connect-unknown-001' }],
			['an empty deviceId', { deviceId: '', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER' } }],
		])('should skip a device with %s and return false', (_label, device) => {
			// Arrange
			const configDevices: ThinqConnectConfigEntry[] = [];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, [device]);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toEqual([]);
		});

		it('should add only the ids that are not yet in the config', () => {
			// Arrange
			const configDevices: ThinqConnectConfigEntry[] = [{ deviceId: 'connect-ac-001', deviceType: 'AC' }];
			const devices = [createAcDevice(), createWasherDevice()];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, devices);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toEqual([
				{ deviceId: 'connect-ac-001', deviceType: 'AC' },
				{ deviceId: 'connect-washer-001', deviceType: 'WASHER' },
			]);
		});

		it('should backfill a missing deviceType and keep the user-owned keys', () => {
			// Arrange
			const configDevices: UserEntry[] = [
				createUserEntry({ deviceId: 'connect-ac-001', ignore: true, productName: 'Study AC', productId: 7 }),
			];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, [createAcDevice()]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toEqual([
				{ deviceId: 'connect-ac-001', deviceType: 'AC', ignore: true, productName: 'Study AC', productId: 7 },
			]);
		});

		it('should correct a wrong deviceType and keep the user-owned keys', () => {
			// Arrange
			const configDevices: UserEntry[] = [
				createUserEntry({ deviceId: 'connect-washer-001', deviceType: 'AC', productId: 7 }),
			];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, [createWasherDevice()]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toEqual([{ deviceId: 'connect-washer-001', deviceType: 'WASHER', productId: 7 }]);
		});

		it('should leave an already-correct entry with ignore, productName and productId untouched and return false', () => {
			// Arrange
			const configDevices: UserEntry[] = [
				createUserEntry({
					deviceId: 'connect-ac-001',
					deviceType: 'AC',
					ignore: true,
					productName: 'Study AC',
					productId: 7,
				}),
			];
			const before = structuredClone(configDevices);

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, [createAcDevice()]);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toEqual(before);
		});

		it('should keep config entries for ids missing from the device list and never delete them', () => {
			// Arrange
			const configDevices: UserEntry[] = [
				createUserEntry({ deviceId: 'legacy-v1-uuid-001', deviceType: 'AC', ignore: true }),
			];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, []);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toEqual([{ deviceId: 'legacy-v1-uuid-001', deviceType: 'AC', ignore: true }]);
		});

		it('should create only one entry when the device list repeats the same id', () => {
			// Arrange
			const configDevices: ThinqConnectConfigEntry[] = [];

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, [createAcDevice(), createAcDevice()]);

			// Assert
			expect(changed).toBe(true);
			expect(configDevices).toEqual([{ deviceId: 'connect-ac-001', deviceType: 'AC' }]);
		});

		it('should return false on a second run over an already-reconciled config', () => {
			// Arrange
			const configDevices: ThinqConnectConfigEntry[] = [];
			const devices = [createAcDevice(), createWasherDevice()];
			reconcileThinqConnectDeviceConfigEntries(configDevices, devices);

			// Act
			const changed = reconcileThinqConnectDeviceConfigEntries(configDevices, devices);

			// Assert
			expect(changed).toBe(false);
			expect(configDevices).toHaveLength(2);
		});
	});

	describe('syncThinqConnectDeviceConfigEntries', () => {
		let deps: ThinqConnectConfigSyncDeps;

		beforeEach(() => {
			vi.clearAllMocks();
			deps = createSyncDeps();
		});

		it('should create the devices array when it is missing, fill it and call saveConfig once', async () => {
			// Arrange
			deps = createSyncDeps({ listDevices: vi.fn().mockResolvedValue([createWasherDevice()]) });

			// Act
			await syncThinqConnectDeviceConfigEntries(deps);

			// Assert
			expect(deps.thinqConfig.devices).toEqual([{ deviceId: 'connect-washer-001', deviceType: 'WASHER' }]);
			expect(deps.saveConfig).toHaveBeenCalledTimes(1);
		});

		it('should log the number of created entries at info level', async () => {
			// Arrange
			deps = createSyncDeps({ listDevices: vi.fn().mockResolvedValue([createAcDevice()]) });

			// Act
			await syncThinqConnectDeviceConfigEntries(deps);

			// Assert
			expect(deps.logger.info).toHaveBeenCalledWith(expect.stringContaining('created 1'));
		});

		it('should not call saveConfig when no change is needed', async () => {
			// Arrange
			deps = createSyncDeps({
				listDevices: vi.fn().mockResolvedValue([createAcDevice()]),
				thinqConfig: { devices: [{ deviceId: 'connect-ac-001', deviceType: 'AC' }] },
			});

			// Act
			await syncThinqConnectDeviceConfigEntries(deps);

			// Assert
			expect(deps.saveConfig).not.toHaveBeenCalled();
		});

		it('should warn and resolve without rethrowing when listDevices rejects', async () => {
			// Arrange
			deps = createSyncDeps({ listDevices: vi.fn().mockRejectedValue(new Error('network down')) });

			// Act & Assert
			await expect(syncThinqConnectDeviceConfigEntries(deps)).resolves.toBeUndefined();
			expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('network down'));
			expect(deps.saveConfig).not.toHaveBeenCalled();
		});

		it('should log an error, resolve, and keep the in-memory entries when saveConfig throws', async () => {
			// Arrange
			deps = createSyncDeps({
				listDevices: vi.fn().mockResolvedValue([createAcDevice()]),
				saveConfig: vi.fn<() => void>().mockImplementation(() => {
					throw new Error('disk full');
				}),
			});

			// Act & Assert
			await expect(syncThinqConnectDeviceConfigEntries(deps)).resolves.toBeUndefined();
			expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
			expect(deps.thinqConfig.devices).toEqual([{ deviceId: 'connect-ac-001', deviceType: 'AC' }]);
		});
	});

	describe('schema pat branch', () => {
		const schema: unknown = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

		it('should parse the schema file as a JSON object', () => {
			// Arrange & Act & Assert
			expect(isRecord(schema)).toBe(true);
		});

		it('should give the pat branch a devices array whose items carry the Connect entry keys', () => {
			// Arrange
			const patDevices = navigate(schema, [...LOGIN_TYPE_PATH, 'else', 'else', 'then', 'properties', 'devices']);

			// Act
			const items = navigate(patDevices, ['items']);
			const itemProperties = navigate(items, ['properties']);

			// Assert
			expect(childOf(patDevices, 'type')).toBe('array');
			expect(Object.keys(isRecord(itemProperties) ? itemProperties : {})).toEqual([
				'deviceId',
				'deviceType',
				'ignore',
				'productName',
				'productId',
			]);
			expect(navigate(items, ['required'])).toEqual(['deviceId']);
			expect(navigate(itemProperties, ['deviceType', 'enum'])).toEqual(['AC', 'WASHER']);
			expect(navigate(itemProperties, ['deviceType', 'readOnly'])).toBe(true);
		});

		it('should give the pat device item no capabilities, washerControl or nested dependencies', () => {
			// Arrange
			const items = navigate(schema, [...LOGIN_TYPE_PATH, 'else', 'else', 'then', 'properties', 'devices', 'items']);

			// Act
			const itemProperties = navigate(items, ['properties']);

			// Assert
			expect(isRecord(itemProperties) && 'capabilities' in itemProperties).toBe(false);
			expect(isRecord(itemProperties) && 'washerControl' in itemProperties).toBe(false);
			expect(isRecord(items) && 'dependencies' in items).toBe(false);
		});

		it.each([
			['account', ['then']],
			['token', ['else', 'then']],
		])('should keep the existing devices key in the %s branch', (_label, branchPath) => {
			// Arrange & Act
			const devices = navigate(schema, [...LOGIN_TYPE_PATH, ...branchPath, 'properties', 'devices']);

			// Assert
			expect(isRecord(devices)).toBe(true);
			expect(childOf(devices, 'type')).toBe('array');
		});
	});
});
