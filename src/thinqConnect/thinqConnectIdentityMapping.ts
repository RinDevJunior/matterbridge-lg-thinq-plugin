import fs from 'node:fs';
import path from 'node:path';

export const IDENTITY_MAPPING_FILE_NAME = 'serial-number-mapping';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SEPARATOR_PATTERN = /\s*(?:=>|->|=|:|,)\s*|\s+/;
const FILE_MODE = 0o600;
const MAX_FILE_BYTES = 64 * 1024;
const BYTE_ORDER_MARK = '﻿';

export interface IdentityMappingIo {
	readFileSync(filePath: string, encoding: 'utf8'): string;
	writeFileSync(filePath: string, data: string, options: { mode: number; encoding: 'utf8'; flag: 'wx' }): void;
	mkdirSync(dirPath: string, options: { recursive: true }): unknown;
}

export interface IdentityMappingParseResult {
	/** ThinQ Connect id -> account login (V1) id. */
	entries: Map<string, string>;
	/** One message per ignored line or unreadable file. */
	warnings: string[];
}

export interface ThinqConnectIdentityMapping {
	readonly size: number;
	/** Returns the account login id for a ThinQ Connect id and marks that entry as used. */
	legacyIdFor(connectId: string): string | undefined;
	/** ThinQ Connect ids in the file that were never looked up. */
	unmatchedConnectIds(): string[];
}

const TEMPLATE = [
	'# serial-number-mapping',
	'# Maps a ThinQ Connect (PAT) device id to the device id it had under the account login.',
	'# Keeps the Matter identity of an already-paired device, so the controller does not need a re-pair.',
	'# One device per line:  <ThinQ Connect id> = <account login id>',
	'# Lines starting with # are ignored. An empty file maps nothing.',
	'# Example (fake ids):',
	'# 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef = 11111111-2222-3333-4444-555555555555',
	'',
].join('\n');

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}

export function buildIdentityMappingTemplate(): string {
	return TEMPLATE;
}

/** Parses the mapping file text. Never throws; each bad line produces one warning and is skipped. */
export function parseIdentityMapping(text: string): IdentityMappingParseResult {
	const entries = new Map<string, string>();
	const warnings: string[] = [];
	const legacyIds = new Set<string>();
	const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;

	for (const [index, rawLine] of body.split(/\r?\n/).entries()) {
		const lineNumber = index + 1;
		const hashIndex = rawLine.indexOf('#');
		const content = (hashIndex === -1 ? rawLine : rawLine.slice(0, hashIndex)).trim();
		if (content === '') {
			continue;
		}

		const warn = (reason: string): void => {
			warnings.push(`${IDENTITY_MAPPING_FILE_NAME} line ${lineNumber} ignored: ${reason}`);
		};

		const [connectId, legacyId, extra] = content.split(SEPARATOR_PATTERN).filter((token) => token.length > 0);
		if (connectId === undefined || legacyId === undefined || extra !== undefined) {
			warn('expected "<ThinQ Connect id> = <account login id>"');
			continue;
		}
		if (!ID_PATTERN.test(connectId)) {
			warn('invalid ThinQ Connect id');
			continue;
		}
		if (!ID_PATTERN.test(legacyId)) {
			warn('invalid account login id');
			continue;
		}
		if (entries.has(connectId)) {
			warn('duplicate ThinQ Connect id');
			continue;
		}
		if (legacyIds.has(legacyId)) {
			warn('account login id already used by another entry');
			continue;
		}

		entries.set(connectId, legacyId);
		legacyIds.add(legacyId);
	}

	return { entries, warnings };
}

/** Creates the template only when the file does not exist (exclusive create, never overwrites). */
export function ensureIdentityMappingFile(filePath: string, io: IdentityMappingIo = fs): 'created' | 'exists' {
	io.mkdirSync(path.dirname(filePath), { recursive: true });
	try {
		io.writeFileSync(filePath, TEMPLATE, { mode: FILE_MODE, encoding: 'utf8', flag: 'wx' });
		return 'created';
	} catch (error) {
		if (errorCode(error) === 'EEXIST') {
			return 'exists';
		}
		throw error;
	}
}

/** Reads and parses the mapping file. A missing file is silent; any other failure yields an empty result plus one warning. */
export function loadIdentityMapping(filePath: string, io: IdentityMappingIo = fs): IdentityMappingParseResult {
	let text: string;
	try {
		text = io.readFileSync(filePath, 'utf8');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') {
			return { entries: new Map(), warnings: [] };
		}
		return {
			entries: new Map(),
			warnings: [`${IDENTITY_MAPPING_FILE_NAME} could not be read: ${errorMessage(error)}`],
		};
	}

	const bytes = Buffer.from(text, 'utf8');
	if (bytes.byteLength <= MAX_FILE_BYTES) {
		return parseIdentityMapping(text);
	}
	const parsed = parseIdentityMapping(bytes.subarray(0, MAX_FILE_BYTES).toString('utf8'));
	return {
		entries: parsed.entries,
		warnings: [
			`${IDENTITY_MAPPING_FILE_NAME} is larger than 64 KiB; only the first 64 KiB was read.`,
			...parsed.warnings,
		],
	};
}

export function createThinqConnectIdentityMapping(entries: ReadonlyMap<string, string>): ThinqConnectIdentityMapping {
	const mapping = new Map(entries);
	const used = new Set<string>();
	return {
		get size(): number {
			return mapping.size;
		},
		legacyIdFor(connectId: string): string | undefined {
			const legacyId = mapping.get(connectId);
			if (legacyId !== undefined) {
				used.add(connectId);
			}
			return legacyId;
		},
		unmatchedConnectIds(): string[] {
			return [...mapping.keys()].filter((connectId) => !used.has(connectId));
		},
	};
}
