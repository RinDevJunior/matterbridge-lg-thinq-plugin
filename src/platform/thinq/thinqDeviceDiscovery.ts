import { AnsiLogger } from 'matterbridge/logger';

import type {
	ThinqAirConditionerDevice,
	ThinqDevice,
	ThinqWasherDevice,
} from '../../core/domain/entities/ThinqDevice.js';
import { ThinqDeviceService } from '../../services/thinq/thinqDeviceService.js';

/**
 * Dispatches discovered ThinQ devices to their typed device entity, keyed by `deviceType` string
 * (ports `Helper.make`, `homebridge-lg-thinq/src/helper.ts:32-49`). Supports AirConditioner ('AC') and
 * Washer ('WASHER') — every other type is unregistered (returns `undefined`), matching the source's
 * `unregisterUnsupportedDevice` fail-closed behavior.
 */
export class ThinqDeviceDiscovery {
	constructor(
		private readonly deviceService: ThinqDeviceService,
		private readonly logger: AnsiLogger,
	) {}

	public async discoverDevices(): Promise<ThinqDevice[]> {
		const devices = await this.deviceService.discoverDevices();
		this.logger.debug(`ThinQ discoverDevices: ${devices.length} raw device(s) returned before filtering`);
		const supported: ThinqDevice[] = [];

		for (const device of devices) {
			const resolved = this.dispatch(device);
			if (resolved) {
				supported.push(resolved);
				continue;
			}

			this.logger.info(`ThinQ device type not supported, skipping: ${device.type} (${device.id})`);
		}

		this.logger.debug(`ThinQ discoverDevices: ${supported.length} device(s) supported after filtering`);
		return supported;
	}

	private dispatch(device: ThinqDevice): ThinqAirConditionerDevice | ThinqWasherDevice | undefined {
		switch (device.type) {
			case 'AC':
				return { ...device, type: 'AC' };
			case 'WASHER':
				return { ...device, type: 'WASHER' };
			default:
				return undefined;
		}
	}
}
