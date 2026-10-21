import { device as awsIotDevice } from 'aws-iot-device-sdk';

export interface ThinqConnectMqttConnection {
	on(event: 'connect' | 'offline' | 'close' | 'reconnect', handler: () => void): unknown;
	on(event: 'error', handler: (error: unknown) => void): unknown;
	on(event: 'message', handler: (topic: string, payload: Buffer) => void): unknown;
	subscribe(topic: string, options: { qos: 0 | 1 }, callback: (error?: unknown) => void): unknown;
	end(force?: boolean, callback?: () => void): unknown;
}

export interface ThinqConnectMqttConnectOptions {
	host: string;
	clientId: string;
	privateKeyPem: string;
	certificatePem: string;
	rootCaPem: string;
}

export type ThinqConnectMqttConnector = (options: ThinqConnectMqttConnectOptions) => ThinqConnectMqttConnection;

/** Opens the mTLS connection with in-memory Buffers (no key/cert files); reconnects through the SDK. */
export const connectThinqConnectMqtt: ThinqConnectMqttConnector = (options) =>
	new awsIotDevice({
		host: options.host,
		clientId: options.clientId,
		privateKey: Buffer.from(options.privateKeyPem),
		clientCert: Buffer.from(options.certificatePem),
		caCert: Buffer.from(options.rootCaPem),
		keepalive: 60,
		clean: false,
		baseReconnectTimeMs: 5000,
		maximumReconnectTimeMs: 300000,
		autoResubscribe: true,
		protocol: 'mqtts',
	});
