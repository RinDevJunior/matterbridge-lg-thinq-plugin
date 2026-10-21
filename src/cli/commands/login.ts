import { AnsiLogger } from 'matterbridge/logger';

import { AccountAuthStrategy } from '../../services/authentication/AccountAuthStrategy.js';
import type { ThinqAuthContext } from '../../services/authentication/AuthContext.js';
import { AuthenticationCoordinator } from '../../services/authentication/AuthenticationCoordinator.js';
import { TokenAuthStrategy } from '../../services/authentication/TokenAuthStrategy.js';
import { ThinqSession } from '../../services/thinq/session.js';
import { ThinqApiClient } from '../../services/thinq/thinqApiClient.js';
import { saveSession } from '../session.js';
import { maskSecret } from '../utils.js';
import { prompt } from '../utils.js';
import { cmdLoginPat } from './loginPat.js';

export type CliLoginType = 'account' | 'token' | 'pat';

async function buildAuthContext(
	type: Exclude<CliLoginType, 'pat'>,
	country: string,
	language: string,
): Promise<ThinqAuthContext> {
	if (type === 'token') {
		const refreshToken = await prompt('Refresh token: ');
		return {
			refreshToken,
			country,
			language,
		};
	}

	// type === 'account'
	const username = await prompt('Username (email): ');
	const password = await prompt('Password: ');
	return {
		username,
		password,
		country,
		language,
	};
}

export async function cmdLogin(
	type: CliLoginType,
	country: string,
	language: string,
	logger: AnsiLogger,
): Promise<void> {
	if (type === 'pat') {
		await cmdLoginPat(country, logger);
		return;
	}

	const context = await buildAuthContext(type, country, language);

	const apiClient = new ThinqApiClient(new ThinqSession('', '', 0), country, language, logger);
	const accountStrategy = new AccountAuthStrategy(apiClient, logger);
	const tokenStrategy = new TokenAuthStrategy(apiClient, logger);
	const coordinator = new AuthenticationCoordinator(accountStrategy, tokenStrategy, apiClient, logger);

	const userData = await coordinator.authenticate(type, context);

	if (!userData) {
		console.error('Login did not complete: no session data was returned (a manual process may be required).');
		process.exitCode = 1;
		return;
	}

	const session = {
		loginType: type,
		country,
		language,
		userData,
	};

	saveSession(session);

	console.log('Login successful. Session saved to .cli-session.json');
	console.log('Session Summary:');
	console.log(`  Login Type: ${session.loginType}`);
	console.log(`  Country: ${session.country}`);
	console.log(`  Language: ${session.language}`);
	console.log(`  Access Token: ${maskSecret(session.userData.accessToken)}`);
	console.log(`  Refresh Token: ${maskSecret(session.userData.refreshToken)}`);
	console.log(`  Expires At: ${new Date(session.userData.expiresAtEpochSeconds * 1000).toISOString()}`);
}
