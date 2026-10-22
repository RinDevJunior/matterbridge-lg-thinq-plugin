/**
 * Per-device Matter identity overrides, passed from the platform entry point as plain data.
 * Each undefined field falls back to the ThinQ Connect endpoint builder's own default.
 */
export interface ThinqConnectMatterIdentityOverride {
	vendorId?: number;
	vendorName?: string;
	productId?: number;
	productName?: string;
	/** Account-login (V1) device id. When set it replaces the ThinQ Connect id as the Matter serial number and as the endpoint id seed. */
	legacyId?: string;
}

export interface ThinqConnectIdentitySources {
	overrideMatterConfiguration: boolean;
	vendor?: { matterVendorId?: number; matterVendorName?: string };
	getProductId(deviceId: string): number | undefined;
	getProductName(deviceId: string): string | undefined;
	legacyIdFor(deviceId: string): string | undefined;
}

/**
 * Resolves the Matter identity overrides for one ThinQ Connect device. Product overrides fall back to the
 * account-login device's entry (same device, old id) when the ThinQ Connect entry has none.
 */
export function resolveThinqConnectMatterIdentity(
	deviceId: string,
	sources: ThinqConnectIdentitySources,
): ThinqConnectMatterIdentityOverride {
	const legacyId = sources.legacyIdFor(deviceId);
	const vendor = sources.overrideMatterConfiguration ? sources.vendor : undefined;
	return {
		vendorId: vendor?.matterVendorId,
		vendorName: vendor?.matterVendorName,
		productId: sources.getProductId(deviceId) ?? (legacyId === undefined ? undefined : sources.getProductId(legacyId)),
		productName:
			sources.getProductName(deviceId) ?? (legacyId === undefined ? undefined : sources.getProductName(legacyId)),
		legacyId,
	};
}
