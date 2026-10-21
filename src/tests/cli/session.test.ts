import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs before importing saveSession
vi.mock('node:fs');

import fs from 'node:fs';

import { loadPatSession, loadSession, savePatSession, saveSession } from '../../cli/session.js';
import type { CliPatSession, CliSession } from '../../cli/types.js';

describe('saveSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should write session to .cli-session.json with correct structure', () => {
		// Arrange
		const mockSession: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'a',
				refreshToken: 'b',
				expiresAtEpochSeconds: 0,
				country: 'US',
				language: 'en-US',
			},
		};

		// Act
		saveSession(mockSession);

		// Assert
		expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(fs.writeFileSync).mock.calls[0];
		expect(callArgs[0]).toBe('.cli-session.json');

		// Verify the second argument is valid JSON that matches the session
		const writtenJson = callArgs[1] as string;
		const parsedSession = JSON.parse(writtenJson);
		expect(parsedSession).toEqual(mockSession);
	});

	it('should write session with token login type', () => {
		// Arrange
		const mockSession: CliSession = {
			loginType: 'token',
			country: 'KR',
			language: 'ko-KR',
			userData: {
				accessToken: 'token123',
				refreshToken: 'refresh456',
				expiresAtEpochSeconds: 1234567890,
				country: 'KR',
				language: 'ko-KR',
			},
		};

		// Act
		saveSession(mockSession);

		// Assert
		expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
		const callArgs = vi.mocked(fs.writeFileSync).mock.calls[0];
		const writtenJson = callArgs[1] as string;
		const parsedSession = JSON.parse(writtenJson);
		expect(parsedSession.loginType).toBe('token');
		expect(parsedSession.country).toBe('KR');
		expect(parsedSession.language).toBe('ko-KR');
	});

	it('should format JSON with proper indentation', () => {
		// Arrange
		const mockSession: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'a',
				refreshToken: 'b',
				expiresAtEpochSeconds: 0,
				country: 'US',
				language: 'en-US',
			},
		};

		// Act
		saveSession(mockSession);

		// Assert
		const callArgs = vi.mocked(fs.writeFileSync).mock.calls[0];
		const writtenJson = callArgs[1] as string;

		// Check that the JSON is formatted with 2-space indentation
		expect(writtenJson).toContain('\n');
		expect(writtenJson).toContain('  ');
		// Verify it's valid JSON
		const parsed = JSON.parse(writtenJson);
		expect(parsed).toBeDefined();
	});

	it('should write all session fields correctly', () => {
		// Arrange
		const mockSession: CliSession = {
			loginType: 'account',
			country: 'GB',
			language: 'en-GB',
			userData: {
				accessToken: 'access123',
				refreshToken: 'refresh789',
				expiresAtEpochSeconds: 1609459200,
				country: 'GB',
				language: 'en-GB',
			},
		};

		// Act
		saveSession(mockSession);

		// Assert
		const callArgs = vi.mocked(fs.writeFileSync).mock.calls[0];
		const writtenJson = callArgs[1] as string;
		const parsedSession = JSON.parse(writtenJson);

		expect(parsedSession.loginType).toBe('account');
		expect(parsedSession.country).toBe('GB');
		expect(parsedSession.language).toBe('en-GB');
		expect(parsedSession.userData.accessToken).toBe('access123');
		expect(parsedSession.userData.refreshToken).toBe('refresh789');
		expect(parsedSession.userData.expiresAtEpochSeconds).toBe(1609459200);
		expect(parsedSession.userData.country).toBe('GB');
		expect(parsedSession.userData.language).toBe('en-GB');
	});
});

describe('loadSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should return parsed CliSession when file exists and contains valid JSON', () => {
		// Arrange
		const mockSession: CliSession = {
			loginType: 'account',
			country: 'US',
			language: 'en-US',
			userData: {
				accessToken: 'token123',
				refreshToken: 'refresh456',
				expiresAtEpochSeconds: 1609459200,
				country: 'US',
				language: 'en-US',
			},
		};
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSession));

		// Act
		const result = loadSession();

		// Assert
		expect(result).toEqual(mockSession);
		expect(fs.readFileSync).toHaveBeenCalledWith('.cli-session.json', 'utf-8');
	});

	it('should return null when file does not exist', () => {
		// Arrange
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			const err = new Error('ENOENT: no such file or directory');
			throw err;
		});

		// Act
		const result = loadSession();

		// Assert
		expect(result).toBeNull();
	});

	it('should return null when file contains invalid JSON', () => {
		// Arrange
		vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

		// Act
		const result = loadSession();

		// Assert
		expect(result).toBeNull();
	});
});

describe('savePatSession', () => {
	const mockPatSession: CliPatSession = {
		country: 'US',
		personalAccessToken: 'pat-secret-1234567890',
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should write the PAT session to .cli-pat-session.json', () => {
		// Arrange
		// (mockPatSession prepared above)

		// Act
		savePatSession(mockPatSession);

		// Assert
		expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe('.cli-pat-session.json');
	});

	it('should write the PAT session as 2-space indented JSON', () => {
		// Arrange
		const expectedJson = JSON.stringify(mockPatSession, null, 2);

		// Act
		savePatSession(mockPatSession);

		// Assert
		expect(vi.mocked(fs.writeFileSync).mock.calls[0][1]).toBe(expectedJson);
	});

	it('should not write to the EMP session file', () => {
		// Arrange
		// (mockPatSession prepared above)

		// Act
		savePatSession(mockPatSession);

		// Assert
		expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalledWith('.cli-session.json', expect.anything());
	});
});

describe('loadPatSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should round-trip the saved PAT session through the file', () => {
		// Arrange
		const mockPatSession: CliPatSession = {
			country: 'KR',
			personalAccessToken: 'pat-secret-1234567890',
		};
		let stored = '';
		vi.mocked(fs.writeFileSync).mockImplementation((_path, data) => {
			stored = typeof data === 'string' ? data : '';
		});
		vi.mocked(fs.readFileSync).mockImplementation(() => stored);

		// Act
		savePatSession(mockPatSession);
		const result = loadPatSession();

		// Assert
		expect(result).toEqual(mockPatSession);
		expect(fs.readFileSync).toHaveBeenCalledWith('.cli-pat-session.json', 'utf-8');
	});

	it('should return null when the PAT session file cannot be read', () => {
		// Arrange
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			throw new Error('ENOENT: no such file or directory');
		});

		// Act
		const result = loadPatSession();

		// Assert
		expect(result).toBeNull();
	});

	it('should not read the EMP session file', () => {
		// Arrange
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			throw new Error('ENOENT: no such file or directory');
		});

		// Act
		loadPatSession();

		// Assert
		expect(vi.mocked(fs.readFileSync)).not.toHaveBeenCalledWith('.cli-session.json', expect.anything());
	});
});
