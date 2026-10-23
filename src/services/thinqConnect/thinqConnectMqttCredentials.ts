import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

import axios from 'axios';
import forge from 'node-forge';

import { ThinqConnectApiError } from '../../errors/index.js';

export const THINQ_CONNECT_ROOT_CA_URL = 'https://www.amazontrust.com/repository/AmazonRootCA1.pem';
const ROOT_CA_TIMEOUT_MS = 15000;

const generateKeyPairAsync = promisify(generateKeyPair);

/** Held in memory only; never log or write these to disk. */
export interface ThinqConnectMqttCredentials {
	privateKeyPem: string;
	csrBody: string;
}

/** Generates the RSA key off the event loop (node:crypto); forge only builds the CSR. */
export async function createThinqConnectMqttCredentials(): Promise<ThinqConnectMqttCredentials> {
	const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
	const csr = forge.pki.createCertificationRequest();
	csr.publicKey = forge.pki.publicKeyFromPem(publicKey);
	csr.setSubject([{ shortName: 'CN', value: 'lg_thinq' }]);
	csr.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha512.create());
	const csrBody = forge.pki
		.certificationRequestToPem(csr)
		.replace(/-----(BEGIN|END) CERTIFICATE REQUEST-----/g, '')
		.replace(/\s+/g, '');
	return { privateKeyPem: privateKey, csrBody };
}

export async function downloadThinqConnectRootCa(): Promise<string> {
	const response = await axios.get<string>(THINQ_CONNECT_ROOT_CA_URL, {
		responseType: 'text',
		timeout: ROOT_CA_TIMEOUT_MS,
	});
	const pem = response.data;
	if (typeof pem !== 'string' || !pem.includes('BEGIN CERTIFICATE')) {
		throw new ThinqConnectApiError('ThinQ Connect root CA download is not a certificate');
	}
	return pem;
}
