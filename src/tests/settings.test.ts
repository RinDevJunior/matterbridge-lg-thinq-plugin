import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENGINES, PLUGIN_NAME, PLUGIN_URL, PLUGIN_VERSION } from '../settings.js';

describe('settings', () => {
	it('should export PLUGIN_NAME matching package.json name', () => {
		const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
		expect(PLUGIN_NAME).toBe(pkg.name);
	});

	it('should export PLUGIN_VERSION matching package.json version', () => {
		const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
		expect(PLUGIN_VERSION).toBe(pkg.version);
	});

	it('should export PLUGIN_URL matching package.json homepage', () => {
		const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
		expect(PLUGIN_URL).toBe(pkg.homepage);
	});

	it('should export ENGINES matching package.json engines', () => {
		const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
		expect(ENGINES).toEqual(pkg.engines);
	});
});
