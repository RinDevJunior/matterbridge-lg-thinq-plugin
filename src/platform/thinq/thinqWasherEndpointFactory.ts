import { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasher } from 'matterbridge/devices';

import type { ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';

/**
 * Options for building a washer endpoint with custom vendor/product identity.
 * Mirrors `BuildAirConditionerEndpointOptions` field-for-field.
 */
export interface BuildWasherEndpointOptions {
	vendorId?: number;
	vendorName?: string;
	productId?: number;
	productName?: string;
}

/**
 * Builds a Matterbridge `LaundryWasher`-shaped endpoint for a ThinQ Washer device.
 * `LaundryWasher`'s constructor already self-composes every mandatory cluster (OnOff DeadFront,
 * LaundryWasherMode, LaundryWasherControls, TemperatureControl, OperationalState) — no capability
 * gating or extra cluster-server calls are needed, unlike the AirConditioner's hand-composed pattern.
 */
export function buildWasherEndpoint(
	device: ThinqWasherDevice,
	options?: BuildWasherEndpointOptions,
): MatterbridgeEndpoint {
	const washer = new LaundryWasher(device.name, device.id);
	washer.createDefaultBasicInformationClusterServer(
		device.name,
		device.id,
		options?.vendorId ?? 0xfff1,
		options?.vendorName ?? 'Matterbridge',
		options?.productId ?? 0x8000,
		options?.productName ?? 'Matterbridge Laundry Washer',
	);
	return washer;
}
