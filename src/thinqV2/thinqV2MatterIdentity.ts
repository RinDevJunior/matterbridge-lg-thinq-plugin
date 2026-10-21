/**
 * Per-device Matter identity overrides, passed from the platform entry point as plain data.
 * Each undefined field falls back to the V2 endpoint builder's own default.
 */
export interface ThinqV2MatterIdentityOverride {
	vendorId?: number;
	vendorName?: string;
	productId?: number;
	productName?: string;
}
