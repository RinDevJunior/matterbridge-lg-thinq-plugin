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

describe('cmdDevices', () => {
	let consoleLogSpy: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApiClient = {
			getListDevices: vi.fn(),
			setUserNumber: vi.fn(),
		};
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
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
});
