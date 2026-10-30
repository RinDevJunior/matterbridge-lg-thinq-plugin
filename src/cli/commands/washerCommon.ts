import { AnsiLogger } from 'matterbridge/logger';

import { isWasherDevice, type ThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import { WASHER_ABSENT, type WasherFields } from '../../platform/thinq/thinqWasherFields.js';
import { ThinqSession } from '../../services/thinq/session.js';
import { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import type { CliSession } from '../types.js';
import { maskSecret } from '../utils.js';

export type { WasherFields, WasherSendFailure } from '../../platform/thinq/thinqWasherFields.js';
export {
	changedWasherFieldKeys,
	describeSendFailure,
	describeThinqResultCode,
	isRecord,
	parseWasherField,
	readWasherFields,
	WASHER_ABSENT,
	WASHER_TRACKED_KEYS,
} from '../../platform/thinq/thinqWasherFields.js';

export function formatWasherFieldLines(fields: WasherFields): string[] {
	return Object.entries(fields).map(([key, value]) => `washerDryer.${key} = ${value}`);
}

export function diffWasherFields(before: WasherFields, after: WasherFields): string[] {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	const lines: string[] = [];
	for (const key of [...keys].sort()) {
		const previous = before[key] ?? WASHER_ABSENT;
		const next = after[key] ?? WASHER_ABSENT;
		if (previous !== next) {
			lines.push(`${key}: ${previous} -> ${next}`);
		}
	}
	return lines.length === 0 ? ['No tracked field changed.'] : lines;
}

/** Device UUID's last 12 hex digits are the MAC address, so only the last 4 characters are ever printed. */
export function maskDeviceId(id: string): string {
	return maskSecret(id, 4);
}

export function createWasherClient(session: CliSession, logger: AnsiLogger): ThinqApiClient {
	const { userData, country, language } = session;
	const thinqSession = new ThinqSession(userData.accessToken, userData.refreshToken, userData.expiresAtEpochSeconds);
	const apiClient = new ThinqApiClient(thinqSession, country, language, logger);
	if (userData.userNumber) {
		apiClient.setUserNumber(userData.userNumber);
	}
	return apiClient;
}

export function findWasherTarget(devices: ThinqDevice[], deviceId: string | undefined): ThinqDevice | undefined {
	return deviceId === undefined ? devices.find(isWasherDevice) : devices.find((device) => device.id === deviceId);
}
