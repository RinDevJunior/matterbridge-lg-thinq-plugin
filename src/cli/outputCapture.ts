import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PAT_SESSION_FILE, SESSION_FILE } from './types.js';

export interface OutputCaptureMeta {
	readonly command: string;
	readonly country?: string;
	readonly showSecrets: boolean;
}

export interface OutputCapture {
	readonly filePath: string;
	finish(): void;
}

type WriteFn = typeof process.stdout.write;

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const HDNTS_PATTERN = /hdnts=[^&"'\s]+/g;
const FILE_MODE = 0o600;

export function resolveOutPath(rawPath: string, cwd: string = process.cwd(), home: string = os.homedir()): string {
	const trimmed = rawPath.trim();
	if (trimmed === '' || trimmed === 'true') {
		throw new Error('requires a file path');
	}

	const expanded = trimmed === '~' || trimmed.startsWith('~/') ? path.join(home, trimmed.slice(1)) : trimmed;
	const resolved = path.resolve(cwd, expanded);

	if (fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Error(`is a directory: ${resolved}`);
	}

	const sessionFiles = [SESSION_FILE, PAT_SESSION_FILE].map((file) => path.resolve(cwd, file));
	if (sessionFiles.includes(resolved)) {
		throw new Error(`refusing to overwrite the CLI session file: ${resolved}`);
	}

	return resolved;
}

export function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, '');
}

export function redactForFile(text: string): string {
	return text.replace(HDNTS_PATTERN, 'hdnts=[REDACTED]');
}

export function buildFileContent(body: string, meta: OutputCaptureMeta, now: Date = new Date()): string {
	const header = ['# lg-thinq CLI output', `# command: ${meta.command}`, `# saved: ${now.toISOString()}`];
	if (meta.country !== undefined) {
		header.push(`# country: ${meta.country}`);
	}
	header.push(`# show-secrets: ${meta.showSecrets ? 'yes' : 'no'}`, '');
	return `${header.join('\n')}\n${redactForFile(stripAnsi(body))}`;
}

function teeStream(stream: NodeJS.WriteStream, sink: string[]): () => void {
	const original: WriteFn = stream.write;
	const passThrough = original as (...args: unknown[]) => boolean;
	const wrapped = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
		sink.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
		return passThrough.apply(stream, [chunk, ...rest]);
	};
	stream.write = wrapped;
	return () => {
		stream.write = original;
	};
}

export function startOutputCapture(rawPath: string, meta: OutputCaptureMeta): OutputCapture {
	const filePath = resolveOutPath(rawPath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, '', { mode: FILE_MODE });
	fs.chmodSync(filePath, FILE_MODE);

	const chunks: string[] = [];
	const restoreStdout = teeStream(process.stdout, chunks);
	const restoreStderr = teeStream(process.stderr, chunks);
	let finished = false;

	return {
		filePath,
		finish(): void {
			if (finished) {
				return;
			}
			finished = true;
			restoreStdout();
			restoreStderr();

			try {
				fs.writeFileSync(filePath, buildFileContent(chunks.join(''), meta), { mode: FILE_MODE });
				fs.chmodSync(filePath, FILE_MODE);
				console.log(`Saved output to ${filePath}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`Could not save output to ${filePath}: ${message}`);
				if (!process.exitCode) {
					process.exitCode = 2;
				}
			}
		},
	};
}
