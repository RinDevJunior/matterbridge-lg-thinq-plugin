import { describe, expect, it, vi } from 'vitest';

import {
	resolveThinqConnectMatterIdentity,
	type ThinqConnectIdentitySources,
} from '../../thinqConnect/thinqConnectMatterIdentity.js';

const CONNECT_ID = '5d0fcc7385f6cee5844cb447762f9d36df9004d9d2115f583329a67e689b02d3';
const LEGACY_ID = 'ee7980cc-7dba-13a4-af04-dc69cc57b6a8';

const VENDOR = { matterVendorId: 0x1234, matterVendorName: 'Acme' };

function createSources(overrides: Partial<ThinqConnectIdentitySources> = {}): ThinqConnectIdentitySources {
	return {
		overrideMatterConfiguration: true,
		vendor: VENDOR,
		getProductId: vi.fn<ThinqConnectIdentitySources['getProductId']>(() => undefined),
		getProductName: vi.fn<ThinqConnectIdentitySources['getProductName']>(() => undefined),
		legacyIdFor: vi.fn<ThinqConnectIdentitySources['legacyIdFor']>(() => undefined),
		...overrides,
	};
}

describe('resolveThinqConnectMatterIdentity', () => {
	it('should return the global vendor and the product overrides when there is no mapping (regression)', () => {
		// Arrange
		const sources = createSources({
			getProductId: vi.fn<ThinqConnectIdentitySources['getProductId']>(() => 0x8123),
			getProductName: vi.fn<ThinqConnectIdentitySources['getProductName']>(() => 'Den Washer'),
		});

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result).toEqual({
			vendorId: 0x1234,
			vendorName: 'Acme',
			productId: 0x8123,
			productName: 'Den Washer',
			legacyId: undefined,
		});
	});

	it('should return undefined product and vendor fields when there is no mapping and no overrides (regression)', () => {
		// Arrange
		const sources = createSources({ overrideMatterConfiguration: false, vendor: undefined });

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result.vendorId).toBeUndefined();
		expect(result.vendorName).toBeUndefined();
		expect(result.productId).toBeUndefined();
		expect(result.productName).toBeUndefined();
		expect(result.legacyId).toBeUndefined();
	});

	it.each([
		{ label: 'on', overrideMatterConfiguration: true, expectedVendorId: 0x1234, expectedVendorName: 'Acme' },
		{ label: 'off', overrideMatterConfiguration: false, expectedVendorId: undefined, expectedVendorName: undefined },
	])(
		'should gate vendor fields on overrideMatterConfiguration when it is $label',
		({ overrideMatterConfiguration, expectedVendorId, expectedVendorName }) => {
			// Arrange
			const sources = createSources({ overrideMatterConfiguration, legacyIdFor: vi.fn(() => LEGACY_ID) });

			// Act
			const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

			// Assert
			expect(result.vendorId).toBe(expectedVendorId);
			expect(result.vendorName).toBe(expectedVendorName);
		},
	);

	it('should pass the product lookups through when override is off', () => {
		// Arrange
		const sources = createSources({
			overrideMatterConfiguration: false,
			getProductId: vi.fn<ThinqConnectIdentitySources['getProductId']>(() => 0x8123),
			getProductName: vi.fn<ThinqConnectIdentitySources['getProductName']>(() => 'Den Washer'),
		});

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result.productId).toBe(0x8123);
		expect(result.productName).toBe('Den Washer');
	});

	it('should use the ThinQ Connect entry when both the Connect and the account login entries have a product name and id', () => {
		// Arrange
		const sources = createSources({
			legacyIdFor: vi.fn(() => LEGACY_ID),
			getProductId: vi.fn<ThinqConnectIdentitySources['getProductId']>((id) => (id === CONNECT_ID ? 0x8123 : 0x9999)),
			getProductName: vi.fn<ThinqConnectIdentitySources['getProductName']>((id) =>
				id === CONNECT_ID ? 'New Name' : 'Old Name',
			),
		});

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result.productId).toBe(0x8123);
		expect(result.productName).toBe('New Name');
	});

	it('should fall back to the account login entry when the ThinQ Connect entry has no product override', () => {
		// Arrange
		const sources = createSources({
			legacyIdFor: vi.fn(() => LEGACY_ID),
			getProductId: vi.fn<ThinqConnectIdentitySources['getProductId']>((id) => (id === LEGACY_ID ? 0x8456 : undefined)),
			getProductName: vi.fn<ThinqConnectIdentitySources['getProductName']>((id) =>
				id === LEGACY_ID ? 'Old Name' : undefined,
			),
		});

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result.productId).toBe(0x8456);
		expect(result.productName).toBe('Old Name');
		expect(sources.getProductName).toHaveBeenNthCalledWith(1, CONNECT_ID);
		expect(sources.getProductName).toHaveBeenNthCalledWith(2, LEGACY_ID);
	});

	it('should leave product fields undefined when a mapped device has no override on either entry', () => {
		// Arrange
		const sources = createSources({ legacyIdFor: vi.fn(() => LEGACY_ID) });

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result.productId).toBeUndefined();
		expect(result.productName).toBeUndefined();
		expect(result.legacyId).toBe(LEGACY_ID);
	});

	it('should query product lookups only with its own id when the device is unmapped', () => {
		// Arrange
		const sources = createSources();

		// Act
		resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(sources.getProductId).toHaveBeenCalledTimes(1);
		expect(sources.getProductId).toHaveBeenCalledWith(CONNECT_ID);
		expect(sources.getProductName).toHaveBeenCalledTimes(1);
		expect(sources.getProductName).toHaveBeenCalledWith(CONNECT_ID);
	});

	it('should return legacyId from legacyIdFor and query it with the ThinQ Connect id only', () => {
		// Arrange
		const sources = createSources({ legacyIdFor: vi.fn(() => LEGACY_ID) });

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result.legacyId).toBe(LEGACY_ID);
		expect(sources.legacyIdFor).toHaveBeenCalledTimes(1);
		expect(sources.legacyIdFor).toHaveBeenCalledWith(CONNECT_ID);
	});

	it('should not include an ignore field in the result', () => {
		// Arrange
		const sources = createSources({ legacyIdFor: vi.fn(() => LEGACY_ID) });

		// Act
		const result = resolveThinqConnectMatterIdentity(CONNECT_ID, sources);

		// Assert
		expect(result).not.toHaveProperty('ignore');
	});
});
