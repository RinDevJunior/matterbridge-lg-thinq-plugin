import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock readline before importing prompt
vi.mock('node:readline');

import readline from 'node:readline';

import { maskSecret, parseArgs, prompt } from '../../cli/utils.js';

describe('parseArgs', () => {
	it('should parse a single --command argument', () => {
		const result = parseArgs(['--command', 'login']);
		expect(result).toEqual({ command: 'login' });
	});

	it('should parse multiple arguments', () => {
		const result = parseArgs(['--command', 'login', '--type', 'token']);
		expect(result).toEqual({ command: 'login', type: 'token' });
	});

	it('should treat a boolean flag with no following value as "true"', () => {
		const result = parseArgs(['--debug']);
		expect(result).toEqual({ debug: 'true' });
	});

	it('should treat a boolean flag followed by another flag as "true"', () => {
		const result = parseArgs(['--debug', '--help']);
		expect(result).toEqual({ debug: 'true', help: 'true' });
	});

	it('should return empty object for empty array', () => {
		const result = parseArgs([]);
		expect(result).toEqual({});
	});

	it('should ignore args not starting with -- at position 0', () => {
		const result = parseArgs(['login', '--command', 'login']);
		expect(result).toEqual({ command: 'login' });
	});

	it('should handle multiple flags and values together', () => {
		const result = parseArgs(['--command', 'login', '--country', 'US', '--debug']);
		expect(result).toEqual({ command: 'login', country: 'US', debug: 'true' });
	});

	it('should ignore non-flag arguments that are not following a flag', () => {
		const result = parseArgs(['--type', 'account', 'extra', '--debug']);
		expect(result).toEqual({ type: 'account', debug: 'true' });
	});
});

describe('maskSecret', () => {
	it('should return empty string for undefined', () => {
		const result = maskSecret(undefined);
		expect(result).toBe('');
	});

	it('should return empty string for empty string', () => {
		const result = maskSecret('');
		expect(result).toBe('');
	});

	it('should fully mask values shorter than or equal to visibleChars', () => {
		const result = maskSecret('abc');
		expect(result).toBe('***');
		expect(result.length).toBe(3);
	});

	it('should mask value with default visibleChars=4', () => {
		const result = maskSecret('abcdefgh1234');
		expect(result).toBe('********1234');
		expect(result.length).toBe(12);
	});

	it('should mask value with custom visibleChars', () => {
		const result = maskSecret('abcdefgh', 2);
		expect(result).toBe('******gh');
		expect(result.length).toBe(8);
	});

	it('should preserve the last visibleChars characters', () => {
		const secret = 'mytoken123456789';
		const result = maskSecret(secret, 4);
		expect(result).toBe('************6789');
		expect(result.endsWith('6789')).toBe(true);
	});

	it('should have the same length as the original value', () => {
		const secret = 'verylongsecrettoken1234567890';
		const result = maskSecret(secret, 4);
		expect(result.length).toBe(secret.length);
	});

	it('should contain only asterisks and the visible chars suffix', () => {
		const secret = 'abcdefghijklmnopqrstuvwxyz1234';
		const result = maskSecret(secret, 4);
		const prefix = result.slice(0, -4);
		expect(prefix).toBe('*'.repeat(secret.length - 4));
		expect(result.slice(-4)).toBe('1234');
	});

	it('should mask a realistic token', () => {
		const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0';
		const result = maskSecret(token, 4);
		// Check that the result only contains asterisks and the last 4 chars
		expect(result.slice(0, -4)).toBe('*'.repeat(token.length - 4));
		expect(result.slice(-4)).toBe(token.slice(-4));
		// Ensure no substring of the original (except suffix) is present
		const maskedPart = result.slice(0, -4);
		const originalPrefix = token.slice(0, -4);
		expect(maskedPart).not.toBe(originalPrefix);
		expect(maskedPart).toBe('*'.repeat(maskedPart.length));
	});

	it('should handle single character correctly', () => {
		const result = maskSecret('a');
		expect(result).toBe('*');
	});

	it('should handle exactly visibleChars length', () => {
		const result = maskSecret('abcd', 4);
		expect(result).toBe('****');
	});
});

describe('prompt', () => {
	let mockReadline: any;

	beforeEach(() => {
		vi.clearAllMocks();
		// Setup mock readline interface
		mockReadline = {
			question: vi.fn((question: string, callback: (answer: string) => void) => {
				callback('  typed answer  ');
			}),
			close: vi.fn(),
		};

		// Mock the createInterface function to return our mock readline
		vi.mocked(readline.createInterface).mockReturnValue(mockReadline as any);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should return trimmed answer from prompt', async () => {
		// Act
		const result = await prompt('Username: ');

		// Assert
		expect(result).toBe('typed answer');
	});

	it('should call close on readline interface', async () => {
		// Act
		await prompt('Password: ');

		// Assert
		expect(mockReadline.close).toHaveBeenCalled();
	});

	it('should call createInterface with stdin and stdout', async () => {
		// Act
		await prompt('Test question: ');

		// Assert
		expect(readline.createInterface).toHaveBeenCalledWith({
			input: process.stdin,
			output: process.stdout,
		});
	});

	it('should pass the question to readline.question', async () => {
		// Act
		await prompt('Custom prompt: ');

		// Assert
		expect(mockReadline.question).toHaveBeenCalledWith('Custom prompt: ', expect.any(Function));
	});

	it('should trim whitespace from answer', async () => {
		// Arrange
		mockReadline.question.mockImplementation((question: string, callback: (answer: string) => void) => {
			callback('   spaces   around   ');
		});

		// Act
		const result = await prompt('Input: ');

		// Assert
		expect(result).toBe('spaces   around');
	});
});
