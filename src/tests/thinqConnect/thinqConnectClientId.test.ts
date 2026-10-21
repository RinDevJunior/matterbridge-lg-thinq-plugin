import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	loadOrCreateThinqConnectClientId,
	maskClientId,
	type ThinqConnectClientIdIo,
} from '../../thinqConnect/thinqConnectClientId.js';

const VALID_ID = 'thinq-open-11111111-2222-3333-4444-555555555555';
const CLIENT_ID_PATTERN = /^thinq-open-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('loadOrCreateThinqConnectClientId', () => {
	let tempRoot: string;
	let filePath: string;

	beforeEach(() => {
		vi.clearAllMocks();
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thinq-client-id-'));
		filePath = path.join(tempRoot, 'nested', 'thinq-connect-client-id.json');
	});

	afterEach(() => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	it('should create the file with a generated id and mode 0600 when the file is missing', () => {
		// Arrange
		// (filePath does not exist; its parent directory does not exist either)

		// Act
		const id = loadOrCreateThinqConnectClientId(filePath);

		// Assert
		expect(id).toMatch(CLIENT_ID_PATTERN);
		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
		expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ clientId: id });
	});

	it('should return the same id on a second call when the file was just created', () => {
		// Arrange
		const first = loadOrCreateThinqConnectClientId(filePath);

		// Act
		const second = loadOrCreateThinqConnectClientId(filePath);

		// Assert
		expect(second).toBe(first);
	});

	it('should reuse the stored id without rewriting the file when the file is valid', () => {
		// Arrange
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify({ clientId: VALID_ID }), 'utf8');
		const before = fs.readFileSync(filePath, 'utf8');

		// Act
		const id = loadOrCreateThinqConnectClientId(filePath);

		// Assert
		expect(id).toBe(VALID_ID);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
	});

	it.each([
		['the JSON is invalid', '{not json'],
		['the file is empty', ''],
		['the JSON is null', 'null'],
		['the clientId key is missing', JSON.stringify({ other: VALID_ID })],
		['the clientId is not a string', JSON.stringify({ clientId: 42 })],
		['the prefix is wrong', JSON.stringify({ clientId: 'other-11111111-2222-3333-4444-555555555555' })],
		['the uuid is upper case', JSON.stringify({ clientId: 'thinq-open-11111111-2222-3333-4444-55555555555A' })],
		['the uuid is too short', JSON.stringify({ clientId: 'thinq-open-1111' })],
	])('should regenerate and rewrite the file when %s', (_label, content) => {
		// Arrange
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, 'utf8');

		// Act
		const id = loadOrCreateThinqConnectClientId(filePath);

		// Assert
		expect(id).toMatch(CLIENT_ID_PATTERN);
		expect(id).not.toBe(VALID_ID);
		expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ clientId: id });
	});

	it('should throw when the file cannot be written', () => {
		// Arrange
		const io: ThinqConnectClientIdIo = {
			readFileSync: vi.fn(() => {
				throw new Error('ENOENT');
			}),
			writeFileSync: vi.fn(() => {
				throw new Error('EACCES: permission denied');
			}),
			mkdirSync: vi.fn(),
		};

		// Act
		const act = (): string => loadOrCreateThinqConnectClientId(filePath, io);

		// Assert
		expect(act).toThrow('EACCES: permission denied');
	});

	it('should throw when the directory cannot be created', () => {
		// Arrange
		const io: ThinqConnectClientIdIo = {
			readFileSync: vi.fn(() => {
				throw new Error('ENOENT');
			}),
			writeFileSync: vi.fn(),
			mkdirSync: vi.fn(() => {
				throw new Error('EROFS: read-only file system');
			}),
		};

		// Act
		const act = (): string => loadOrCreateThinqConnectClientId(filePath, io);

		// Assert
		expect(act).toThrow('EROFS: read-only file system');
		expect(io.writeFileSync).not.toHaveBeenCalled();
	});

	it('should write the generated id with mode 0600 through the injected io when the file is missing', () => {
		// Arrange
		const writeFileSync = vi.fn();
		const io: ThinqConnectClientIdIo = {
			readFileSync: vi.fn(() => {
				throw new Error('ENOENT');
			}),
			writeFileSync,
			mkdirSync: vi.fn(),
		};

		// Act
		const id = loadOrCreateThinqConnectClientId(filePath, io);

		// Assert
		expect(writeFileSync).toHaveBeenCalledWith(filePath, JSON.stringify({ clientId: id }), {
			mode: 0o600,
			encoding: 'utf8',
		});
	});
});

describe('maskClientId', () => {
	it.each([
		['thinq-open-11111111-2222-3333-4444-555555555555', '...5555'],
		['thinq-open-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '...eeee'],
		['abcd', '...abcd'],
	])('should return "..." plus the last 4 characters of %s', (id, expected) => {
		// Arrange
		const input = id;

		// Act
		const result = maskClientId(input);

		// Assert
		expect(result).toBe(expected);
	});

	it('should not contain the leading part of the id when masking', () => {
		// Arrange
		const input = VALID_ID;

		// Act
		const result = maskClientId(input);

		// Assert
		expect(result).not.toContain('thinq-open');
		expect(result).toHaveLength(7);
	});
});
