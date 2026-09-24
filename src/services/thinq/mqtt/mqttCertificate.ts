import FS from 'node:fs';
import Path from 'node:path';

import axios from 'axios';
import forge from 'node-forge';

export const ATS_ROOT_CA_URL = 'https://www.amazontrust.com/repository/AmazonRootCA1.pem';
export const LG_ROOT_CA_URL = 'https://support.sectigo.com/sfc/servlet.shepherd/version/download/0683l00000G9fLm';
export const LEGACY_ROOT_CA_URL =
	'https://www.websecurity.digicert.com/content/dam/websitesecurity/digitalassets/desktop/pdfs/roots/' +
	'VeriSign-Class%203-Public-Primary-Certification-Authority-G5.pem';

export interface MqttKeyPair {
	privateKey: string;
	publicKey: string;
}

export interface MqttCertificatePaths {
	caPath: string;
	keyPath: string;
	certPath: string;
}

/** Generates a fresh 2048-bit RSA key pair for MQTT client certificate enrollment. */
export function generateMqttKeyPair(): MqttKeyPair {
	const keys = forge.pki.rsa.generateKeyPair(2048);

	return {
		privateKey: forge.pki.privateKeyToPem(keys.privateKey),
		publicKey: forge.pki.publicKeyToPem(keys.publicKey),
	};
}

/** Builds a self-signed CSR (CN=`AWS IoT Certificate`, O=`Amazon`, sha256) for the given key pair. */
export function createMqttCsr(keys: MqttKeyPair): string {
	const csr = forge.pki.createCertificationRequest();
	csr.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
	csr.setSubject([
		{ shortName: 'CN', value: 'AWS IoT Certificate' },
		{ shortName: 'O', value: 'Amazon' },
	]);
	csr.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());

	return forge.pki.certificationRequestToPem(csr);
}

/** Strips PEM header/footer/newlines from a CSR, producing the flat body the ThinQ API expects. */
export function certificateRequestBody(csr: string): string {
	return csr.replace(/-----(BEGIN|END) CERTIFICATE REQUEST-----/g, '').replace(/(\r\n|\r|\n)/g, '');
}

/** Picks the correct root-CA download URL for a given MQTT broker hostname. */
export function rootCaUrlForMqttHost(hostname: string): string {
	if (/^([^.]+)-ats\.iot\.([^.]+)\.amazonaws\.com$/g.exec(hostname)) {
		return ATS_ROOT_CA_URL;
	}

	if (/^([^.]+)\.iot\.ruic\.lgthinq\.com$/g.exec(hostname)) {
		return LG_ROOT_CA_URL;
	}

	return LEGACY_ROOT_CA_URL;
}

/** Downloads the root CA PEM for the given MQTT broker hostname. Plain unauthenticated GET (public CA host). */
export async function downloadRootCa(hostname: string): Promise<string> {
	const response = await axios.get<string>(rootCaUrlForMqttHost(hostname), { responseType: 'text' });
	return response.data;
}

export function mqttCertificatePaths(mqttDir: string): MqttCertificatePaths {
	return {
		caPath: Path.join(mqttDir, 'ca.pem'),
		keyPath: Path.join(mqttDir, 'key.pem'),
		certPath: Path.join(mqttDir, 'cert.pem'),
	};
}

/** Writes `content` to `path` only if it differs from the existing file contents (or the file doesn't exist). */
export async function writeIfChanged(path: string, content: string): Promise<void> {
	const existing = await FS.promises.readFile(path, 'utf8').catch(() => null);
	if (existing !== content) {
		await FS.promises.writeFile(path, content, 'utf8');
	}
}

export async function writeMqttCertificateFiles(options: {
	mqttDir: string;
	rootCA: string;
	privateKey: string;
	certificatePem: string;
}): Promise<MqttCertificatePaths> {
	const { mqttDir, rootCA, privateKey, certificatePem } = options;
	await FS.promises.mkdir(mqttDir, { recursive: true });

	const paths = mqttCertificatePaths(mqttDir);
	await writeIfChanged(paths.caPath, rootCA);
	await writeIfChanged(paths.keyPath, privateKey);
	await writeIfChanged(paths.certPath, certificatePem);

	return paths;
}
