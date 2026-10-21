import { describe, expect, it } from 'vitest';

import type { ThinqConnectResource } from './thinqConnectApiClient.js';
import {
	defaultEnergyRange,
	describeEnergyResultCode,
	isEnergyNotSupportedCode,
	readEnergyProperties,
	readEnergyResultCode,
	readEnergyUsageRows,
	summarizeEnergyUsage,
} from './thinqConnectEnergy.js';

/** Fake energy response with the shape used by the Energy API (ids and values are fake). */
function energyResponse(resultCode: unknown, properties?: unknown, dataList?: unknown): ThinqConnectResource {
	const result: Record<string, unknown> = {};
	if (properties !== undefined) {
		result['property'] = properties;
	}
	if (dataList !== undefined) {
		result['dataList'] = dataList;
	}
	return { resultCode, result };
}

describe('thinqConnectEnergy', () => {
	describe('readEnergyResultCode', () => {
		it('should return the resultCode when it is a string', () => {
			// Arrange
			const response = energyResponse('1221');

			// Act & Assert
			expect(readEnergyResultCode(response)).toBe('1221');
		});

		it('should return undefined when resultCode is missing', () => {
			// Act & Assert
			expect(readEnergyResultCode({})).toBeUndefined();
		});

		it('should return undefined when resultCode is a number', () => {
			// Arrange
			const response: ThinqConnectResource = { resultCode: 1221 };

			// Act & Assert
			expect(readEnergyResultCode(response)).toBeUndefined();
		});
	});

	describe('describeEnergyResultCode', () => {
		it.each(['0000', '1212', '1220', '1221', '1307', '2214'])(
			'should return a non-empty meaning for code %s',
			(code) => {
				// Act
				const meaning = describeEnergyResultCode(code);

				// Assert
				expect(meaning.length).toBeGreaterThan(0);
			},
		);

		it('should return distinct meanings for the known codes', () => {
			// Arrange
			const codes = ['0000', '1212', '1220', '1221', '1307', '2214'];

			// Act
			const meanings = new Set(codes.map((code) => describeEnergyResultCode(code)));

			// Assert
			expect(meanings.size).toBe(codes.length);
		});

		it('should mention Unknown for an unlisted code', () => {
			// Act & Assert
			expect(describeEnergyResultCode('9999')).toContain('Unknown');
		});

		it('should return the no-resultCode text for undefined', () => {
			// Act & Assert
			expect(describeEnergyResultCode(undefined)).toBe('No resultCode in the response');
		});
	});

	describe('isEnergyNotSupportedCode', () => {
		it.each(['1220', '1221', '1307'])('should return true for not-supported code %s', (code) => {
			// Act & Assert
			expect(isEnergyNotSupportedCode(code)).toBe(true);
		});

		it.each(['0000', '1212', '2214'])('should return false for code %s', (code) => {
			// Act & Assert
			expect(isEnergyNotSupportedCode(code)).toBe(false);
		});

		it('should return false for undefined', () => {
			// Act & Assert
			expect(isEnergyNotSupportedCode(undefined)).toBe(false);
		});
	});

	describe('readEnergyProperties', () => {
		it('should return string items from result.property', () => {
			// Arrange
			const response = energyResponse('0000', ['energyUsage', 'energyUsage_washer']);

			// Act & Assert
			expect(readEnergyProperties({ result: response.result })).toEqual(['energyUsage', 'energyUsage_washer']);
		});

		it('should fall back to a top-level property array when result.property is absent', () => {
			// Arrange
			const response: ThinqConnectResource = { property: ['energyUsage'] };

			// Act & Assert
			expect(readEnergyProperties(response)).toEqual(['energyUsage']);
		});

		it('should drop non-string items', () => {
			// Arrange
			const response = energyResponse('0000', ['energyUsage', 42, null, { name: 'x' }]);

			// Act & Assert
			expect(readEnergyProperties({ result: response.result })).toEqual(['energyUsage']);
		});

		it('should return an empty array when no property list exists', () => {
			// Act & Assert
			expect(readEnergyProperties({})).toEqual([]);
		});
	});

	describe('readEnergyUsageRows', () => {
		it('should keep valid rows with string usedDate and finite numeric useAmount', () => {
			// Arrange
			const response = energyResponse('0000', undefined, [
				{ usedDate: '20250901', useAmount: 1.5 },
				{ usedDate: '20250902', useAmount: 0 },
			]);

			// Act & Assert
			expect(readEnergyUsageRows({ result: response.result })).toEqual([
				{ usedDate: '20250901', useAmount: 1.5 },
				{ usedDate: '20250902', useAmount: 0 },
			]);
		});

		it('should drop a row without usedDate', () => {
			// Arrange
			const response = energyResponse('0000', undefined, [{ useAmount: 2 }]);

			// Act & Assert
			expect(readEnergyUsageRows({ result: response.result })).toEqual([]);
		});

		it('should drop a row whose useAmount is a numeric string', () => {
			// Arrange
			const response = energyResponse('0000', undefined, [{ usedDate: '20250901', useAmount: '2' }]);

			// Act & Assert
			expect(readEnergyUsageRows({ result: response.result })).toEqual([]);
		});

		it('should drop a row whose useAmount is NaN', () => {
			// Arrange
			const response = energyResponse('0000', undefined, [{ usedDate: '20250901', useAmount: Number.NaN }]);

			// Act & Assert
			expect(readEnergyUsageRows({ result: response.result })).toEqual([]);
		});

		it('should return an empty array when dataList is absent', () => {
			// Arrange
			const response = energyResponse('0000', ['energyUsage']);

			// Act & Assert
			expect(readEnergyUsageRows({ result: response.result })).toEqual([]);
		});
	});

	describe('readEnergyUsageRows with the property-named amount key', () => {
		const AC_REAL_SHAPE: ThinqConnectResource = {
			resultCode: '0000',
			result: {
				dataList: [
					{ energyUsage: 4067, usedDate: '20261015' },
					{ energyUsage: 3788, usedDate: '20261016' },
					{ energyUsage: 3666, usedDate: '20261017' },
					{ energyUsage: 3063, usedDate: '20261018' },
					{ energyUsage: 3041, usedDate: '20261019' },
					{ usedDate: '20261020', energyUsage: 1997 },
					{ usedDate: '20261021', energyUsage: 1336 },
				],
				property: ['energyUsage'],
			},
		};

		it('should read 7 rows and total 20958 from the real AC shape when property is energyUsage', () => {
			// Act
			const rows = readEnergyUsageRows(AC_REAL_SHAPE, 'energyUsage');

			// Assert
			expect(rows).toHaveLength(7);
			expect(summarizeEnergyUsage(rows)).toEqual({ count: 7, total: 20958 });
		});

		it('should keep zero rows from the real washer shape and total 174', () => {
			// Arrange
			const washer: ThinqConnectResource = {
				resultCode: '0000',
				result: {
					dataList: [73, 0, 0, 44, 0, 57, 0].map((value, index) => ({
						energyUsage: value,
						usedDate: `2026101${index + 5}`,
					})),
				},
			};

			// Act
			const rows = readEnergyUsageRows(washer, 'energyUsage');

			// Assert
			expect(rows).toHaveLength(7);
			expect(summarizeEnergyUsage(rows)).toEqual({ count: 7, total: 174 });
		});

		it('should fall back to useAmount when the property-named key is absent', () => {
			// Arrange
			const response: ThinqConnectResource = {
				result: { dataList: [{ usedDate: '20260101', useAmount: 5 }] },
			};

			// Act & Assert
			expect(readEnergyUsageRows(response, 'energyUsage')).toEqual([{ usedDate: '20260101', useAmount: 5 }]);
		});

		it('should skip a row that has neither the property key nor useAmount', () => {
			// Arrange
			const response: ThinqConnectResource = {
				result: { dataList: [{ usedDate: '20260101' }, { usedDate: '20260102', energyUsage: 2 }] },
			};

			// Act & Assert
			expect(readEnergyUsageRows(response, 'energyUsage')).toEqual([{ usedDate: '20260102', useAmount: 2 }]);
		});

		it('should read only useAmount when property is omitted, ignoring the property-named key', () => {
			// Arrange
			const response: ThinqConnectResource = {
				result: {
					dataList: [
						{ usedDate: '20260101', energyUsage: 9 },
						{ usedDate: '20260102', useAmount: 4 },
					],
				},
			};

			// Act & Assert
			expect(readEnergyUsageRows(response)).toEqual([{ usedDate: '20260102', useAmount: 4 }]);
		});
	});

	describe('summarizeEnergyUsage', () => {
		it('should return count 0 and total 0 for an empty list', () => {
			// Act & Assert
			expect(summarizeEnergyUsage([])).toEqual({ count: 0, total: 0 });
		});

		it('should sum the rows and count them', () => {
			// Arrange
			const rows = [
				{ usedDate: '20250901', useAmount: 1.5 },
				{ usedDate: '20250902', useAmount: 2.5 },
			];

			// Act & Assert
			expect(summarizeEnergyUsage(rows)).toEqual({ count: 2, total: 4 });
		});
	});

	describe('defaultEnergyRange', () => {
		it('should return the last 7 days for DAILY', () => {
			// Arrange
			const now = new Date(2025, 8, 7);

			// Act & Assert
			expect(defaultEnergyRange('DAILY', now)).toEqual({ startDate: '20250901', endDate: '20250907' });
		});

		it('should wrap the DAILY window across a month and year boundary', () => {
			// Arrange
			const now = new Date(2025, 0, 3);

			// Act & Assert
			expect(defaultEnergyRange('DAILY', now)).toEqual({ startDate: '20241228', endDate: '20250103' });
		});

		it('should return the current month minus two through the current month for MONTHLY', () => {
			// Arrange
			const now = new Date(2025, 1, 15);

			// Act & Assert
			expect(defaultEnergyRange('MONTHLY', now)).toEqual({ startDate: '202412', endDate: '202502' });
		});

		it('should return a mid-year MONTHLY window', () => {
			// Arrange
			const now = new Date(2025, 5, 10);

			// Act & Assert
			expect(defaultEnergyRange('MONTHLY', now)).toEqual({ startDate: '202504', endDate: '202506' });
		});
	});
});
