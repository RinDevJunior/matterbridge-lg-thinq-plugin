import { MatterbridgeEndpoint, onOffPlugInUnit } from 'matterbridge';
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
 * Child endpoint name for the washer's remote Start/Stop switch — the only Apple-Home-visible
 * control surface, since Apple Home renders no UI at all for the native `LaundryWasher` device type.
 */
export const WASHER_REMOTE_START_STOP_SWITCH_ID = 'RemoteStartStopSwitch';

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

	washer
		.addChildDeviceType(WASHER_REMOTE_START_STOP_SWITCH_ID, [onOffPlugInUnit])
		.createDefaultIdentifyClusterServer()
		.createDefaultOnOffClusterServer(false)
		.addRequiredClusterServers();

	return washer;
}
