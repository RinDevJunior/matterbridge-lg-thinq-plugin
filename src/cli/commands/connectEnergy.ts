import { ThinqConnectApiError } from '../../errors/index.js';
import {
	THINQ_CONNECT_ENERGY_PERIODS,
	type ThinqConnectApiClient,
	type ThinqConnectEnergyPeriod,
} from '../../services/thinqConnect/thinqConnectApiClient.js';
import {
	defaultEnergyRange,
	describeEnergyResultCode,
	isEnergyNotSupportedCode,
	readEnergyProperties,
	readEnergyResultCode,
	readEnergyUsageRows,
	summarizeEnergyUsage,
} from '../../services/thinqConnect/thinqConnectEnergy.js';

export interface ConnectEnergyOptions {
	period: ThinqConnectEnergyPeriod;
	startDate?: string;
	endDate?: string;
}

export function parseConnectEnergyOptions(
	args: Record<string, string>,
): { options: ConnectEnergyOptions } | { error: string } {
	const rawPeriod = (args['energy-period'] ?? 'DAILY').toUpperCase();
	const period = THINQ_CONNECT_ENERGY_PERIODS.find((allowed) => allowed === rawPeriod);
	if (period === undefined) {
		return {
			error: `Unknown --energy-period "${args['energy-period']}". Allowed: ${THINQ_CONNECT_ENERGY_PERIODS.join(', ')}`,
		};
	}
	return { options: { period, startDate: args['energy-start'], endDate: args['energy-end'] } };
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function errorResultCode(error: unknown): string | undefined {
	if (!(error instanceof ThinqConnectApiError)) {
		return undefined;
	}
	const code = error.metadata?.['resultCode'];
	return typeof code === 'string' ? code : undefined;
}

function reportError(label: string, error: unknown): void {
	console.log(`  ${label}: ERROR ${errorMessage(error)}`);
	const code = errorResultCode(error);
	if (code !== undefined) {
		console.log(`  energy result code: ${code} (${describeEnergyResultCode(code)})`);
	}
	if (!isEnergyNotSupportedCode(code)) {
		process.exitCode = 1;
	}
}

/** Read-only Energy API probe for one device: profile first, then usage per advertised property. */
export async function printConnectEnergy(
	client: Pick<ThinqConnectApiClient, 'getEnergyProfile' | 'getEnergyUsage'>,
	deviceId: string,
	options: ConnectEnergyOptions,
): Promise<void> {
	let profile: Record<string, unknown>;
	try {
		profile = await client.getEnergyProfile(deviceId);
	} catch (error) {
		reportError('energy profile', error);
		return;
	}

	const profileCode = readEnergyResultCode(profile);
	console.log(`  energy profile: result ${profileCode ?? 'none'} (${describeEnergyResultCode(profileCode)})`);
	console.log(`  raw energy profile: ${JSON.stringify(profile, null, 2)}`);

	if (profileCode !== '0000') {
		console.log('  energy: no usage call (profile result is not 0000)');
		if (!isEnergyNotSupportedCode(profileCode)) {
			process.exitCode = 1;
		}
		return;
	}

	const properties = readEnergyProperties(profile);
	if (properties.length === 0) {
		console.log('  energy: profile lists no usable property; no usage call');
		return;
	}

	const { period } = options;
	const range = {
		...defaultEnergyRange(period, new Date()),
		...(options.startDate !== undefined && { startDate: options.startDate }),
		...(options.endDate !== undefined && { endDate: options.endDate }),
	};

	let withData = 0;
	// Sequential on purpose: ThinQ Connect rate-limits bursts (code 1306).
	for (const property of properties) {
		try {
			const usage = await client.getEnergyUsage(deviceId, { property, period, ...range });
			const code = readEnergyResultCode(usage);
			const { count, total } = summarizeEnergyUsage(readEnergyUsageRows(usage, property));
			console.log(
				`  energy usage [${property}] ${period} ${range.startDate}..${range.endDate}: result ${code ?? 'none'} (${describeEnergyResultCode(code)}), ${count} row(s), total ${total}`,
			);
			console.log(`  raw energy usage [${property}]: ${JSON.stringify(usage, null, 2)}`);
			if (code === '0000' && count > 0) {
				withData += 1;
			}
		} catch (error) {
			reportError(`energy usage [${property}]`, error);
		}
	}

	console.log(
		`  energy summary: ${withData} of ${properties.length} ${properties.length === 1 ? 'property' : 'properties'} returned data`,
	);
}
