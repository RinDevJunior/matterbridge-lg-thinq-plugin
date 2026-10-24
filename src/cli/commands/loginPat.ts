import { AnsiLogger } from 'matterbridge/logger';

import { ThinqConnectApiClient } from '../../services/thinqConnect/thinqConnectApiClient.js';
import { savePatSession } from '../session.js';
import { maskSecret, prompt } from '../utils.js';

export async function cmdLoginPat(country: string, logger: AnsiLogger): Promise<void> {
	const pat = await prompt('Personal Access Token: ');
	if (!pat) {
		console.error('A Personal Access Token is required.');
		process.exitCode = 1;
		return;
	}

	let validation;
	try {
		validation = await new ThinqConnectApiClient(pat, country, logger).validateToken();
	} catch (error) {
		console.error('Login failed:', error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
	}

	savePatSession({ country, personalAccessToken: pat });

	console.log('Login successful. Personal Access Token saved to .cli-pat-session.json');
	console.log('Session Summary:');
	console.log('  Login Type: pat');
	console.log(`  Country: ${country}`);
	console.log(`  Personal Access Token: ${maskSecret(pat)}`);
	console.log(`  Devices visible: ${validation.deviceCount}`);
	for (const device of validation.devices) {
		console.log(
			`  - ${device.deviceInfo?.alias ?? '(no alias)'} [${device.deviceInfo?.deviceType ?? 'unknown'}] ${device.deviceInfo?.modelName ?? ''} (${device.deviceId})`,
		);
	}
}
