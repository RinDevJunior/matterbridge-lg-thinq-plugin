import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectThinqConnectMqtt, type ThinqConnectMqttConnectOptions } from './thinqConnectMqttConnector.js';

const { deviceCtor, fakeConnection } = vi.hoisted(() => {
	const connection = { on: vi.fn(), subscribe: vi.fn(), end: vi.fn() };
	const ctor = vi.fn(function (_options: Record<string, unknown>) {
		return connection;
	});
	return { deviceCtor: ctor, fakeConnection: connection };
});

vi.mock('aws-iot-device-sdk', () => ({ device: deviceCtor }));

const HOST = 'a3x-ats.iot.us-west-2.amazonaws.com';
const CLIENT_ID = 'thinq-open-11111111-2222-3333-4444-555555555555';
const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nKEYDATA\n-----END PRIVATE KEY-----';
const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nCERTDATA\n-----END CERTIFICATE-----';
const ROOT_CA = '-----BEGIN CERTIFICATE-----\nROOTDATA\n-----END CERTIFICATE-----';

function buildOptions(): ThinqConnectMqttConnectOptions {
	return {
		host: HOST,
		clientId: CLIENT_ID,
		privateKeyPem: PRIVATE_KEY,
		certificatePem: CERTIFICATE,
		rootCaPem: ROOT_CA,
	};
}

describe('connectThinqConnectMqtt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should construct the SDK device with the host, client id and reconnect settings when connecting', () => {
		// Arrange
		const options = buildOptions();

		// Act
		connectThinqConnectMqtt(options);

		// Assert
		expect(deviceCtor).toHaveBeenCalledTimes(1);
		expect(deviceCtor).toHaveBeenCalledWith(
			expect.objectContaining({
				host: HOST,
				clientId: CLIENT_ID,
				keepalive: 60,
				clean: false,
				baseReconnectTimeMs: 5000,
				maximumReconnectTimeMs: 300000,
				autoResubscribe: true,
				protocol: 'mqtts',
			}),
		);
	});

	it('should pass the key, certificate and root CA as Buffers when connecting', () => {
		// Arrange
		const options = buildOptions();

		// Act
		connectThinqConnectMqtt(options);

		// Assert
		const sdkOptions = deviceCtor.mock.calls[0]?.[0];
		expect(Buffer.isBuffer(sdkOptions?.['privateKey'])).toBe(true);
		expect(Buffer.isBuffer(sdkOptions?.['clientCert'])).toBe(true);
		expect(Buffer.isBuffer(sdkOptions?.['caCert'])).toBe(true);
		expect(sdkOptions?.['privateKey']).toEqual(Buffer.from(PRIVATE_KEY));
		expect(sdkOptions?.['clientCert']).toEqual(Buffer.from(CERTIFICATE));
		expect(sdkOptions?.['caCert']).toEqual(Buffer.from(ROOT_CA));
	});

	it('should not pass any key, certificate or CA file paths when connecting', () => {
		// Arrange
		const options = buildOptions();

		// Act
		connectThinqConnectMqtt(options);

		// Assert
		const sdkOptions = deviceCtor.mock.calls[0]?.[0];
		expect(sdkOptions).not.toHaveProperty('keyPath');
		expect(sdkOptions).not.toHaveProperty('certPath');
		expect(sdkOptions).not.toHaveProperty('caPath');
	});

	it('should return the SDK connection object when connecting', () => {
		// Arrange
		const options = buildOptions();

		// Act
		const connection = connectThinqConnectMqtt(options);

		// Assert
		expect(connection).toBe(fakeConnection);
	});
});
