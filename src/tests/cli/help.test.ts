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

	it('should document the connect-probe command, its options and an example', () => {
		// Assert
		expect(HELP_TEXT).toContain('connect-probe');
		expect(HELP_TEXT).toContain('--device-id');
		expect(HELP_TEXT).toContain('--raw');
		expect(HELP_TEXT).toContain('Connect-probe options:');
		expect(HELP_TEXT).toMatch(/--command .*connect-probe/);
	});

	it('should document the connect-control command, its options and an example', () => {
		// Assert
		expect(HELP_TEXT).toContain('connect-control');
		expect(HELP_TEXT).toContain('Connect-control options:');
		expect(HELP_TEXT).toContain('--send');
		expect(HELP_TEXT).toContain('--yes');
		expect(HELP_TEXT).toContain('--wait');
		expect(HELP_TEXT).toMatch(/--command .*connect-control/);
	});

	it('should list POWER_OFF, POWER_ON and START in the connect-control section', () => {
		// Arrange
		const start = HELP_TEXT.indexOf('Connect-control options:');
		const end = HELP_TEXT.indexOf('Commands:');

		// Act
		const section = HELP_TEXT.slice(start, end);

		// Assert
		expect(start).toBeGreaterThanOrEqual(0);
		expect(section).toContain('POWER_OFF');
		expect(section).toContain('POWER_ON');
		expect(section).toContain('START');
	});

	it('should document a POWER_OFF connect-control example', () => {
		// Assert
		expect(HELP_TEXT).toMatch(/--command .*connect-control.*--send POWER_OFF/);
	});
});
