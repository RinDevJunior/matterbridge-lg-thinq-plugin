import { describe, expect, it } from 'vitest';

import { HELP_TEXT } from '../../cli/help.js';

describe('HELP_TEXT', () => {
	it('should be a non-empty string', () => {
		expect(HELP_TEXT).toBeDefined();
		expect(typeof HELP_TEXT).toBe('string');
		expect(HELP_TEXT.length).toBeGreaterThan(0);
	});

	it('should contain the "Usage:" section header', () => {
		expect(HELP_TEXT).toContain('Usage:');
	});

	it('should contain the "Options:" section header', () => {
		expect(HELP_TEXT).toContain('Options:');
	});

	it('should contain the "Commands:" section header', () => {
		expect(HELP_TEXT).toContain('Commands:');
	});

	it('should contain the "Examples:" section header', () => {
		expect(HELP_TEXT).toContain('Examples:');
	});

	it('should contain all three command names', () => {
		expect(HELP_TEXT).toContain('login');
		expect(HELP_TEXT).toContain('devices');
		expect(HELP_TEXT).toContain('help');
	});

	it('should contain all option flags', () => {
		expect(HELP_TEXT).toContain('--type');
		expect(HELP_TEXT).toContain('--country');
		expect(HELP_TEXT).toContain('--language');
		expect(HELP_TEXT).toContain('--help');
		expect(HELP_TEXT).toContain('--debug');
	});

	it('should contain descriptions for commands', () => {
		expect(HELP_TEXT).toContain('Authenticate with LG ThinQ');
		expect(HELP_TEXT).toContain('List all discovered ThinQ devices');
	});
});
