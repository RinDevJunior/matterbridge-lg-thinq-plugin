import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import {
	buildFileContent,
	type OutputCapture,
	redactForFile,
	resolveOutPath,
	startOutputCapture,
	stripAnsi,
} from '../../cli/outputCapture.js';
import { PAT_SESSION_FILE, SESSION_FILE } from '../../cli/types.js';

const META = { command: 'connect-probe', showSecrets: false };
const FIXED_NOW = new Date('2026-10-21T10:00:00.000Z');
const HEADER =
	'# lg-thinq CLI output\n# command: connect-probe\n# saved: 2026-10-21T10:00:00.000Z\n# show-secrets: no\n';

describe('outputCapture', () => {
	let tmpDir: string;
	let file: string;
	let capture: OutputCapture | undefined;
	let stdoutSpy: MockInstance;
	let stderrSpy: MockInstance;
	let logSpy: MockInstance;
	let errorSpy: MockInstance;

	beforeEach(() => {
		// Arrange
		vi.clearAllMocks();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-out-'));
		file = path.join(tmpDir, 'out.txt');
		capture = undefined;
		stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		// Cleanup: finish() is idempotent and restores the writers before spies are reset
		capture?.finish();
		vi.restoreAllMocks();
		process.exitCode = undefined;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe('resolveOutPath', () => {
		it('should resolve a relative path against the given cwd', () => {
			// Act
			const result = resolveOutPath('out/p.txt', tmpDir);

			// Assert
			expect(result).toBe(path.join(tmpDir, 'out', 'p.txt'));
		});

		it('should return an absolute path unchanged', () => {
			// Arrange
			const absolute = path.join(tmpDir, 'abs.txt');

			// Act
			const result = resolveOutPath(absolute, tmpDir);

			// Assert
			expect(result).toBe(absolute);
		});

		it.each([
			['~/x.txt', 'x.txt'],
			['~', ''],
		])('should expand %s against the given home directory', (rawPath, rest) => {
			// Arrange
			const home = path.join(tmpDir, 'home');

			// Act
			const result = resolveOutPath(rawPath, tmpDir, home);

			// Assert
			expect(result).toBe(path.join(home, rest));
		});

		it.each(['', '   ', 'true'])('should throw "requires a file path" when the value is %j', (rawPath) => {
			// Act & Assert
			expect(() => resolveOutPath(rawPath, tmpDir)).toThrow('requires a file path');
		});

		it('should throw "is a directory" when the target is an existing directory', () => {
			// Act & Assert
			expect(() => resolveOutPath(tmpDir, tmpDir)).toThrow('is a directory');
		});

		it.each([SESSION_FILE, PAT_SESSION_FILE])(
			'should throw "refusing to overwrite" when the target is the session file %s',
			(sessionFile) => {
				// Act & Assert
				expect(() => resolveOutPath(sessionFile, tmpDir)).toThrow('refusing to overwrite');
			},
		);
	});

	describe('stripAnsi', () => {
		it.each([
			['\x1b[1mBold\x1b[0m', 'Bold'],
			['plain text', 'plain text'],
		])('should turn %j into %j', (input, expected) => {
			// Act & Assert
			expect(stripAnsi(input)).toBe(expected);
		});
	});

	describe('redactForFile', () => {
		it.each([
			['https://x/y?hdnts=exp=1~hmac=abc', 'https://x/y?hdnts=[REDACTED]'],
			['a?hdnts=exp&b=1', 'a?hdnts=[REDACTED]&b=1'],
			['no links here', 'no links here'],
		])('should redact hdnts values in %j', (input, expected) => {
			// Act & Assert
			expect(redactForFile(input)).toBe(expected);
		});
	});

	describe('buildFileContent', () => {
		it('should write the fixed header, a blank line, then the body', () => {
			// Act
			const content = buildFileContent('body\n', META, FIXED_NOW);

			// Assert
			expect(content).toBe(`${HEADER}\nbody\n`);
		});

		it.each([
			[{ country: 'KR' }, ['# country: KR']],
			[{}, []],
		])('should write the country line only when country is given (%#)', (extra, expected) => {
			// Act
			const content = buildFileContent('x', { ...META, ...extra }, FIXED_NOW);

			// Assert
			expect(content.split('\n').filter((line) => line.startsWith('# country:'))).toEqual(expected);
		});

		it.each([
			[false, 'no'],
			[true, 'yes'],
		])('should write show-secrets %s as "%s"', (showSecrets, label) => {
			// Act
			const content = buildFileContent('', { ...META, showSecrets }, FIXED_NOW);

			// Assert
			expect(content).toContain(`# show-secrets: ${label}`);
		});

		it('should not write argv, token or PAT values into the header', () => {
			// Act
			const header = buildFileContent('', META, FIXED_NOW).split('\n\n')[0] ?? '';

			// Assert
			expect(header).not.toMatch(/argv|token|pat/i);
		});

		it('should strip ANSI and redact hdnts in the body', () => {
			// Act
			const content = buildFileContent('\x1b[32mhttps://x/y?hdnts=exp=1~hmac=abc\x1b[0m', META, FIXED_NOW);

			// Assert
			expect(content.split('\n\n')[1]).toBe('https://x/y?hdnts=[REDACTED]');
		});
	});

	describe('startOutputCapture', () => {
		it('should create parent directories and an empty 0600 file before any output', () => {
			// Arrange
			const nested = path.join(tmpDir, 'a', 'b', 'out.txt');

			// Act
			capture = startOutputCapture(nested, META);

			// Assert
			expect(capture.filePath).toBe(nested);
			expect(fs.readFileSync(nested, 'utf8')).toBe('');
			expect(fs.statSync(nested).mode & 0o777).toBe(0o600);
		});

		it('should throw and leave the writers untouched when the path is an existing directory', () => {
			// Act & Assert
			expect(() => startOutputCapture(tmpDir, META)).toThrow('is a directory');
			expect(process.stdout.write).toBe(stdoutSpy);
		});

		it('should tee stdout and stderr to the original writers and save both in order without ANSI', () => {
			// Arrange
			capture = startOutputCapture(file, META);

			// Act
			process.stdout.write('\x1b[1mhello\x1b[0m\n');
			process.stderr.write('oops\n');
			capture.finish();

			// Assert
			expect(stdoutSpy).toHaveBeenCalledWith('\x1b[1mhello\x1b[0m\n');
			expect(stderrSpy).toHaveBeenCalledWith('oops\n');
			const content = fs.readFileSync(file, 'utf8');
			expect(content.split('\n').slice(-3)).toEqual(['hello', 'oops', '']);
			expect(content).not.toContain('\x1b');
		});

		it('should capture a Buffer chunk as text', () => {
			// Arrange
			capture = startOutputCapture(file, META);

			// Act
			process.stdout.write(Buffer.from('buf\n'));
			capture.finish();

			// Assert
			expect(fs.readFileSync(file, 'utf8').endsWith('\nbuf\n')).toBe(true);
		});

		it('should restore the original writers and ignore a second finish', () => {
			// Arrange
			capture = startOutputCapture(file, META);

			// Act
			capture.finish();
			fs.writeFileSync(file, 'edited');
			capture.finish();

			// Assert
			expect(process.stdout.write).toBe(stdoutSpy);
			expect(process.stderr.write).toBe(stderrSpy);
			expect(fs.readFileSync(file, 'utf8')).toBe('edited');
			expect(logSpy).toHaveBeenCalledTimes(1);
		});

		it('should print the saved absolute path via console.log and keep that line out of the file', () => {
			// Arrange
			capture = startOutputCapture(file, META);

			// Act
			capture.finish();

			// Assert
			expect(logSpy).toHaveBeenCalledWith(`Saved output to ${file}`);
			expect(fs.readFileSync(file, 'utf8')).not.toContain('Saved output');
		});

		it('should set mode 0600 and replace old content when overwriting a 0644 file', () => {
			// Arrange
			fs.writeFileSync(file, 'old content');
			fs.chmodSync(file, 0o644);
			capture = startOutputCapture(file, META);
			process.stdout.write('new\n');

			// Act
			capture.finish();

			// Assert
			expect(fs.statSync(file).mode & 0o777).toBe(0o600);
			const content = fs.readFileSync(file, 'utf8');
			expect(content).not.toContain('old content');
			expect(content).toContain('new\n');
		});

		it('should report the failure without throwing when the write fails', () => {
			// Arrange
			capture = startOutputCapture(file, META);
			vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
				throw new Error('disk full');
			});

			// Act & Assert
			expect(() => capture?.finish()).not.toThrow();
			expect(errorSpy).toHaveBeenCalledWith(`Could not save output to ${file}: disk full`);
		});

		it.each([
			{ before: undefined, after: 2 },
			{ before: 1, after: 1 },
		])('should leave exitCode at $after when it was $before before a failed write', ({ before, after }) => {
			// Arrange
			capture = startOutputCapture(file, META);
			vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
				throw new Error('disk full');
			});
			process.exitCode = before;

			// Act
			capture.finish();

			// Assert
			expect(process.exitCode).toBe(after);
		});
	});
});
