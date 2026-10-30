import { describe, expect, it } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import { getThinqConnectBaseUrl, resolveThinqConnectRegion } from './thinqConnectRegions.js';

function captureError(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return undefined;
}

describe('thinqConnectRegions', () => {
	describe('resolveThinqConnectRegion', () => {
		it.each([
			['US', 'aic'],
			['KR', 'kic'],
			['DE', 'eic'],
			['GB', 'eic'],
			['BR', 'aic'],
			['AU', 'kic'],
		])('should resolve %s to region %s', (country, expectedRegion) => {
			// Arrange
			// (inputs provided by the table)

			// Act
			const region = resolveThinqConnectRegion(country);

			// Assert
			expect(region).toBe(expectedRegion);
		});

		it('should resolve lower-case and padded input like the upper-case code', () => {
			// Arrange
			const input = ' us ';

			// Act
			const region = resolveThinqConnectRegion(input);

			// Assert
			expect(region).toBe('aic');
		});

		it('should return undefined when country code is unknown', () => {
			// Arrange
			const input = 'ZZ';

			// Act
			const region = resolveThinqConnectRegion(input);

			// Assert
			expect(region).toBeUndefined();
		});

		it('should return undefined when country code is empty', () => {
			// Arrange
			const input = '';

			// Act
			const region = resolveThinqConnectRegion(input);

			// Assert
			expect(region).toBeUndefined();
		});
	});

	describe('getThinqConnectBaseUrl', () => {
		it('should return the aic host when country is US', () => {
			// Arrange
			const country = 'US';

			// Act
			const url = getThinqConnectBaseUrl(country);

			// Assert
			expect(url).toBe('https://api-aic.lgthinq.com');
		});

		it('should return the kic host when country is KR', () => {
			// Arrange
			const country = 'KR';

			// Act
			const url = getThinqConnectBaseUrl(country);

			// Assert
			expect(url).toBe('https://api-kic.lgthinq.com');
		});

		it('should return the eic host when country is FR', () => {
			// Arrange
			const country = 'FR';

			// Act
			const url = getThinqConnectBaseUrl(country);

			// Assert
			expect(url).toBe('https://api-eic.lgthinq.com');
		});

		it('should throw ThinqConnectApiError with resultCode 1307 when country is unsupported', () => {
			// Arrange
			const country = 'ZZ';

			// Act
			const error = captureError(() => getThinqConnectBaseUrl(country));

			// Assert
			expect(error).toBeInstanceOf(ThinqConnectApiError);
			expect((error as ThinqConnectApiError).message).toBe('Country "ZZ" is not supported by the LG ThinQ Connect API');
			expect((error as ThinqConnectApiError).metadata).toEqual({ resultCode: '1307' });
		});
	});
});
