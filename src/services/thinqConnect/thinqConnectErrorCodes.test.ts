import { describe, expect, it } from 'vitest';

import { describeThinqConnectResultCode } from './thinqConnectErrorCodes.js';

describe('describeThinqConnectResultCode', () => {
	const knownCodes = [
		'1103',
		'1218',
		'1210',
		'1211',
		'1222',
		'1223',
		'2209',
		'2301',
		'2302',
		'2303',
		'2304',
		'2305',
		'1306',
		'1307',
		'1212',
		'1220',
		'1221',
		'2205',
		'2207',
		'2208',
		'2210',
		'2212',
		'2214',
	];

	it.each(knownCodes)('should return a non-empty description for known code %s', (code) => {
		// Arrange
		// (code provided by the table)

		// Act
		const description = describeThinqConnectResultCode(code);

		// Assert
		expect(description).toBeDefined();
		expect(description?.length).toBeGreaterThan(0);
	});

	it('should return undefined when code is unknown', () => {
		// Arrange
		const code = '9999';

		// Act
		const description = describeThinqConnectResultCode(code);

		// Assert
		expect(description).toBeUndefined();
	});

	it('should return undefined when code is undefined', () => {
		// Arrange
		const code = undefined;

		// Act
		const description = describeThinqConnectResultCode(code);

		// Assert
		expect(description).toBeUndefined();
	});
});
