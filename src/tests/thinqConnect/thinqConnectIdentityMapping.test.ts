import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	buildIdentityMappingTemplate,
	createThinqConnectIdentityMapping,
	ensureIdentityMappingFile,
	IDENTITY_MAPPING_FILE_NAME,
	type IdentityMappingIo,
	loadIdentityMapping,
	parseIdentityMapping,
} from '../../thinqConnect/thinqConnectIdentityMapping.js';

const CONNECT_WASHER = '5d0fcc7385f6cee5844cb447762f9d36df9004d9d2115f583329a67e689b02d3';
const CONNECT_AC_STUDY = '30ed71f9b63a864466660e70077f18d5f891f743e08d8d8a66042e0d3d5fb068';
const CONNECT_AC_BEDROOM = '8cd34313580e1f42c0de5286b3afa072ce5f7ecd50f144cf6d471ec7056dc604';
const V1_WASHER = 'ee7980cc-7dba-13a4-af04-dc69cc57b6a8';
const V1_STUDY_AC = '3989736c-a07c-1e25-b609-e0854d7a7450';
const V1_BEDROOM_AC = '1071d158-7a31-4e89-a230-7c013e1ff938';

const REAL_PAIRS: [string, string][] = [
	[CONNECT_WASHER, V1_WASHER],
	[CONNECT_AC_STUDY, V1_STUDY_AC],
	[CONNECT_AC_BEDROOM, V1_BEDROOM_AC],
];

function createMockIo(overrides: Partial<IdentityMappingIo> = {}): IdentityMappingIo {
	return {
		readFileSync: vi.fn<IdentityMappingIo['readFileSync']>(),
		writeFileSync: vi.fn<IdentityMappingIo['writeFileSync']>(),
		mkdirSync: vi.fn<IdentityMappingIo['mkdirSync']>(),
		...overrides,
	};
}

function fsError(code: string, message = code): NodeJS.ErrnoException {
	return Object.assign(new Error(message), { code });
}

function pairsText(pairs: [string, string][]): string {
	return pairs.map(([connectId, legacyId]) => `${connectId} = ${legacyId}`).join('\n');
}

describe('parseIdentityMapping', () => {
	it.each([
		['spaced equals', `${CONNECT_WASHER} = ${V1_WASHER}`],
		['tight equals', `${CONNECT_WASHER}=${V1_WASHER}`],
		['arrow', `${CONNECT_WASHER} -> ${V1_WASHER}`],
		['fat arrow', `${CONNECT_WASHER} => ${V1_WASHER}`],
		['colon', `${CONNECT_WASHER}: ${V1_WASHER}`],
		['comma', `${CONNECT_WASHER}, ${V1_WASHER}`],
		['whitespace', `${CONNECT_WASHER} ${V1_WASHER}`],
		['tab', `${CONNECT_WASHER}\t${V1_WASHER}`],
	])('should map one entry when the separator is %s', (_label, line) => {
		// Arrange
		const text = line;

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map([[CONNECT_WASHER, V1_WASHER]]));
		expect(result.warnings).toEqual([]);
	});

	it('should parse the three real example pairs with no warnings when written with equals', () => {
		// Arrange
		const text = pairsText(REAL_PAIRS);

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map(REAL_PAIRS));
		expect(result.warnings).toEqual([]);
	});

	it.each([
		['a UUID ThinQ Connect id with equals', `${V1_WASHER} = ${V1_BEDROOM_AC}`],
		['a UUID ThinQ Connect id with arrow', `${V1_WASHER} -> ${V1_BEDROOM_AC}`],
	])('should keep hyphenated ids whole when the line uses %s', (_label, line) => {
		// Arrange
		const text = line;

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map([[V1_WASHER, V1_BEDROOM_AC]]));
		expect(result.warnings).toEqual([]);
	});

	it.each([
		['empty text', ''],
		['only comments', '# one\n# two'],
		['only blank lines', '\n\n   \n\t\n'],
		['the generated template', buildIdentityMappingTemplate()],
	])('should return zero entries and zero warnings when the input is %s', (_label, text) => {
		// Arrange & Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries.size).toBe(0);
		expect(result.warnings).toEqual([]);
	});

	it('should ignore full-line comments and trailing comments', () => {
		// Arrange
		const text = [`# header ${CONNECT_WASHER}`, `${CONNECT_WASHER} = ${V1_WASHER} # note`, '# trailer'].join('\n');

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map([[CONNECT_WASHER, V1_WASHER]]));
		expect(result.warnings).toEqual([]);
	});

	it('should parse CRLF line endings and a leading BOM with no warnings', () => {
		// Arrange
		const text = `\uFEFF${pairsText(REAL_PAIRS).replaceAll('\n', '\r\n')}\r\n`;

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map(REAL_PAIRS));
		expect(result.warnings).toEqual([]);
	});

	it('should trim surrounding whitespace around both ids', () => {
		// Arrange
		const text = `   ${CONNECT_WASHER}   =   ${V1_WASHER}   `;

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map([[CONNECT_WASHER, V1_WASHER]]));
		expect(result.warnings).toEqual([]);
	});

	const BAD_LINE_CASES: { label: string; line: string; reason: string }[] = [
		{
			label: 'one token only',
			line: CONNECT_WASHER,
			reason: 'expected "<ThinQ Connect id> = <account login id>"',
		},
		{
			label: 'three tokens',
			line: `${CONNECT_WASHER} = ${V1_WASHER} extra`,
			reason: 'expected "<ThinQ Connect id> = <account login id>"',
		},
		{
			label: 'an empty account login side',
			line: `${CONNECT_WASHER} =`,
			reason: 'expected "<ThinQ Connect id> = <account login id>"',
		},
		{
			label: 'invalid characters in the ThinQ Connect id',
			line: `bad!id = ${V1_WASHER}`,
			reason: 'invalid ThinQ Connect id',
		},
		{
			label: 'a slash in the ThinQ Connect id',
			line: `a/b = ${V1_WASHER}`,
			reason: 'invalid ThinQ Connect id',
		},
		{
			label: 'a ThinQ Connect id longer than 128 characters',
			line: `${'x'.repeat(129)} = ${V1_WASHER}`,
			reason: 'invalid ThinQ Connect id',
		},
		{
			label: 'invalid characters in the account login id',
			line: `${CONNECT_WASHER} = bad!id`,
			reason: 'invalid account login id',
		},
		{
			label: 'an account login id longer than 128 characters',
			line: `${CONNECT_WASHER} = ${'x'.repeat(129)}`,
			reason: 'invalid account login id',
		},
	];

	it.each(BAD_LINE_CASES)('should warn once and keep later good lines when a line has $label', ({ line, reason }) => {
		// Arrange
		const text = [`${CONNECT_AC_STUDY} = ${V1_STUDY_AC}`, line, `${CONNECT_AC_BEDROOM} = ${V1_BEDROOM_AC}`].join('\n');

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('line 2');
		expect(result.warnings[0]).toContain(reason);
		expect(result.entries).toEqual(
			new Map([
				[CONNECT_AC_STUDY, V1_STUDY_AC],
				[CONNECT_AC_BEDROOM, V1_BEDROOM_AC],
			]),
		);
	});

	it('should not echo the account login id in a warning', () => {
		// Arrange
		const text = `a/b = ${V1_WASHER}`;

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).not.toContain(V1_WASHER);
	});

	it('should keep the first entry and warn once when a ThinQ Connect id is duplicated', () => {
		// Arrange
		const text = [`${CONNECT_WASHER} = ${V1_WASHER}`, `${CONNECT_WASHER} = ${V1_BEDROOM_AC}`].join('\n');

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map([[CONNECT_WASHER, V1_WASHER]]));
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('line 2');
		expect(result.warnings[0]).toContain('duplicate ThinQ Connect id');
	});

	it('should keep the first entry and warn once when two ThinQ Connect ids map to the same account login id', () => {
		// Arrange
		const text = [`${CONNECT_WASHER} = ${V1_WASHER}`, `${CONNECT_AC_STUDY} = ${V1_WASHER}`].join('\n');

		// Act
		const result = parseIdentityMapping(text);

		// Assert
		expect(result.entries).toEqual(new Map([[CONNECT_WASHER, V1_WASHER]]));
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('line 2');
		expect(result.warnings[0]).toContain('account login id already used by another entry');
	});

	it.each([
		[
			'a random binary-like string',
			Array.from({ length: 2000 }, (_unused, i) => String.fromCharCode((i * 37) % 256)).join(''),
		],
		['a very long single line', 'a '.repeat(100_000)],
		['a long run of equals signs', '='.repeat(200_000)],
		['a NUL and control characters', '\u0000\u0001\u0007 = \u0000\r\n:,->'],
	])('should never throw for %s', (_label, text) => {
		// Arrange & Act
		const act = () => parseIdentityMapping(text);

		// Assert
		expect(act).not.toThrow();
		expect(act().entries).toBeInstanceOf(Map);
	});
});

describe('buildIdentityMappingTemplate', () => {
	it('should produce only comment lines that parse to zero entries', () => {
		// Arrange
		const template = buildIdentityMappingTemplate();

		// Act
		const nonEmptyLines = template.split('\n').filter((line) => line.trim() !== '');
		const result = parseIdentityMapping(template);

		// Assert
		expect(nonEmptyLines.every((line) => line.startsWith('#'))).toBe(true);
		expect(result.entries.size).toBe(0);
		expect(result.warnings).toEqual([]);
	});

	it.each([
		['the file name', IDENTITY_MAPPING_FILE_NAME],
		['the format hint', '<ThinQ Connect id> = <account login id>'],
	])('should contain %s', (_label, fragment) => {
		// Arrange & Act
		const template = buildIdentityMappingTemplate();

		// Assert
		expect(template).toContain(fragment);
	});

	it('should end with a newline', () => {
		// Arrange & Act
		const template = buildIdentityMappingTemplate();

		// Assert
		expect(template.endsWith('\n')).toBe(true);
	});
});

describe('ensureIdentityMappingFile', () => {
	let tempRoot: string;
	let filePath: string;

	beforeEach(() => {
		vi.clearAllMocks();
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thinq-identity-map-'));
		filePath = path.join(tempRoot, 'nested', 'deeper', IDENTITY_MAPPING_FILE_NAME);
	});

	afterEach(() => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	it('should create the template in a missing nested directory with mode 0600 when the file is missing', () => {
		// Arrange
		// (neither the file nor its parent directories exist)

		// Act
		const outcome = ensureIdentityMappingFile(filePath);

		// Assert
		expect(outcome).toBe('created');
		expect(fs.readFileSync(filePath, 'utf8')).toBe(buildIdentityMappingTemplate());
		expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
	});

	it('should leave an existing empty file untouched when the file is empty', () => {
		// Arrange
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, '', 'utf8');
		const past = new Date('2020-01-01T00:00:00Z');
		fs.utimesSync(filePath, past, past);
		const before = fs.statSync(filePath);

		// Act
		const outcome = ensureIdentityMappingFile(filePath);

		// Assert
		const after = fs.statSync(filePath);
		expect(outcome).toBe('exists');
		expect(fs.readFileSync(filePath, 'utf8')).toBe('');
		expect(after.ino).toBe(before.ino);
		expect(after.mtimeMs).toBe(past.getTime());
	});

	it('should leave an existing file with user content byte-identical when the file has content', () => {
		// Arrange
		const userContent = `${CONNECT_WASHER} = ${V1_WASHER}\r\n# my notes`;
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, userContent, 'utf8');
		const before = fs.statSync(filePath);

		// Act
		const outcome = ensureIdentityMappingFile(filePath);

		// Assert
		const after = fs.statSync(filePath);
		expect(outcome).toBe('exists');
		expect(fs.readFileSync(filePath, 'utf8')).toBe(userContent);
		expect(after.ino).toBe(before.ino);
		expect(after.mtimeMs).toBe(before.mtimeMs);
	});

	it('should return exists and keep the content when the file is ensured twice', () => {
		// Arrange
		const first = ensureIdentityMappingFile(filePath);
		const contentAfterFirst = fs.readFileSync(filePath, 'utf8');

		// Act
		const second = ensureIdentityMappingFile(filePath);

		// Assert
		expect(first).toBe('created');
		expect(second).toBe('exists');
		expect(fs.readFileSync(filePath, 'utf8')).toBe(contentAfterFirst);
	});

	it('should write the template exclusively with mode 0600 after creating the parent directory', () => {
		// Arrange
		const io = createMockIo();

		// Act
		const outcome = ensureIdentityMappingFile(filePath, io);

		// Assert
		expect(outcome).toBe('created');
		expect(io.mkdirSync).toHaveBeenCalledWith(path.dirname(filePath), { recursive: true });
		expect(io.writeFileSync).toHaveBeenCalledWith(filePath, buildIdentityMappingTemplate(), {
			mode: 0o600,
			encoding: 'utf8',
			flag: 'wx',
		});
	});

	it('should return exists when the injected write throws EEXIST', () => {
		// Arrange
		const io = createMockIo({
			writeFileSync: vi.fn<IdentityMappingIo['writeFileSync']>(() => {
				throw fsError('EEXIST');
			}),
		});

		// Act
		const outcome = ensureIdentityMappingFile(filePath, io);

		// Assert
		expect(outcome).toBe('exists');
	});

	it.each(['EACCES', 'EROFS', 'ENOSPC'])('should rethrow the error when the injected write throws %s', (code) => {
		// Arrange
		const io = createMockIo({
			writeFileSync: vi.fn<IdentityMappingIo['writeFileSync']>(() => {
				throw fsError(code, `${code} denied`);
			}),
		});

		// Act
		const act = () => ensureIdentityMappingFile(filePath, io);

		// Assert
		expect(act).toThrow(`${code} denied`);
	});

	it('should rethrow when the injected mkdir throws', () => {
		// Arrange
		const io = createMockIo({
			mkdirSync: vi.fn<IdentityMappingIo['mkdirSync']>(() => {
				throw fsError('EACCES', 'mkdir denied');
			}),
		});

		// Act
		const act = () => ensureIdentityMappingFile(filePath, io);

		// Assert
		expect(act).toThrow('mkdir denied');
	});
});

describe('loadIdentityMapping', () => {
	let tempRoot: string;
	let filePath: string;

	beforeEach(() => {
		vi.clearAllMocks();
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thinq-identity-map-'));
		filePath = path.join(tempRoot, IDENTITY_MAPPING_FILE_NAME);
	});

	afterEach(() => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	it('should return empty entries and zero warnings when the file is missing', () => {
		// Arrange
		const io = createMockIo({
			readFileSync: vi.fn<IdentityMappingIo['readFileSync']>(() => {
				throw fsError('ENOENT');
			}),
		});

		// Act
		const result = loadIdentityMapping(filePath, io);

		// Assert
		expect(result.entries.size).toBe(0);
		expect(result.warnings).toEqual([]);
	});

	it.each(['EACCES', 'EISDIR', 'EIO'])(
		'should return empty entries and exactly one warning when the read fails with %s',
		(code) => {
			// Arrange
			const io = createMockIo({
				readFileSync: vi.fn<IdentityMappingIo['readFileSync']>(() => {
					throw fsError(code, `${code} read failed`);
				}),
			});

			// Act
			const result = loadIdentityMapping(filePath, io);

			// Assert
			expect(result.entries.size).toBe(0);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain(`${code} read failed`);
		},
	);

	it('should return the same entries as parseIdentityMapping when the file is valid', () => {
		// Arrange
		const text = `# header\n${pairsText(REAL_PAIRS)}\n`;
		fs.writeFileSync(filePath, text, 'utf8');

		// Act
		const result = loadIdentityMapping(filePath);

		// Assert
		expect(result).toEqual(parseIdentityMapping(text));
		expect(result.entries).toEqual(new Map(REAL_PAIRS));
	});

	it('should never throw and should report warnings for garbage content', () => {
		// Arrange
		const io = createMockIo({
			readFileSync: vi.fn<IdentityMappingIo['readFileSync']>(() => '\u0000\u0001 = = , :: �'.repeat(500)),
		});

		// Act
		const act = () => loadIdentityMapping(filePath, io);

		// Assert
		expect(act).not.toThrow();
		expect(act().entries.size).toBe(0);
	});

	it('should read the file as utf8 through the injected io', () => {
		// Arrange
		const io = createMockIo({
			readFileSync: vi.fn<IdentityMappingIo['readFileSync']>(() => ''),
		});

		// Act
		loadIdentityMapping(filePath, io);

		// Assert
		expect(vi.mocked(io.readFileSync).mock.calls).toEqual([[filePath, 'utf8']]);
	});

	it('should parse only the first 64 KiB and report one size warning when the file is larger', () => {
		// Arrange
		// 3640 lines of 18 bytes = 65520 bytes; a 16-byte comment line ends exactly at 65536 bytes.
		const fittingLines = Array.from(
			{ length: 3640 },
			(_unused, index) => `c${String(index).padStart(6, '0')} = v${String(index).padStart(6, '0')}`,
		);
		const filler = `#${'x'.repeat(14)}`;
		const overflowLines = ['c999991 = v999991', 'c999992 = v999992'];
		const text = [...fittingLines, filler, ...overflowLines].join('\n');
		const io = createMockIo({
			readFileSync: vi.fn<IdentityMappingIo['readFileSync']>(() => text),
		});

		// Act
		const result = loadIdentityMapping(filePath, io);

		// Assert
		expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(64 * 1024);
		expect(result.entries.size).toBe(3640);
		expect(result.entries.has('c003639')).toBe(true);
		expect(result.entries.has('c999991')).toBe(false);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('64 KiB');
	});
});

describe('createThinqConnectIdentityMapping', () => {
	it('should report the entry count and the account login id for a known ThinQ Connect id', () => {
		// Arrange
		const mapping = createThinqConnectIdentityMapping(new Map(REAL_PAIRS));

		// Act
		const size = mapping.size;
		const legacyId = mapping.legacyIdFor(CONNECT_WASHER);

		// Assert
		expect(size).toBe(3);
		expect(legacyId).toBe(V1_WASHER);
	});

	it('should return undefined when the ThinQ Connect id is unknown', () => {
		// Arrange
		const mapping = createThinqConnectIdentityMapping(new Map(REAL_PAIRS));

		// Act
		const legacyId = mapping.legacyIdFor('unknown-device');

		// Assert
		expect(legacyId).toBeUndefined();
	});

	it('should list every entry in file order when nothing was looked up', () => {
		// Arrange
		const mapping = createThinqConnectIdentityMapping(new Map(REAL_PAIRS));

		// Act
		const unmatched = mapping.unmatchedConnectIds();

		// Assert
		expect(unmatched).toEqual([CONNECT_WASHER, CONNECT_AC_STUDY, CONNECT_AC_BEDROOM]);
	});

	it('should drop an entry from the unmatched list after its id was looked up', () => {
		// Arrange
		const mapping = createThinqConnectIdentityMapping(new Map(REAL_PAIRS));

		// Act
		mapping.legacyIdFor(CONNECT_AC_STUDY);
		const unmatched = mapping.unmatchedConnectIds();

		// Assert
		expect(unmatched).toEqual([CONNECT_WASHER, CONNECT_AC_BEDROOM]);
	});

	it('should keep the unmatched list unchanged when an unknown id is looked up', () => {
		// Arrange
		const mapping = createThinqConnectIdentityMapping(new Map(REAL_PAIRS));
		const before = mapping.unmatchedConnectIds();

		// Act
		mapping.legacyIdFor('not-in-the-file');

		// Assert
		expect(mapping.unmatchedConnectIds()).toEqual(before);
	});

	it('should report size 0 and an empty unmatched list when the map is empty', () => {
		// Arrange
		const mapping = createThinqConnectIdentityMapping(new Map());

		// Act & Assert
		expect(mapping.size).toBe(0);
		expect(mapping.unmatchedConnectIds()).toEqual([]);
	});
});
