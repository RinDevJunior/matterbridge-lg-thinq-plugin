import fs from 'node:fs';

import { CliPatSession, CliSession, PAT_SESSION_FILE, SESSION_FILE } from './types.js';

export function saveSession(session: CliSession): void {
	fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

export function loadSession(): CliSession | null {
	try {
		return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')) as CliSession;
	} catch {
		return null;
	}
}

export function savePatSession(session: CliPatSession): void {
	fs.writeFileSync(PAT_SESSION_FILE, JSON.stringify(session, null, 2));
}

export function loadPatSession(): CliPatSession | null {
	try {
		return JSON.parse(fs.readFileSync(PAT_SESSION_FILE, 'utf-8')) as CliPatSession;
	} catch {
		return null;
	}
}
