import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { cmdConnectControl } from './commands/connectControl.js';
import { parseConnectEnergyOptions } from './commands/connectEnergy.js';
import { cmdConnectProbe, type ConnectProbeOptions } from './commands/connectProbe.js';
import { cmdConnectSettings } from './commands/connectSettings.js';
import { cmdDevices } from './commands/devices.js';
import { cmdEnergy, parseEnergyOptions } from './commands/energy.js';
import { type CliLoginType, cmdLogin } from './commands/login.js';
import { cmdWasherControl, parseWasherControlOptions } from './commands/washerControl.js';
import { cmdWasherStatus, parseWasherStatusOptions } from './commands/washerStatus.js';
import { HELP_TEXT } from './help.js';
import { type OutputCapture, startOutputCapture } from './outputCapture.js';
import { loadPatSession, loadSession } from './session.js';
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

	let capture: OutputCapture | undefined;
	if (args['out'] !== undefined) {
		if (command === 'login') {
			console.error('--out is not supported for login (it prompts for secrets).');
			process.exitCode = 1;
			return;
		}
		try {
			capture = startOutputCapture(args['out'], {
				command,
				country: args['country'],
				showSecrets: args['show-secrets'] === 'true',
			});
		} catch (err) {
			console.error(`--out: ${err instanceof Error ? err.message : String(err)}`);
			process.exitCode = 1;
			return;
		}
	}

	try {
		if (command === 'login') {
			const type = (args['type'] || 'account') as CliLoginType;
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
			const probeFilterDeviceId = args['probe-filter'];
			await cmdDevices(session, logger, dumpSnapshotDeviceId, probeFilterDeviceId, {
				dumpDeviceId: args['dump-device'],
				showSecrets: args['show-secrets'] === 'true',
			});
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

		if (command === 'connect-probe') {
			const patSession = loadPatSession();
			if (!patSession) {
				console.error('No PAT session found. Run `--command login --type pat` first.');
				process.exitCode = 1;
				return;
			}

			const probeOptions: ConnectProbeOptions = {
				deviceId: args['device-id'],
				raw: args['raw'] === 'true',
				showSecrets: args['show-secrets'] === 'true',
			};
			if (args['energy'] === 'true') {
				const parsed = parseConnectEnergyOptions(args);
				if ('error' in parsed) {
					console.error(parsed.error);
					process.exitCode = 1;
					return;
				}
				probeOptions.energy = parsed.options;
			}

			await cmdConnectProbe(patSession, probeOptions, logger);
			return;
		}

		if (command === 'connect-settings') {
			const patSession = loadPatSession();
			if (!patSession) {
				console.error('No PAT session found. Run `--command login --type pat` first.');
				process.exitCode = 1;
				return;
			}

			await cmdConnectSettings(patSession, { deviceId: args['device-id'], brief: args['brief'] === 'true' }, logger);
			return;
		}

		if (command === 'connect-control') {
			const patSession = loadPatSession();
			if (!patSession) {
				console.error('No PAT session found. Run `--command login --type pat` first.');
				process.exitCode = 1;
				return;
			}

			const waitArg = Number(args['wait']);
			const waitSeconds = args['wait'] !== undefined && Number.isFinite(waitArg) && waitArg >= 0 ? waitArg : 3;
			await cmdConnectControl(
				patSession,
				{ deviceId: args['device-id'], send: args['send'], yes: args['yes'] === 'true', waitSeconds },
				logger,
			);
			return;
		}

		if (command === 'washer-status') {
			const statusOptions = parseWasherStatusOptions(args);
			const session = loadSession();
			if (!session) {
				console.error('No session found. Run `--command login` first.');
				process.exitCode = 1;
				return;
			}

			await cmdWasherStatus(session, statusOptions, logger);
			return;
		}

		if (command === 'washer-control') {
			const controlOptions = parseWasherControlOptions(args);
			const session = loadSession();
			if (!session) {
				console.error('No session found. Run `--command login` first.');
				process.exitCode = 1;
				return;
			}

			await cmdWasherControl(session, controlOptions, logger);
			return;
		}

		console.error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
		capture?.finish();
		process.exit(1);
	} catch (err) {
		console.error('Error:', err instanceof Error ? err.message : String(err));
		capture?.finish();
		process.exit(1);
	} finally {
		capture?.finish();
	}
}
