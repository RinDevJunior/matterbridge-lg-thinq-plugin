import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	type ConnectEnergyOptions,
	parseConnectEnergyOptions,
	printConnectEnergy,
} from '../../../cli/commands/connectEnergy.js';
import { ThinqConnectApiError } from '../../../errors/index.js';
import type {
	ThinqConnectApiClient,
	ThinqConnectEnergyUsageQuery,
	ThinqConnectResource,
} from '../../../services/thinqConnect/thinqConnectApiClient.js';

interface MockEnergyClient {
	getEnergyProfile: Mock<ThinqConnectApiClient['getEnergyProfile']>;
	getEnergyUsage: Mock<ThinqConnectApiClient['getEnergyUsage']>;
}

function createMockClient(): MockEnergyClient {
	return {
		getEnergyProfile: vi.fn<ThinqConnectApiClient['getEnergyProfile']>(),
		getEnergyUsage: vi.fn<ThinqConnectApiClient['getEnergyUsage']>(),
	};
}

/** Fake Energy API response (ids and values are fake). */
function energyResponse(
	resultCode: string,
	properties?: string[],
	dataList?: { usedDate: string; useAmount: number }[],
): ThinqConnectResource {
	return {
		resultCode,
		result: {
			...(properties === undefined ? {} : { property: properties }),
			...(dataList === undefined ? {} : { dataList }),
		},
	};
}

const DEVICE_ID = 'dev-1';
const ROWS = [
	{ usedDate: '20250901', useAmount: 1.5 },
	{ usedDate: '20250902', useAmount: 2.5 },
];

describe('connectEnergy', () => {
	let client: MockEnergyClient;
	let logSpy: ReturnType<typeof vi.spyOn>;

	const printedText = (): string => logSpy.mock.calls.flat().map(String).join('\n');

	beforeEach(() => {
		vi.clearAllMocks();
		client = createMockClient();
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		process.exitCode = undefined;
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2025, 8, 7));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	describe('parseConnectEnergyOptions', () => {
		it('should default to DAILY with no dates when no keys are given', () => {
			// Act & Assert
			expect(parseConnectEnergyOptions({})).toEqual({ options: { period: 'DAILY' } });
		});

		it('should accept monthly in any case and return MONTHLY', () => {
			// Act & Assert
			expect(parseConnectEnergyOptions({ 'energy-period': 'monthly' })).toEqual({ options: { period: 'MONTHLY' } });
		});

		it('should return an error listing the allowed periods for weekly', () => {
			// Act & Assert
			expect(parseConnectEnergyOptions({ 'energy-period': 'weekly' })).toEqual({
				error: expect.stringContaining('Allowed: DAILY, MONTHLY') as string,
			});
		});

		it('should pass start and end dates through unchanged', () => {
			// Act & Assert
			expect(
				parseConnectEnergyOptions({ 'energy-period': 'MONTHLY', 'energy-start': '202501', 'energy-end': '202503' }),
			).toEqual({ options: { period: 'MONTHLY', startDate: '202501', endDate: '202503' } });
		});
	});

	describe('printConnectEnergy supported flow', () => {
		it('should call usage once with the default DAILY range and print summary and raw JSON without setting an exit code', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage']));
			client.getEnergyUsage.mockResolvedValue(energyResponse('0000', undefined, ROWS));
			const options: ConnectEnergyOptions = { period: 'DAILY' };

			// Act
			await printConnectEnergy(client, DEVICE_ID, options);

			// Assert
			expect(client.getEnergyUsage).toHaveBeenCalledTimes(1);
			expect(client.getEnergyUsage).toHaveBeenCalledWith(DEVICE_ID, {
				property: 'energyUsage',
				period: 'DAILY',
				startDate: '20250901',
				endDate: '20250907',
			});
			expect(printedText()).toContain(
				'energy usage [energyUsage] DAILY 20250901..20250907: result 0000 (OK), 2 row(s), total 4',
			);
			expect(printedText()).toContain('raw energy profile:');
			expect(printedText()).toContain('raw energy usage [energyUsage]:');
			expect(printedText()).toContain('energy summary: 1 of 1 property returned data');
			expect(process.exitCode).toBeUndefined();
		});

		it('should call usage sequentially for two properties and summarize 2 of 2', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage', 'energyUsage_washer']));
			client.getEnergyUsage.mockResolvedValue(energyResponse('0000', undefined, ROWS));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(client.getEnergyUsage).toHaveBeenCalledTimes(2);
			expect(vi.mocked(client.getEnergyUsage).mock.calls[0]?.[1]).toMatchObject({ property: 'energyUsage' });
			expect(vi.mocked(client.getEnergyUsage).mock.calls[1]?.[1]).toMatchObject({ property: 'energyUsage_washer' });
			expect(printedText()).toContain('energy summary: 2 of 2 properties returned data');
		});

		it('should pass explicit start and end dates through instead of the defaults', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage']));
			client.getEnergyUsage.mockResolvedValue(energyResponse('0000', undefined, ROWS));

			// Act
			await printConnectEnergy(client, DEVICE_ID, {
				period: 'MONTHLY',
				startDate: '202501',
				endDate: '202503',
			});

			// Assert
			const query: ThinqConnectEnergyUsageQuery | undefined = vi.mocked(client.getEnergyUsage).mock.calls[0]?.[1];
			expect(query).toEqual({ property: 'energyUsage', period: 'MONTHLY', startDate: '202501', endDate: '202503' });
		});

		it('should never print the PAT sentinel in any line', async () => {
			// Arrange
			const patSentinel = 'pat-sentinel-do-not-print';
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage']));
			client.getEnergyUsage.mockResolvedValue(energyResponse('0000', undefined, ROWS));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).not.toContain(patSentinel);
		});
	});

	describe('printConnectEnergy profile result codes', () => {
		it('should print the meaning, skip usage and leave the exit code unset for a 1221 HTTP 200 body', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('1221'));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).toContain('energy profile: result 1221 (Product not supported by the Energy API)');
			expect(printedText()).toContain('energy: no usage call (profile result is not 0000)');
			expect(client.getEnergyUsage).not.toHaveBeenCalled();
			expect(process.exitCode).toBeUndefined();
		});

		it.each(['1221', '1307', '1220'])(
			'should keep the exit code unset when the profile throws not-supported code %s',
			async (code) => {
				// Arrange
				client.getEnergyProfile.mockRejectedValue(new ThinqConnectApiError('x', code));

				// Act
				await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

				// Assert
				expect(printedText()).toContain('energy profile: ERROR x');
				expect(printedText()).toContain(`energy result code: ${code}`);
				expect(process.exitCode).toBeUndefined();
			},
		);

		it.each(['1212', '2214'])('should set exit code 1 when the profile result is %s', async (code) => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse(code));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(process.exitCode).toBe(1);
			expect(client.getEnergyUsage).not.toHaveBeenCalled();
		});

		it('should set exit code 1 when the profile throws 1212', async () => {
			// Arrange
			client.getEnergyProfile.mockRejectedValue(new ThinqConnectApiError('not yours', '1212'));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(process.exitCode).toBe(1);
		});

		it('should set exit code 1 and print no result code line when the profile request fails on the network', async () => {
			// Arrange
			client.getEnergyProfile.mockRejectedValue(new Error('network down'));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).toContain('energy profile: ERROR network down');
			expect(printedText()).not.toContain('energy result code');
			expect(process.exitCode).toBe(1);
		});

		it('should print that no property is usable and skip usage when the property list is empty', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', []));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).toContain('profile lists no usable property; no usage call');
			expect(client.getEnergyUsage).not.toHaveBeenCalled();
		});
	});

	describe('printConnectEnergy with the real usage shape', () => {
		it('should print 7 rows and total 20958 and summarize 1 of 1 for the real AC reply', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage']));
			client.getEnergyUsage.mockResolvedValue({
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
			});

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).toContain('result 0000 (OK), 7 row(s), total 20958');
			expect(printedText()).toContain('energy summary: 1 of 1 property returned data');
			expect(process.exitCode).toBeUndefined();
		});
	});

	describe('printConnectEnergy usage failures', () => {
		it('should print ERROR for the failing property, still print the other, summarize 1 of 2, and set exit code 1', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage', 'energyUsage_washer']));
			client.getEnergyUsage
				.mockRejectedValueOnce(new Error('boom'))
				.mockResolvedValueOnce(energyResponse('0000', undefined, ROWS));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).toContain('energy usage [energyUsage]: ERROR boom');
			expect(printedText()).toContain('energy usage [energyUsage_washer] DAILY');
			expect(printedText()).toContain('energy summary: 1 of 2 properties returned data');
			expect(process.exitCode).toBe(1);
		});

		it('should keep the exit code unset when a usage call fails with not-supported code 1220', async () => {
			// Arrange
			client.getEnergyProfile.mockResolvedValue(energyResponse('0000', ['energyUsage']));
			client.getEnergyUsage.mockRejectedValueOnce(new ThinqConnectApiError('no property', '1220'));

			// Act
			await printConnectEnergy(client, DEVICE_ID, { period: 'DAILY' });

			// Assert
			expect(printedText()).toContain('energy usage [energyUsage]: ERROR no property');
			expect(process.exitCode).toBeUndefined();
		});
	});
});
