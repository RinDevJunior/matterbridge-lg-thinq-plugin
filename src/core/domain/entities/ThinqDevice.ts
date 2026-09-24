import type { ThinqDeviceData } from '../../../services/thinq/thinqApiClient.js';
import { ThinqSnapshot } from '../value-objects/ThinqSnapshot.js';

const DEVICE_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Numeric `deviceType` → ThinQ type-name mapping (`homebridge-lg-thinq/src/lib/constants.ts`). Phase 1 subset. */
const DEVICE_TYPE_NAMES: Record<number, string> = {
	101: 'REFRIGERATOR',
	102: 'KIMCHI_REFRIGERATOR',
	103: 'WATER_PURIFIER',
	201: 'WASHER',
	221: 'WASHER_NEW',
	222: 'WASH_TOWER',
	223: 'WASH_TOWER_2',
	202: 'DRYER',
	203: 'STYLER',
	204: 'DISHWASHER',
	301: 'OVEN',
	302: 'MICROWAVE',
	303: 'COOKTOP',
	304: 'HOOD',
	401: 'AC',
	402: 'AIR_PURIFIER',
	403: 'DEHUMIDIFIER',
	410: 'AERO_TOWER',
};

/** Generic ThinQ device entity, common to every device type/generation. */
export interface ThinqDevice {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly modelName: string;
	readonly platformType: string | undefined;
	readonly online: boolean;
	readonly snapshot: ThinqSnapshot;
	readonly modelJsonUri?: string;
}

/** ThinQ device narrowed to the AirConditioner type (`deviceType === 401`, `type === 'AC'`). */
export interface ThinqAirConditionerDevice extends ThinqDevice {
	readonly type: 'AC';
}

/** ThinQ device narrowed to the Washer type (`deviceType === 201`, `type === 'WASHER'`). */
export interface ThinqWasherDevice extends ThinqDevice {
	readonly type: 'WASHER';
}

export function isValidThinqDeviceId(id: unknown): id is string {
	return typeof id === 'string' && DEVICE_ID_PATTERN.test(id);
}

export function isAirConditionerDevice(device: ThinqDevice): device is ThinqAirConditionerDevice {
	return device.type === 'AC';
}

export function isWasherDevice(device: ThinqDevice): device is ThinqWasherDevice {
	return device.type === 'WASHER';
}

/** Maps a raw `ThinqDeviceData` REST response into the generic `ThinqDevice` domain entity. */
export function toThinqDevice(data: ThinqDeviceData): ThinqDevice {
	return {
		id: data.deviceId,
		name: data.alias,
		type: DEVICE_TYPE_NAMES[data.deviceType] ?? String(data.deviceType),
		modelName: data.modelName ?? data.modemInfo?.modelName ?? data.manufacture?.manufactureModel ?? '',
		platformType: data.platformType,
		online: data.online ?? data.snapshot.online ?? false,
		snapshot: new ThinqSnapshot(data.snapshot),
		modelJsonUri: data.modelJsonUri,
	};
}
