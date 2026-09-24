import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformConfigManager } from '../../platform/platformConfigManager.js';
import { asPartial, createMockLogger, createMockNodePersist } from '../../tests/helpers/testUtils.js';
import type { ThinqUserData } from './AuthContext.js';
import { UserDataRepository } from './UserDataRepository.js';

describe('UserDataRepository', () => {
	let mockPersist: ReturnType<typeof createMockNodePersist>;
	let mockConfigManager: PlatformConfigManager;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let repository: UserDataRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPersist = createMockNodePersist();
		mockLogger = createMockLogger();
		mockConfigManager = asPartial<PlatformConfigManager>({
			country: 'US',
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		repository = new UserDataRepository(mockPersist as any, mockConfigManager, mockLogger);
	});

	describe('loadUserData', () => {
		it('should return undefined when no saved data exists', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);

			const result = await repository.loadUserData();

			expect(result).toBeUndefined();
			expect(mockPersist.getItem).toHaveBeenCalledWith('thinq:userData');
		});

		it('should return saved data when country matches config', async () => {
			const userData: ThinqUserData = {
				accessToken: 'access123',
				refreshToken: 'refresh123',
				expiresAtEpochSeconds: 9999999999,
				country: 'US',
				language: 'en',
			};

			vi.mocked(mockPersist.getItem).mockResolvedValue(userData);

			const result = await repository.loadUserData();

			expect(result).toEqual(userData);
			expect(mockPersist.removeItem).not.toHaveBeenCalled();
		});

		it('should clear and return undefined when saved country does not match config', async () => {
			const userData: ThinqUserData = {
				accessToken: 'access123',
				refreshToken: 'refresh123',
				expiresAtEpochSeconds: 9999999999,
				country: 'KR',
				language: 'ko',
			};

			vi.mocked(mockPersist.getItem).mockResolvedValue(userData);

			const result = await repository.loadUserData();

			expect(result).toBeUndefined();
			expect(mockPersist.removeItem).toHaveBeenCalledWith('thinq:userData');
		});

		it('should log debug message when no saved data found', async () => {
			vi.mocked(mockPersist.getItem).mockResolvedValue(undefined);

			await repository.loadUserData();

			expect(mockLogger.debug).toHaveBeenCalledWith('No saved ThinQ userData found');
		});

		it('should log debug message when data is returned', async () => {
			const userData: ThinqUserData = {
				accessToken: 'access123',
				refreshToken: 'refresh123',
				expiresAtEpochSeconds: 9999999999,
				country: 'US',
				language: 'en',
			};

			vi.mocked(mockPersist.getItem).mockResolvedValue(userData);

			await repository.loadUserData();

			expect(mockLogger.debug).toHaveBeenCalledWith('Loading saved ThinQ userData');
		});

		it('should log debug message when country does not match', async () => {
			const userData: ThinqUserData = {
				accessToken: 'access123',
				refreshToken: 'refresh123',
				expiresAtEpochSeconds: 9999999999,
				country: 'KR',
				language: 'ko',
			};

			vi.mocked(mockPersist.getItem).mockResolvedValue(userData);

			await repository.loadUserData();

			expect(mockLogger.debug).toHaveBeenCalledWith(
				'Saved ThinQ userData country does not match current config, ignoring saved data',
			);
		});
	});

	describe('saveUserData', () => {
		it('should persist user data to storage', async () => {
			const userData: ThinqUserData = {
				accessToken: 'access123',
				refreshToken: 'refresh123',
				expiresAtEpochSeconds: 9999999999,
				country: 'US',
				language: 'en',
			};

			await repository.saveUserData(userData);

			expect(mockPersist.setItem).toHaveBeenCalledWith('thinq:userData', userData);
		});

		it('should log debug message when data is saved', async () => {
			const userData: ThinqUserData = {
				accessToken: 'access123',
				refreshToken: 'refresh123',
				expiresAtEpochSeconds: 9999999999,
				country: 'US',
				language: 'en',
			};

			await repository.saveUserData(userData);

			expect(mockLogger.debug).toHaveBeenCalledWith('ThinQ user data saved successfully');
		});
	});

	describe('clearUserData', () => {
		it('should remove user data from storage', async () => {
			await repository.clearUserData();

			expect(mockPersist.removeItem).toHaveBeenCalledWith('thinq:userData');
		});
	});
});
