import { createPrivateKey } from 'node:crypto';

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThinqConnectApiError } from '../../errors/index.js';
import {
	createThinqConnectMqttCredentials,
	downloadThinqConnectRootCa,
	THINQ_CONNECT_ROOT_CA_URL,
} from './thinqConnectMqttCredentials.js';

const KEYGEN_TIMEOUT_MS = 15_000;
const ROOT_CA_PEM = '-----BEGIN CERTIFICATE-----\nROOTCADATA\n-----END CERTIFICATE-----\n';

/** Re-wraps a CSR body (no header, footer or newlines) as a PEM CSR the way the LG API expects it back. */
function wrapAsCsrPem(csrBody: string): string {
	const lines = csrBody.match(/.{1,64}/g) ?? [];
	return ['-----BEGIN CERTIFICATE REQUEST-----', ...lines, '-----END CERTIFICATE REQUEST-----'].join('\n');
}

describe('createThinqConnectMqttCredentials', () => {
	it(
		'should return a PKCS#8 private key PEM when generating credentials',
		async () => {
			// Arrange
			// (no input; generates a fresh RSA key pair)

			// Act
			const credentials = await createThinqConnectMqttCredentials();

			// Assert
			expect(credentials.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
			expect(credentials.privateKeyPem).toMatch(/-----END PRIVATE KEY-----\n?$/);
		},
		KEYGEN_TIMEOUT_MS,
	);

	it(
		'should return a 2048-bit RSA private key when generating credentials',
		async () => {
			// Arrange
			// (no input; generates a fresh RSA key pair)

			// Act
			const credentials = await createThinqConnectMqttCredentials();
			const details = createPrivateKey(credentials.privateKeyPem).asymmetricKeyDetails;

			// Assert
			expect(details?.modulusLength).toBe(2048);
		},
		KEYGEN_TIMEOUT_MS,
	);

	it(
		'should return a csrBody with no header, footer or newlines when generating credentials',
		async () => {
			// Arrange
			// (no input; generates a fresh RSA key pair)

			// Act
			const credentials = await createThinqConnectMqttCredentials();

			// Assert
			expect(credentials.csrBody).not.toContain('BEGIN');
			expect(credentials.csrBody).not.toContain('END');
			expect(credentials.csrBody).not.toMatch(/\s/);
			expect(credentials.csrBody.length).toBeGreaterThan(0);
		},
		KEYGEN_TIMEOUT_MS,
	);

	it(
		'should return a CSR that verifies with subject CN lg_thinq when re-wrapped as PEM',
		async () => {
			// Arrange
			const credentials = await createThinqConnectMqttCredentials();

			// Act
			const csr = forge.pki.certificationRequestFromPem(wrapAsCsrPem(credentials.csrBody));

			// Assert
			expect(csr.verify()).toBe(true);
			expect(csr.subject.getField('CN')).toMatchObject({ value: 'lg_thinq' });
		},
		KEYGEN_TIMEOUT_MS,
	);

	it(
		'should return different keys when called twice',
		async () => {
			// Arrange
			// (two independent calls)

			// Act
			const first = await createThinqConnectMqttCredentials();
			const second = await createThinqConnectMqttCredentials();

			// Assert
			expect(first.privateKeyPem).not.toBe(second.privateKeyPem);
			expect(first.csrBody).not.toBe(second.csrBody);
		},
		KEYGEN_TIMEOUT_MS,
	);
});

describe('downloadThinqConnectRootCa', () => {
	let mockAxios: MockAdapter;

	beforeEach(() => {
		mockAxios = new MockAdapter(axios as ConstructorParameters<typeof MockAdapter>[0]);
	});

	afterEach(() => {
		mockAxios.reset();
	});

	it('should return the PEM body when the root CA download is a certificate', async () => {
		// Arrange
		mockAxios.onGet(THINQ_CONNECT_ROOT_CA_URL).reply(200, ROOT_CA_PEM);

		// Act
		const result = await downloadThinqConnectRootCa();

		// Assert
		expect(result).toBe(ROOT_CA_PEM);
		expect(mockAxios.history.get).toHaveLength(1);
		expect(mockAxios.history.get[0]?.url).toBe(THINQ_CONNECT_ROOT_CA_URL);
	});

	it('should request the root CA as text with a 15 s timeout', async () => {
		// Arrange
		mockAxios.onGet(THINQ_CONNECT_ROOT_CA_URL).reply(200, ROOT_CA_PEM);

		// Act
		await downloadThinqConnectRootCa();

		// Assert
		expect(mockAxios.history.get[0]?.timeout).toBe(15_000);
		expect(mockAxios.history.get[0]?.responseType).toBe('text');
	});

	it.each([
		['the body has no certificate', '<html>Access denied</html>'],
		['the body is empty', ''],
	])('should reject with ThinqConnectApiError when %s', async (_label, body) => {
		// Arrange
		mockAxios.onGet(THINQ_CONNECT_ROOT_CA_URL).reply(200, body);

		// Act
		const act = downloadThinqConnectRootCa();

		// Assert
		await expect(act).rejects.toThrow(ThinqConnectApiError);
		await expect(act).rejects.toThrow('ThinQ Connect root CA download is not a certificate');
	});

	it('should reject when the server responds with HTTP 500', async () => {
		// Arrange
		mockAxios.onGet(THINQ_CONNECT_ROOT_CA_URL).reply(500, 'server error');

		// Act
		const act = downloadThinqConnectRootCa();

		// Assert
		await expect(act).rejects.toThrow();
	});
});
