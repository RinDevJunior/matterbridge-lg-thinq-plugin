import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThinqSession } from './session.js';

describe('ThinqSession', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('constructor and getters', () => {
		it('should set accessToken getter to provided value', () => {
			const session = new ThinqSession('access123', 'refresh456', 1600000000);

			expect(session.accessToken).toBe('access123');
		});

		it('should set refreshToken getter to provided value', () => {
			const session = new ThinqSession('access123', 'refresh456', 1600000000);

			expect(session.refreshToken).toBe('refresh456');
		});

		it('should set expiresAtEpochSeconds getter to provided value', () => {
			const session = new ThinqSession('access123', 'refresh456', 1600000000);

			expect(session.expiresAtEpochSeconds).toBe(1600000000);
		});
	});

	describe('hasToken', () => {
		it('should return true for non-empty accessToken', () => {
			const session = new ThinqSession('access123', 'refresh456', 1600000000);

			expect(session.hasToken()).toBe(true);
		});

		it('should return false for empty accessToken', () => {
			const session = new ThinqSession('', 'refresh456', 1600000000);

			expect(session.hasToken()).toBe(false);
		});
	});

	describe('isExpired', () => {
		it('should return true when expiresAtEpochSeconds is in the past', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// Set expiry to 1 hour ago
			const expiredTime = Math.round((now - 3600000) / 1000);
			const session = new ThinqSession('access123', 'refresh456', expiredTime);

			expect(session.isExpired()).toBe(true);

			vi.useRealTimers();
		});

		it('should return false when expiresAtEpochSeconds is in the future', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// Set expiry to 1 hour in the future
			const futureTime = Math.round((now + 3600000) / 1000);
			const session = new ThinqSession('access123', 'refresh456', futureTime);

			expect(session.isExpired()).toBe(false);

			vi.useRealTimers();
		});

		it('should return false when expiresAtEpochSeconds equals current time', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// Set expiry to exactly now (boundary condition: equal means not expired)
			const currentTime = Math.round(now / 1000);
			const session = new ThinqSession('access123', 'refresh456', currentTime);

			expect(session.isExpired()).toBe(false);

			vi.useRealTimers();
		});
	});

	describe('hasValidToken', () => {
		it('should return true only when token exists and is not expired', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// Valid: has token and not expired
			const futureTime = Math.round((now + 3600000) / 1000);
			const session = new ThinqSession('access123', 'refresh456', futureTime);

			expect(session.hasValidToken()).toBe(true);

			vi.useRealTimers();
		});

		it('should return false when token is empty but not expired', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// No token: empty accessToken and not expired
			const futureTime = Math.round((now + 3600000) / 1000);
			const session = new ThinqSession('', 'refresh456', futureTime);

			expect(session.hasValidToken()).toBe(false);

			vi.useRealTimers();
		});

		it('should return false when token exists but is expired', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// Expired: has token but is expired
			const pastTime = Math.round((now - 3600000) / 1000);
			const session = new ThinqSession('access123', 'refresh456', pastTime);

			expect(session.hasValidToken()).toBe(false);

			vi.useRealTimers();
		});

		it('should return false when token is empty and expired', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			// Both invalid: empty accessToken and expired
			const pastTime = Math.round((now - 3600000) / 1000);
			const session = new ThinqSession('', 'refresh456', pastTime);

			expect(session.hasValidToken()).toBe(false);

			vi.useRealTimers();
		});
	});

	describe('updateAccessToken', () => {
		it('should update accessToken and expiresAtEpochSeconds in place', () => {
			const session = new ThinqSession('old-access', 'refresh456', 1600000000);
			const originalRefreshToken = session.refreshToken;

			session.updateAccessToken('new-access', 1700000000);

			expect(session.accessToken).toBe('new-access');
			expect(session.expiresAtEpochSeconds).toBe(1700000000);
			expect(session.refreshToken).toBe(originalRefreshToken);
		});

		it('should not change refreshToken when updating accessToken', () => {
			const session = new ThinqSession('old-access', 'original-refresh', 1600000000);

			session.updateAccessToken('new-access', 1700000000);

			expect(session.refreshToken).toBe('original-refresh');
		});

		it('should allow multiple updates', () => {
			const session = new ThinqSession('access1', 'refresh456', 1600000000);

			session.updateAccessToken('access2', 1650000000);
			expect(session.accessToken).toBe('access2');
			expect(session.expiresAtEpochSeconds).toBe(1650000000);

			session.updateAccessToken('access3', 1700000000);
			expect(session.accessToken).toBe('access3');
			expect(session.expiresAtEpochSeconds).toBe(1700000000);
		});
	});

	describe('expiryFromExpiresIn', () => {
		it('should return current epoch seconds plus expiresIn seconds', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			const currentEpochSeconds = Math.round(now / 1000);
			const expiresIn = 3600; // 1 hour

			const result = ThinqSession.expiryFromExpiresIn(expiresIn);

			expect(result).toBe(currentEpochSeconds + expiresIn);

			vi.useRealTimers();
		});

		it('should handle zero expiresIn', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			const currentEpochSeconds = Math.round(now / 1000);

			const result = ThinqSession.expiryFromExpiresIn(0);

			expect(result).toBe(currentEpochSeconds);

			vi.useRealTimers();
		});

		it('should handle negative expiresIn', () => {
			vi.useFakeTimers();
			const now = new Date('2025-01-01T00:00:00Z').getTime();
			vi.setSystemTime(now);

			const currentEpochSeconds = Math.round(now / 1000);
			const expiresIn = -3600; // 1 hour in the past

			const result = ThinqSession.expiryFromExpiresIn(expiresIn);

			expect(result).toBe(currentEpochSeconds + expiresIn);

			vi.useRealTimers();
		});
	});

	describe('toData', () => {
		it('should return an object with all three fields', () => {
			const session = new ThinqSession('access123', 'refresh456', 1600000000);

			const data = session.toData();

			expect(data).toEqual({
				accessToken: 'access123',
				refreshToken: 'refresh456',
				expiresAtEpochSeconds: 1600000000,
			});
		});

		it('should return current field values even after update', () => {
			const session = new ThinqSession('old-access', 'refresh456', 1600000000);
			session.updateAccessToken('new-access', 1700000000);

			const data = session.toData();

			expect(data).toEqual({
				accessToken: 'new-access',
				refreshToken: 'refresh456',
				expiresAtEpochSeconds: 1700000000,
			});
		});
	});

	describe('fromData', () => {
		it('should construct a new ThinqSession from ThinqSessionData', () => {
			const data = {
				accessToken: 'access123',
				refreshToken: 'refresh456',
				expiresAtEpochSeconds: 1600000000,
			};

			const session = ThinqSession.fromData(data);

			expect(session.accessToken).toBe('access123');
			expect(session.refreshToken).toBe('refresh456');
			expect(session.expiresAtEpochSeconds).toBe(1600000000);
		});

		it('should round-trip correctly: toData -> fromData produces equivalent session', () => {
			const original = new ThinqSession('access123', 'refresh456', 1600000000);
			const data = original.toData();
			const restored = ThinqSession.fromData(data);

			expect(restored.accessToken).toBe(original.accessToken);
			expect(restored.refreshToken).toBe(original.refreshToken);
			expect(restored.expiresAtEpochSeconds).toBe(original.expiresAtEpochSeconds);
			expect(restored.hasToken()).toBe(original.hasToken());
		});

		it('should handle empty accessToken in round-trip', () => {
			const original = new ThinqSession('', 'refresh456', 1600000000);
			const data = original.toData();
			const restored = ThinqSession.fromData(data);

			expect(restored.hasToken()).toBe(false);
			expect(restored.refreshToken).toBe('refresh456');
		});
	});
});
