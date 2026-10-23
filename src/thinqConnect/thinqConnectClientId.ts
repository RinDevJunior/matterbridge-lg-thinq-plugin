import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_ID_PATTERN = /^thinq-open-[0-9a-f-]{36}$/;
const FILE_MODE = 0o600;

export interface ThinqConnectClientIdIo {
	readFileSync(filePath: string, encoding: 'utf8'): string;
	writeFileSync(filePath: string, data: string, options: { mode: number; encoding: 'utf8' }): void;
	mkdirSync(dirPath: string, options: { recursive: true }): unknown;
}

function readStoredId(filePath: string, io: ThinqConnectClientIdIo): string | undefined {
	try {
		const parsed: unknown = JSON.parse(io.readFileSync(filePath, 'utf8'));
		const id =
			typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['clientId'] : undefined;
		return typeof id === 'string' && CLIENT_ID_PATTERN.test(id) ? id : undefined;
	} catch {
		return undefined;
	}
}

/** Returns the persisted anonymous client id, creating it (mode 0600) when missing or invalid; throws on write failure. */
export function loadOrCreateThinqConnectClientId(filePath: string, io: ThinqConnectClientIdIo = fs): string {
	const stored = readStoredId(filePath, io);
	if (stored) {
		return stored;
	}
	const clientId = `thinq-open-${crypto.randomUUID()}`;
	io.mkdirSync(path.dirname(filePath), { recursive: true });
	io.writeFileSync(filePath, JSON.stringify({ clientId }), { mode: FILE_MODE, encoding: 'utf8' });
	return clientId;
}

export function maskClientId(id: string): string {
	return `...${id.slice(-4)}`;
}
