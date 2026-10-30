import { describe, expect, it } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import {
	classifyThinqConnectPushError,
	computeThinqConnectPushBackoffMs,
	parseThinqConnectEventMessage,
	parseThinqConnectMqttHost,
} from './thinqConnectPush.js';

const HALF = (): number => 0.5;
const ZERO = (): number => 0;
const ONE = (): number => 1;

describe('classifyThinqConnectPushError', () => {
	it.each([
		['1103', 'permanent'],
		['1218', 'permanent'],
		['1202', 'permanent'],
		['1209', 'permanent'],
		['1305', 'permanent'],
		['1308', 'permanent'],
		['1307', 'permanent'],
		['1205', 'device-unsupported'],
		['1210', 'device-unsupported'],
		['1211', 'device-unsupported'],
		['1212', 'device-unsupported'],
		['1214', 'device-unsupported'],
		['1220', 'device-unsupported'],
		['1221', 'device-unsupported'],
		['1306', 'rate-limit'],
		['1312', 'subscription-limit'],
		['2000', 'transient'],
	])('should classify API code %s as %s', (code, kind) => {
		// Arrange
		const error = new ThinqConnectApiError('api failure', code);

		// Act
		const result = classifyThinqConnectPushError(error);

		// Assert
		expect(result).toBe(kind);
	});

	it('should classify a non-API Error as transient when it is a plain Error', () => {
		// Arrange
		const error = new Error('socket hang up');

		// Act
		const result = classifyThinqConnectPushError(error);

		// Assert
		expect(result).toBe('transient');
	});

	it('should classify a ThinqConnectApiError without a code as transient', () => {
		// Arrange
		const error = new ThinqConnectApiError('request failed (HTTP 500)', undefined, 500);

		// Act
		const result = classifyThinqConnectPushError(error);

		// Assert
		expect(result).toBe('transient');
	});

	it.each([undefined, null, 'string error', 42])('should classify %j as transient when it is not an Error', (value) => {
		// Arrange
		const input: unknown = value;

		// Act
		const result = classifyThinqConnectPushError(input);

		// Assert
		expect(result).toBe('transient');
	});
});

describe('computeThinqConnectPushBackoffMs', () => {
	it.each([
		[0, 30_000],
		[1, 60_000],
		[2, 120_000],
		[3, 240_000],
		[4, 480_000],
		[5, 900_000],
		[10, 900_000],
	])('should return the doubling delay with zero jitter when attempt is %s', (attempt, expected) => {
		// Arrange
		const random = HALF;

		// Act
		const result = computeThinqConnectPushBackoffMs(attempt, random);

		// Assert
		expect(result).toBe(expected);
	});

	it('should return 80 % of the base when random is 0', () => {
		// Arrange
		const random = ZERO;

		// Act
		const result = computeThinqConnectPushBackoffMs(0, random);

		// Assert
		expect(result).toBe(24_000);
	});

	it('should return 120 % of the base when random is 1', () => {
		// Arrange
		const random = ONE;

		// Act
		const result = computeThinqConnectPushBackoffMs(0, random);

		// Assert
		expect(result).toBe(36_000);
	});

	it('should cap the jittered delay near 900 s when the attempt is large', () => {
		// Arrange
		const random = ONE;

		// Act
		const result = computeThinqConnectPushBackoffMs(10, random);

		// Assert
		expect(result).toBe(1_080_000);
	});

	it.each([
		['transient', 'transient' as const],
		['permanent', 'permanent' as const],
		['device-unsupported', 'device-unsupported' as const],
	])('should not apply the rate-limit floor for %s errors', (_label, kind) => {
		// Arrange
		const random = ZERO;

		// Act
		const result = computeThinqConnectPushBackoffMs(0, random, kind);

		// Assert
		expect(result).toBe(24_000);
	});

	it.each([0, 1, 4])('should never return less than 300 s for rate-limit errors when attempt is %s', (attempt) => {
		// Arrange
		const random = ZERO;

		// Act
		const result = computeThinqConnectPushBackoffMs(attempt, random, 'rate-limit');

		// Assert
		expect(result).toBeGreaterThanOrEqual(300_000);
	});

	it('should keep the rate-limit delay above the floor when the base is already larger', () => {
		// Arrange
		const random = HALF;

		// Act
		const result = computeThinqConnectPushBackoffMs(5, random, 'rate-limit');

		// Assert
		expect(result).toBe(900_000);
	});

	it.each([
		['NaN', Number.NaN],
		['negative', -3],
	])('should treat a %s attempt as attempt 0 when random is 0.5', (_label, attempt) => {
		// Arrange
		const random = HALF;

		// Act
		const result = computeThinqConnectPushBackoffMs(attempt, random);

		// Assert
		expect(result).toBe(30_000);
	});
});

describe('parseThinqConnectMqttHost', () => {
	it.each([
		['mqtts://a3x-ats.iot.us-west-2.amazonaws.com:8883', 'a3x-ats.iot.us-west-2.amazonaws.com'],
		['mqtts://a3x-ats.iot.us-west-2.amazonaws.com', 'a3x-ats.iot.us-west-2.amazonaws.com'],
		['a3x-ats.iot.us-west-2.amazonaws.com:8883', 'a3x-ats.iot.us-west-2.amazonaws.com'],
		['a3x-ats.iot.us-west-2.amazonaws.com', 'a3x-ats.iot.us-west-2.amazonaws.com'],
		['mqtts://host.example.com:8883/some/path', 'host.example.com'],
		['mqtts://host.example.com?query=1', 'host.example.com'],
		['  mqtts://host.example.com:8883  ', 'host.example.com'],
	])('should return the bare host for %j', (mqttServer, expected) => {
		// Arrange
		const input = mqttServer;

		// Act
		const result = parseThinqConnectMqttHost(input);

		// Assert
		expect(result).toBe(expected);
	});

	it.each(['', '   ', 'mqtts://', 'mqtts://:8883'])('should throw ThinqConnectApiError when address is %j', (value) => {
		// Arrange
		const input = value;

		// Act
		const act = (): string => parseThinqConnectMqttHost(input);

		// Assert
		expect(act).toThrow(ThinqConnectApiError);
		expect(act).toThrow('ThinQ Connect MQTT server address is empty');
	});
});

describe('parseThinqConnectEventMessage', () => {
	it('should return pushType, deviceId and report key names when the event is valid', () => {
		// Arrange
		const payload = {
			messageId: 'm-1',
			timestamp: 1,
			event: {
				pushType: 'DEVICE_STATUS',
				deviceId: 'dev-1',
				deviceType: '401',
				report: { operation: { airConOperationMode: 'COOL' } },
				userList: [{ userNo: 'secret-user' }],
			},
		};

		// Act
		const result = parseThinqConnectEventMessage(payload);

		// Assert
		expect(result).toEqual({ pushType: 'DEVICE_STATUS', deviceId: 'dev-1', reportKeys: ['operation'] });
	});

	it('should not keep report values or the user list in the parsed result', () => {
		// Arrange
		const payload = {
			event: {
				pushType: 'DEVICE_STATUS',
				deviceId: 'dev-1',
				report: { operation: { airConOperationMode: 'COOL' } },
				userList: [{ userNo: 'secret-user' }],
			},
		};

		// Act
		const result = JSON.stringify(parseThinqConnectEventMessage(payload));

		// Assert
		expect(result).not.toContain('COOL');
		expect(result).not.toContain('secret-user');
	});

	it('should return reportKeys as an empty list when the report is missing', () => {
		// Arrange
		const payload = { event: { pushType: 'DEVICE_STATUS', deviceId: 'dev-1' } };

		// Act
		const result = parseThinqConnectEventMessage(payload);

		// Assert
		expect(result).toEqual({ pushType: 'DEVICE_STATUS', deviceId: 'dev-1', reportKeys: [] });
	});

	it.each([
		['report is a string', { report: 'text' }],
		['report is null', { report: null }],
		['report is an array', { report: [{ operation: {} }] }],
	])('should return empty reportKeys when %s', (_label, extra) => {
		// Arrange
		const payload = { event: { pushType: 'DEVICE_STATUS', deviceId: 'dev-1', ...extra } };

		// Act
		const result = parseThinqConnectEventMessage(payload);

		// Assert
		expect(result?.reportKeys).toEqual([]);
	});

	it.each([
		['pushType is missing', { deviceId: 'dev-1' }],
		['pushType is a number', { pushType: 7, deviceId: 'dev-1' }],
	])('should use UNKNOWN for the push type when %s', (_label, event) => {
		// Arrange
		const payload = { event };

		// Act
		const result = parseThinqConnectEventMessage(payload);

		// Assert
		expect(result?.pushType).toBe('UNKNOWN');
		expect(result?.deviceId).toBe('dev-1');
	});

	it.each([
		['a push message', { push: { pushType: 'DEVICE_PUSH', deviceId: 'dev-1' } }],
		['event has no deviceId', { event: { pushType: 'DEVICE_STATUS' } }],
		['deviceId is empty', { event: { pushType: 'DEVICE_STATUS', deviceId: '' } }],
		['deviceId is a number', { event: { pushType: 'DEVICE_STATUS', deviceId: 42 } }],
		['event is a string', { event: 'DEVICE_STATUS' }],
		['event is null', { event: null }],
		['event is an array', { event: [{ deviceId: 'dev-1' }] }],
		['payload is null', null],
		['payload is a string', 'event'],
		['payload is a number', 42],
		['payload is undefined', undefined],
		['payload is an array', [{ event: { pushType: 'DEVICE_STATUS', deviceId: 'dev-1' } }]],
	])('should return undefined when %s', (_label, payload) => {
		// Arrange
		const input: unknown = payload;

		// Act
		const result = parseThinqConnectEventMessage(input);

		// Assert
		expect(result).toBeUndefined();
	});
});
