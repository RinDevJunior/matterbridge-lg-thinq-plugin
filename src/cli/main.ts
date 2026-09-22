import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { cmdDevices } from './commands/devices.js';
import { cmdEnergy, parseEnergyOptions } from './commands/energy.js';
import { cmdLogin } from './commands/login.js';
import { HELP_TEXT } from './help.js';
import { loadSession } from './session.js';
import { parseArgs } from './utils.js';

export async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const command = args['command'];

	const help = args['help'] === 'true';
	if (!command || command === 'help' || help) {
		console.log(HELP_TEXT);
		process.exit(command || help ? 0 : 1);
	}

	const debug = args['debug'] === 'true';
	const logger = AnsiLogger.create({ logName: 'CLI', logLevel: debug ? LogLevel.DEBUG : LogLevel.WARN });

	try {
		if (command === 'login') {
			const type = (args['type'] || 'account') as 'account' | 'token';
			const country = args['country'] || 'US';
			const language = args['language'] || 'en-US';

			await cmdLogin(type, country, language, logger);
			return;
		}

		if (command === 'devices') {
			const session = loadSession();
			if (!session) {
				console.error('No session found. Run `--command login` first.');
				process.exitCode = 1;
				return;
			}

			const dumpSnapshotDeviceId = args['dump-snapshot'];
			await cmdDevices(session, logger, dumpSnapshotDeviceId);
			return;
		}

		if (command === 'energy') {
			const options = parseEnergyOptions(args);
			const session = loadSession();
			if (!session) {
				console.error('No session found. Run `--command login` first.');
				process.exitCode = 1;
				return;
			}

			await cmdEnergy(session, options, logger);
			return;
		}

		console.error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
		process.exit(1);
	} catch (err) {
		console.error('Error:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
