import { MatterbridgeEndpoint } from 'matterbridge';
import { LaundryWasher } from 'matterbridge/devices';

import type { ThinqWasherDevice } from '../../core/domain/entities/ThinqDevice.js';

/**
 * Builds a Matterbridge `LaundryWasher`-shaped endpoint for a ThinQ Washer device.
 * `LaundryWasher`'s constructor already self-composes every mandatory cluster (OnOff DeadFront,
 * LaundryWasherMode, LaundryWasherControls, TemperatureControl, OperationalState) — no capability
 * gating or extra cluster-server calls are needed, unlike the AirConditioner's hand-composed pattern.
 */
export function buildWasherEndpoint(device: ThinqWasherDevice): MatterbridgeEndpoint {
	return new LaundryWasher(device.name, device.id);
}
