import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockApiClient: any;

vi.mock('../../../core/domain/entities/ThinqDevice.js', () => ({
	toThinqDevice: vi.fn((raw: any) => ({
		name: raw.alias,
		id: raw.deviceId,
		type: raw.deviceType,
		platformType: raw.platformType,
		modelName: raw.modelName,
		online: raw.online,
	})),
}));

vi.mock('../../../services/thinq/session.js', () => ({
	ThinqSession: vi.fn(function () {
		return {};
	}),
}));

vi.mock('../../../services/thinq/thinqApiClient.js', () => ({
	ThinqApiClient: vi.fn(function () {
		if (!mockApiClient) {
			mockApiClient = {
				getListDevices: vi.fn(),
				setUserNumber: vi.fn(),
			};
		}
		return mockApiClient;
	}),
}));

import { cmdDevices } from '../../../cli/commands/devices.js';
import type { CliSession } from '../../../cli/types.js';
import { toThinqDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { ThinqSession } from '../../../services/thinq/session.js';
import { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

describe('cmdDevices', () => {
	let consoleLogSpy: any;
	let consoleErrorSpy: MockInstance<typeof console.error>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApiClient = {
			getListDevices: vi.fn(),
			setUserNumber: vi.fn(),
		};
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		process.exitCode = undefined;
	});

	it('should call setUserNumber when userData.userNumber is set', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
				userNumber: '12345',
			},
		};
		mockApiClient.getListDevices.mockResolvedValue([]);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(mockApiClient.setUserNumber).toHaveBeenCalledWith('12345');
	});

	it('should not call setUserNumber when userData.userNumber is undefined', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		mockApiClient.getListDevices.mockResolvedValue([]);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(mockApiClient.setUserNumber).not.toHaveBeenCalled();
	});

	it('should print "No devices found." when getListDevices returns empty array', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		mockApiClient.getListDevices.mockResolvedValue([]);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith('No devices found.');
	});

	it('should print device count for multiple devices', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		const rawDevices = [
			{ deviceId: '123', alias: 'Device1', deviceType: 401, platformType: 'THINQ', modelName: 'Model1', online: true },
			{ deviceId: '456', alias: 'Device2', deviceType: 401, modelName: 'Model2', online: false },
		];
		mockApiClient.getListDevices.mockResolvedValue(rawDevices);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith('Found 2 device(s):\n');
	});

	it('should print device details with platformType when present', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		const rawDevices = [
			{
				deviceId: '123',
				alias: 'Living Room AC',
				deviceType: 401,
				platformType: 'THINQ',
				modelName: 'Model1',
				online: true,
			},
		];
		mockApiClient.getListDevices.mockResolvedValue(rawDevices);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith('1. Living Room AC');
		expect(consoleLogSpy).toHaveBeenCalledWith('   Platform Type: THINQ');
	});

	it('should print "unknown" when platformType is undefined', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		const rawDevices = [{ deviceId: '123', alias: 'Device', deviceType: 401, modelName: 'Model1', online: true }];
		mockApiClient.getListDevices.mockResolvedValue(rawDevices);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith('   Platform Type: unknown');
	});

	it('should call toThinqDevice for each raw device', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		const rawDevices = [
			{ deviceId: '123', alias: 'Device1', deviceType: 401, modelName: 'Model1', online: true },
			{ deviceId: '456', alias: 'Device2', deviceType: 402, modelName: 'Model2', online: false },
		];
		mockApiClient.getListDevices.mockResolvedValue(rawDevices);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(toThinqDevice).toHaveBeenCalledTimes(2);
	});

	it('should construct ThinqApiClient with correct parameters', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'KR',
			language: 'ko-KR',
			userData: {
				accessToken: 'access_token',
				refreshToken: 'refresh_token',
				expiresAtEpochSeconds: 123456,
				country: 'KR',
				language: 'ko-KR',
			},
		};
		mockApiClient.getListDevices.mockResolvedValue([]);
		const mockLogger = {} as any;

		// Act
		await cmdDevices(session, mockLogger);

		// Assert
		expect(ThinqSession).toHaveBeenCalledWith('access_token', 'refresh_token', 123456);
		expect(ThinqApiClient).toHaveBeenCalledWith(expect.any(Object), 'KR', 'ko-KR', mockLogger);
	});

	it('should print device numbers starting from 1', async () => {
		// Arrange
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token',
				refreshToken: 'refresh',
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		const rawDevices = [
			{ deviceId: '1', alias: 'Device1', deviceType: 401, modelName: 'Model1', online: true },
			{ deviceId: '2', alias: 'Device2', deviceType: 402, modelName: 'Model2', online: false },
			{ deviceId: '3', alias: 'Device3', deviceType: 403, modelName: 'Model3', online: true },
		];
		mockApiClient.getListDevices.mockResolvedValue(rawDevices);

		// Act
		await cmdDevices(session, {} as any);

		// Assert
		expect(consoleLogSpy).toHaveBeenCalledWith('1. Device1');
		expect(consoleLogSpy).toHaveBeenCalledWith('2. Device2');
		expect(consoleLogSpy).toHaveBeenCalledWith('3. Device3');
	});

	describe('--dump-device', () => {
		let mockLogger: ReturnType<typeof createMockLogger>;
		beforeEach(() => {
			mockLogger = createMockLogger();
		});
		const SESSION_ACCESS_TOKEN = 'session-access-token-xyz';
		const SESSION_REFRESH_TOKEN = 'session-refresh-token-xyz';
		const session: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: SESSION_ACCESS_TOKEN,
				refreshToken: SESSION_REFRESH_TOKEN,
				expiresAtEpochSeconds: 123,
				country: 'US',
				language: 'en-US',
			},
		};
		const RAW_ENTRY = {
			deviceId: 'dev-1',
			alias: 'Washer',
			deviceType: 201,
			modelName: 'WM-1',
			online: true,
			extraField: 'extra-value',
			serialNo: 'SN1234567890AB12',
			macAddress: 'AABBCCDDEEFF',
			accessToken: 'fake-entry-token-value',
		};

		it('should print the raw entry as JSON with serial and MAC masked when showSecrets is false', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger, undefined, undefined, { dumpDeviceId: 'dev-1' });

			// Assert
			const printed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
			expect(printed).toEqual({
				...RAW_ENTRY,
				serialNo: '************AB12',
				macAddress: '********EEFF',
				accessToken: '[REDACTED]',
			});
			expect(printed.extraField).toBe('extra-value');
		});

		it('should print serial and MAC in full but redact the token when showSecrets is true', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger, undefined, undefined, { dumpDeviceId: 'dev-1', showSecrets: true });

			// Assert
			const printed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
			expect(printed.serialNo).toBe('SN1234567890AB12');
			expect(printed.macAddress).toBe('AABBCCDDEEFF');
			expect(printed.accessToken).toBe('[REDACTED]');
		});

		it('should print Device not found and set exitCode 1 without printing when the id is not in the list', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger, undefined, undefined, { dumpDeviceId: 'missing-id' });

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Device not found: missing-id');
			expect(process.exitCode).toBe(1);
			expect(consoleLogSpy).not.toHaveBeenCalled();
		});

		it('should call getListDevices once and never call toThinqDevice when dumping a device', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger, undefined, undefined, { dumpDeviceId: 'dev-1' });

			// Assert
			expect(mockApiClient.getListDevices).toHaveBeenCalledTimes(1);
			expect(toThinqDevice).not.toHaveBeenCalled();
		});

		it('should print the dumped raw entry instead of the snapshot when both dump ids are given', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger, 'dev-1', undefined, { dumpDeviceId: 'dev-1' });

			// Assert
			const printed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
			expect(printed.extraField).toBe('extra-value');
			expect(toThinqDevice).not.toHaveBeenCalled();
		});

		it('should print the device list unchanged when no dump options are given', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger);

			// Assert
			expect(consoleLogSpy).toHaveBeenCalledWith('Found 1 device(s):\n');
			expect(consoleLogSpy).toHaveBeenCalledWith('1. Washer');
		});

		it('should print the snapshot raw JSON when only dumpSnapshotDeviceId is given', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);
			vi.mocked(toThinqDevice).mockReturnValueOnce(
				asPartial<ReturnType<typeof toThinqDevice>>({
					id: 'dev-1',
					snapshot: asPartial<ReturnType<typeof toThinqDevice>['snapshot']>({ raw: { state: 'on' } }),
				}),
			);

			// Act
			await cmdDevices(session, mockLogger, 'dev-1');

			// Assert
			expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify({ state: 'on' }, null, 2));
		});

		it('should never print the session access or refresh token when dumping a device', async () => {
			// Arrange
			mockApiClient.getListDevices.mockResolvedValue([RAW_ENTRY]);

			// Act
			await cmdDevices(session, mockLogger, undefined, undefined, { dumpDeviceId: 'dev-1', showSecrets: true });

			// Assert
			const output = JSON.stringify([...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]);
			expect(output).not.toContain(SESSION_ACCESS_TOKEN);
			expect(output).not.toContain(SESSION_REFRESH_TOKEN);
		});
	});
});
