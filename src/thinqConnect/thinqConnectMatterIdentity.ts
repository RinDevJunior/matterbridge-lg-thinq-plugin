/**
 * Per-device Matter identity overrides, passed from the platform entry point as plain data.
 * Each undefined field falls back to the ThinQ Connect endpoint builder's own default.
 */
export interface ThinqConnectMatterIdentityOverride {
	vendorId?: number;
	vendorName?: string;
	productId?: number;
	productName?: string;
}
