import { promises as fs } from 'node:fs';
import os from 'node:os';
import Path from 'node:path';

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	ATS_ROOT_CA_URL,
	certificateRequestBody,
	createMqttCsr,
	downloadRootCa,
	generateMqttKeyPair,
	LEGACY_ROOT_CA_URL,
	LG_ROOT_CA_URL,
	mqttCertificatePaths,
	rootCaUrlForMqttHost,
	writeIfChanged,
	writeMqttCertificateFiles,
} from './mqttCertificate.js';

describe('mqttCertificate', () => {
	let mockAxios: MockAdapter;
	let tempDir: string;

	beforeEach(() => {
		vi.clearAllMocks();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockAxios = new MockAdapter(axios as any);
	});

	afterEach(() => {
		mockAxios.reset();
		vi.clearAllMocks();
	});

	describe('rootCaUrlForMqttHost', () => {
		it('should return ATS_ROOT_CA_URL for AWS ATS hostname pattern', () => {
			const url = rootCaUrlForMqttHost('something-ats.iot.us-east-1.amazonaws.com');
			expect(url).toBe(ATS_ROOT_CA_URL);
		});

		it('should return ATS_ROOT_CA_URL for any AWS ATS pattern', () => {
			const url = rootCaUrlForMqttHost('other-ats.iot.eu-west-1.amazonaws.com');
			expect(url).toBe(ATS_ROOT_CA_URL);
		});

		it('should return LG_ROOT_CA_URL for LG ruic hostname pattern', () => {
			const url = rootCaUrlForMqttHost('abc123.iot.ruic.lgthinq.com');
			expect(url).toBe(LG_ROOT_CA_URL);
		});

		it('should return LEGACY_ROOT_CA_URL for other hostnames', () => {
			const url = rootCaUrlForMqttHost('random.mqtt.example.com');
			expect(url).toBe(LEGACY_ROOT_CA_URL);
		});

		it('should return LEGACY_ROOT_CA_URL for localhost', () => {
			const url = rootCaUrlForMqttHost('localhost');
			expect(url).toBe(LEGACY_ROOT_CA_URL);
		});
	});

	describe('certificateRequestBody', () => {
		it('should strip PEM header and footer', () => {
			const csr = `-----BEGIN CERTIFICATE REQUEST-----
MIICpDCCAYwCAQAwEzERMA8GA1UEAwwIVGVzdCBDU1I=
-----END CERTIFICATE REQUEST-----`;
			const result = certificateRequestBody(csr);
			expect(result).toBe('MIICpDCCAYwCAQAwEzERMA8GA1UEAwwIVGVzdCBDU1I=');
		});

		it('should remove all newlines', () => {
			const csr = `-----BEGIN CERTIFICATE REQUEST-----
Line1
Line2
-----END CERTIFICATE REQUEST-----`;
			const result = certificateRequestBody(csr);
			expect(result).not.toContain('\n');
			expect(result).not.toContain('\r');
		});

		it('should handle Windows line endings', () => {
			const csr = `-----BEGIN CERTIFICATE REQUEST-----\r\nMIIBpDCCAYwCAQAwEzERMA8GA1UEAwwIVGVzdCBDU1I=\r\n-----END CERTIFICATE REQUEST-----`;
			const result = certificateRequestBody(csr);
			expect(result).toBe('MIIBpDCCAYwCAQAwEzERMA8GA1UEAwwIVGVzdCBDU1I=');
			expect(result).not.toContain('\r');
			expect(result).not.toContain('\n');
		});

		it('should return empty string for PEM markers with no content', () => {
			const csr = `-----BEGIN CERTIFICATE REQUEST-----
-----END CERTIFICATE REQUEST-----`;
			const result = certificateRequestBody(csr);
			expect(result).toBe('');
		});
	});

	describe('generateMqttKeyPair', () => {
		it('should return a key pair with privateKey and publicKey', () => {
			const keyPair = generateMqttKeyPair();

			expect(keyPair).toHaveProperty('privateKey');
			expect(keyPair).toHaveProperty('publicKey');
			expect(typeof keyPair.privateKey).toBe('string');
			expect(typeof keyPair.publicKey).toBe('string');
		});

		it('should generate RSA keys that contain PEM headers', () => {
			const keyPair = generateMqttKeyPair();

			expect(keyPair.privateKey).toContain('BEGIN RSA PRIVATE KEY');
			expect(keyPair.publicKey).toContain('BEGIN PUBLIC KEY');
		});

		it('should generate unique key pairs', () => {
			const keyPair1 = generateMqttKeyPair();
			const keyPair2 = generateMqttKeyPair();

			expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
			expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
		});
	});

	describe('createMqttCsr', () => {
		it('should return a CSR with PEM format', () => {
			const keyPair = generateMqttKeyPair();
			const csr = createMqttCsr(keyPair);

			expect(csr).toContain('BEGIN CERTIFICATE REQUEST');
			expect(csr).toContain('END CERTIFICATE REQUEST');
		});

		it('should create a CSR for the generated key pair', () => {
			const keyPair = generateMqttKeyPair();
			const csr = createMqttCsr(keyPair);

			expect(csr).toBeTruthy();
			expect(typeof csr).toBe('string');
		});

		it('should generate different CSRs for different key pairs', () => {
			const keyPair1 = generateMqttKeyPair();
			const keyPair2 = generateMqttKeyPair();
			const csr1 = createMqttCsr(keyPair1);
			const csr2 = createMqttCsr(keyPair2);

			expect(csr1).not.toBe(csr2);
		});
	});

	describe('mqttCertificatePaths', () => {
		it('should return paths object with caPath, keyPath, and certPath', () => {
			const mqttDir = '/tmp/mqtt';
			const paths = mqttCertificatePaths(mqttDir);

			expect(paths).toHaveProperty('caPath');
			expect(paths).toHaveProperty('keyPath');
			expect(paths).toHaveProperty('certPath');
		});

		it('should join paths correctly', () => {
			const mqttDir = '/tmp/mqtt';
			const paths = mqttCertificatePaths(mqttDir);

			expect(paths.caPath).toBe(Path.join(mqttDir, 'ca.pem'));
			expect(paths.keyPath).toBe(Path.join(mqttDir, 'key.pem'));
			expect(paths.certPath).toBe(Path.join(mqttDir, 'cert.pem'));
		});
	});

	describe('writeIfChanged', () => {
		beforeEach(async () => {
			tempDir = await fs.mkdtemp(Path.join(os.tmpdir(), 'mqtt-test-'));
		});

		afterEach(async () => {
			if (tempDir) {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		});

		it('should write file when target does not exist', async () => {
			const filePath = Path.join(tempDir, 'test.txt');
			const content = 'test content';

			await writeIfChanged(filePath, content);

			const written = await fs.readFile(filePath, 'utf8');
			expect(written).toBe(content);
		});

		it('should write file when content differs from existing', async () => {
			const filePath = Path.join(tempDir, 'test.txt');
			const oldContent = 'old content';
			const newContent = 'new content';

			await fs.writeFile(filePath, oldContent, 'utf8');
			await writeIfChanged(filePath, newContent);

			const written = await fs.readFile(filePath, 'utf8');
			expect(written).toBe(newContent);
		});

		it('should not write file when content is identical to existing', async () => {
			const filePath = Path.join(tempDir, 'test.txt');
			const content = 'same content';

			await fs.writeFile(filePath, content, 'utf8');
			const writeFileSpy = vi.spyOn(fs, 'writeFile');

			await writeIfChanged(filePath, content);

			expect(writeFileSpy).not.toHaveBeenCalled();
			writeFileSpy.mockRestore();
		});

		it('should handle file read errors gracefully', async () => {
			const filePath = Path.join(tempDir, 'nonexistent', 'test.txt');
			const content = 'new content';

			// Create the parent directory
			await fs.mkdir(Path.dirname(filePath), { recursive: true });
			await writeIfChanged(filePath, content);

			const written = await fs.readFile(filePath, 'utf8');
			expect(written).toBe(content);
		});
	});

	describe('downloadRootCa', () => {
		it('should download root CA with responseType text', async () => {
			const hostname = 'test-ats.iot.us-east-1.amazonaws.com';
			const pemContent = '-----BEGIN CERTIFICATE-----\nTest PEM\n-----END CERTIFICATE-----';

			mockAxios.onGet(ATS_ROOT_CA_URL).reply(200, pemContent);

			const result = await downloadRootCa(hostname);

			expect(result).toBe(pemContent);
			const request = mockAxios.history.get[0];
			expect(request.responseType).toBe('text');
		});

		it('should use correct URL for LG ruic hostname', async () => {
			const hostname = 'abc.iot.ruic.lgthinq.com';
			const pemContent = 'LG Root CA PEM';

			mockAxios.onGet(LG_ROOT_CA_URL).reply(200, pemContent);

			const result = await downloadRootCa(hostname);

			expect(result).toBe(pemContent);
		});

		it('should use legacy URL for unknown hostname', async () => {
			const hostname = 'unknown.example.com';
			const pemContent = 'Legacy Root CA PEM';

			mockAxios.onGet(LEGACY_ROOT_CA_URL).reply(200, pemContent);

			const result = await downloadRootCa(hostname);

			expect(result).toBe(pemContent);
		});

		it('should not attach auth headers to root CA download', async () => {
			const hostname = 'test-ats.iot.us-east-1.amazonaws.com';
			const pemContent = 'Root CA';

			mockAxios.onGet(ATS_ROOT_CA_URL).reply(200, pemContent);

			await downloadRootCa(hostname);

			const request = mockAxios.history.get[0];
			expect(request.headers).not.toHaveProperty('x-emp-token');
			expect(request.headers).not.toHaveProperty('authorization');
		});
	});

	describe('writeMqttCertificateFiles', () => {
		beforeEach(async () => {
			tempDir = await fs.mkdtemp(Path.join(os.tmpdir(), 'mqtt-test-'));
		});

		afterEach(async () => {
			if (tempDir) {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		});

		it('should write all three certificate files', async () => {
			const mqttDir = Path.join(tempDir, 'mqtt');
			const rootCA = 'root-ca-pem';
			const privateKey = 'private-key-pem';
			const certificatePem = 'cert-pem';

			const paths = await writeMqttCertificateFiles({
				mqttDir,
				rootCA,
				privateKey,
				certificatePem,
			});

			const caContent = await fs.readFile(paths.caPath, 'utf8');
			const keyContent = await fs.readFile(paths.keyPath, 'utf8');
			const certContent = await fs.readFile(paths.certPath, 'utf8');

			expect(caContent).toBe(rootCA);
			expect(keyContent).toBe(privateKey);
			expect(certContent).toBe(certificatePem);
		});

		it('should create mqttDir recursively if it does not exist', async () => {
			const mqttDir = Path.join(tempDir, 'nested', 'mqtt', 'dir');

			await writeMqttCertificateFiles({
				mqttDir,
				rootCA: 'ca',
				privateKey: 'key',
				certificatePem: 'cert',
			});

			const stat = await fs.stat(mqttDir);
			expect(stat.isDirectory()).toBe(true);
		});

		it('should return the correct paths', async () => {
			const mqttDir = Path.join(tempDir, 'mqtt');

			const paths = await writeMqttCertificateFiles({
				mqttDir,
				rootCA: 'ca',
				privateKey: 'key',
				certificatePem: 'cert',
			});

			expect(paths.caPath).toBe(Path.join(mqttDir, 'ca.pem'));
			expect(paths.keyPath).toBe(Path.join(mqttDir, 'key.pem'));
			expect(paths.certPath).toBe(Path.join(mqttDir, 'cert.pem'));
		});
	});
});
