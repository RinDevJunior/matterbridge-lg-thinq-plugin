import { AnsiLogger } from 'matterbridge/logger';

import { isWasherDevice, toThinqDevice } from '../../core/domain/entities/ThinqDevice.js';
import {
	extractWasherDownloadCommand,
	getWasherDownloadedCourseKey,
	getWasherModelOptionValues,
	resolveWasherCourseId,
	type WasherDownloadOverrides,
	type WasherDownloadRemoteStart,
} from '../../platform/thinq/thinqWasherDownloadCommandResolver.js';
import {
	extractWasherOspWakeupCommand,
	extractWasherWakeupCommand,
} from '../../platform/thinq/thinqWasherStopCommandResolver.js';
import type { ThinqApiClient, ThinqCommandPayload, ThinqControlEndpoint } from '../../services/thinq/thinqApiClient.js';
import type { CliSession } from '../types.js';
import {
	changedWasherFieldKeys,
	createWasherClient,
	describeSendFailure,
	describeThinqResultCode,
	diffWasherFields,
	findWasherTarget,
	formatWasherFieldLines,
	isRecord,
	maskDeviceId,
	parseWasherField,
	readWasherFields,
	type WasherFields,
} from './washerCommon.js';
import {
	buildWasherVtRequest,
	classifyWasherVtOutcome,
	evaluateWasherVtGuard,
	extractWasherVtReturnCodes,
	isWasherVtSendName,
	pollWasherFields,
	WASHER_POLL_INTERVAL_MS,
	WASHER_VT_SEND_NAMES,
	type WasherVtOptionKey,
	type WasherVtOptions,
	type WasherVtVariant,
} from './washerVtCtrl.js';

const WASHER_LEGACY_SEND_NAMES = ['wake', 'osp-wake', 'download-off', 'download-on'] as const;
export type WasherLegacySendName = (typeof WASHER_LEGACY_SEND_NAMES)[number];
export const WASHER_CONTROL_SEND_NAMES = [...WASHER_LEGACY_SEND_NAMES, ...WASHER_VT_SEND_NAMES] as const;
export type WasherControlSendName = (typeof WASHER_CONTROL_SEND_NAMES)[number];

const WAKE_STATES: readonly string[] = ['POWEROFF', 'POWERFAIL', 'INITIAL', 'END'];
const VALUE_PATTERN = /^[A-Za-z0-9_]+$/;
const OVERRIDE_PREFIX: Readonly<Record<WasherVtOptionKey, string>> = {
	soilWash: 'SOILWASH',
	rinse: 'RINSE',
	spin: 'SPIN',
	temp: 'TEMP',
};

export interface WasherControlOptions {
	readonly deviceId: string | undefined;
	readonly send: WasherControlSendName;
	readonly yes: boolean;
	readonly allowStart: boolean;
	readonly waitSeconds: number;
	readonly course: string | undefined;
	readonly spin: string | undefined;
	readonly temp: string | undefined;
	readonly rinse: string | undefined;
	readonly soil: string | undefined;
	readonly variant: WasherVtVariant;
	readonly signature: boolean;
	readonly endpoint: ThinqControlEndpoint | undefined;
}

export interface WasherControlRequest {
	readonly name: WasherControlSendName;
	readonly body: ThinqCommandPayload & { ctrlKey: string };
	readonly mayStartCycle: boolean;
}

interface WasherCommandPart {
	readonly command?: string;
	readonly dataKey?: string;
	readonly dataValue?: unknown;
	readonly dataSetList?: Record<string, unknown>;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSendName(value: string): value is WasherControlSendName {
	return (WASHER_CONTROL_SEND_NAMES as readonly string[]).includes(value);
}

/** Bare flag: present with no value. `parseArgs` would otherwise swallow the next word as its value. */
function readBareFlag(args: Record<string, string>, name: string): boolean {
	const raw = args[name];
	if (raw === undefined) {
		return false;
	}
	if (raw !== 'true') {
		throw new Error(`--${name} is a bare flag and takes no value (got "${raw}").`);
	}
	return true;
}

function readValueOption(args: Record<string, string>, name: string): string | undefined {
	const raw = args[name];
	if (raw === undefined) {
		return undefined;
	}
	if (raw === 'true' || !VALUE_PATTERN.test(raw)) {
		throw new Error(`Invalid --${name} "${raw}": use letters, digits or underscore only.`);
	}
	return raw;
}

function parseEndpoint(raw: string | undefined): ThinqControlEndpoint | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw === 'control' || raw === 'control-sync') {
		return raw;
	}
	throw new Error(`Invalid --endpoint "${raw}". Allowed: control, control-sync.`);
}

function parseWait(raw: string | undefined): number {
	if (raw === undefined) {
		return 3;
	}
	const seconds = Number(raw);
	if (!Number.isFinite(seconds) || seconds < 0) {
		throw new Error(`Invalid --wait "${raw}": expected seconds >= 0.`);
	}
	return seconds;
}

function parseVariant(raw: string | undefined): WasherVtVariant {
	if (raw === undefined) {
		return 'a';
	}
	const lower = raw.toLowerCase();
	if (lower === 'a') {
		return 'a';
	}
	if (lower === 'b') {
		return 'b';
	}
	throw new Error(`Invalid --variant "${raw}". Allowed: A, B.`);
}

/** Builds `WasherControlOptions` from the flat `parseArgs` record. Throws on any invalid combination. */
export function parseWasherControlOptions(args: Record<string, string>): WasherControlOptions {
	const rawSend = args.send;
	if (rawSend === undefined || rawSend === 'true') {
		throw new Error(`Missing --send. Allowed: ${WASHER_CONTROL_SEND_NAMES.join(', ')}`);
	}
	if (!isSendName(rawSend)) {
		throw new Error(`Unknown --send "${rawSend}". Allowed: ${WASHER_CONTROL_SEND_NAMES.join(', ')}`);
	}

	const yes = readBareFlag(args, 'yes');
	const allowStart = readBareFlag(args, 'allow-start');
	const signature = readBareFlag(args, 'signature');
	const course = readValueOption(args, 'course');
	const spin = readValueOption(args, 'spin');
	const temp = readValueOption(args, 'temp');
	const rinse = readValueOption(args, 'rinse');
	const soil = readValueOption(args, 'soil');
	const endpoint = parseEndpoint(args.endpoint);

	const isDownload = rawSend === 'download-off' || rawSend === 'download-on';
	const isVt = isWasherVtSendName(rawSend);
	if (!isDownload && !isVt && (course !== undefined || spin !== undefined || temp !== undefined || signature)) {
		throw new Error('--course, --spin, --temp and --signature apply only to download-off and download-on.');
	}
	if (signature && !isDownload) {
		throw new Error('--signature applies only to download-off and download-on.');
	}
	if ((rinse !== undefined || soil !== undefined) && rawSend !== 'vt-course') {
		throw new Error('--rinse and --soil apply only to vt-course.');
	}
	if (isVt && rawSend !== 'vt-course' && (course !== undefined || spin !== undefined || temp !== undefined)) {
		throw new Error(
			'--course, --spin, --temp, --rinse and --soil apply only to vt-course, download-off and download-on.',
		);
	}
	if (args.variant !== undefined && !isVt) {
		throw new Error('--variant applies only to the vt-* sends.');
	}
	const variant = parseVariant(args.variant);
	if (allowStart && rawSend !== 'download-on' && rawSend !== 'vt-start') {
		throw new Error('--allow-start applies only to download-on and vt-start.');
	}

	const deviceArg = args.device;
	return {
		deviceId: deviceArg && deviceArg !== 'true' ? deviceArg : undefined,
		send: rawSend,
		yes,
		allowStart,
		waitSeconds: parseWait(args.wait),
		course,
		spin,
		temp,
		rinse,
		soil,
		variant,
		signature,
		endpoint,
	};
}

/** Maps the model command part to a request body; `command` is omitted when absent so the client default `Set` survives. */
function toRequestBody(ctrlKey: string, part: WasherCommandPart): ThinqCommandPayload & { ctrlKey: string } {
	return {
		ctrlKey,
		...(part.command === undefined ? {} : { command: part.command }),
		...(part.dataKey === undefined ? {} : { dataKey: part.dataKey }),
		...('dataValue' in part ? { dataValue: part.dataValue } : {}),
		...(part.dataSetList === undefined ? {} : { dataSetList: part.dataSetList }),
	};
}

export function buildWasherControlRequest(
	name: WasherLegacySendName,
	model: Record<string, unknown>,
	opts: { courseId?: string; overrides?: WasherDownloadOverrides; signature?: boolean },
): WasherControlRequest | undefined {
	if (name === 'wake') {
		const part = extractWasherWakeupCommand(model);
		return part === undefined ? undefined : { name, body: toRequestBody('WMWakeup', part), mayStartCycle: false };
	}
	if (name === 'osp-wake') {
		const part = extractWasherOspWakeupCommand(model);
		return part === undefined ? undefined : { name, body: toRequestBody('ospWakeup', part), mayStartCycle: false };
	}

	const remoteStart: WasherDownloadRemoteStart = name === 'download-on' ? 'REMOTE_START_ON' : 'REMOTE_START_OFF';
	const part = extractWasherDownloadCommand(
		model,
		remoteStart,
		opts.courseId === undefined ? undefined : { courseId: opts.courseId },
		opts.overrides,
		opts.signature,
	);
	return part === undefined
		? undefined
		: { name, body: toRequestBody('WMDownload', part), mayStartCycle: name === 'download-on' };
}

/** `800` -> `SPIN_800`, `COLD` -> `TEMP_COLD`, full names pass through; must be listed by the course. */
export function resolveWasherOverrideValue(
	key: WasherVtOptionKey,
	raw: string,
	model: Record<string, unknown>,
	courseId?: string,
): string {
	const resolvedCourseId = resolveWasherCourseId(model, courseId === undefined ? undefined : { courseId });
	if (resolvedCourseId === undefined) {
		throw new Error(`Model has no usable course "${courseId ?? 'default'}".`);
	}
	const allowed = getWasherModelOptionValues(model, resolvedCourseId, key);
	if (allowed === undefined) {
		throw new Error(`Course "${resolvedCourseId}" lists no ${key} options.`);
	}
	const upper = raw.toUpperCase();
	const match = [upper, `${OVERRIDE_PREFIX[key]}_${upper}`].find((candidate) => allowed.includes(candidate));
	if (match === undefined) {
		throw new Error(`Invalid --${key} "${raw}" for course "${resolvedCourseId}". Allowed: ${allowed.join(', ')}`);
	}
	return match;
}

/** Returns the refusal reason (ending in a period), or `undefined` when the guard passes. */
export function evaluateWasherGuard(
	name: WasherLegacySendName,
	fields: WasherFields,
	online: boolean | undefined,
): string | undefined {
	const state = parseWasherField(fields, 'state');
	if (typeof state !== 'string') {
		return 'cannot confirm washer state (washerDryer.state is absent or unreadable).';
	}
	if (online !== true) {
		return online === false ? 'washer is offline in the ThinQ cloud.' : 'online status unknown.';
	}

	if (name === 'wake' || name === 'osp-wake') {
		return WAKE_STATES.includes(state)
			? undefined
			: `washer state is ${state}; ${name} is only allowed in ${WAKE_STATES.join(', ')} (never wake a running or paused cycle).`;
	}

	const remoteStart = parseWasherField(fields, 'remoteStart');
	if (name === 'download-off') {
		if (state !== 'INITIAL') {
			return state === 'POWEROFF'
				? 'washer is POWEROFF; wake it first and wait for INITIAL.'
				: `washer state is ${state}; download-off needs INITIAL.`;
		}
		return remoteStart === 'REMOTE_START_OFF'
			? undefined
			: `Remote Control must be OFF on the washer (saw ${remoteStart === undefined ? 'missing' : JSON.stringify(remoteStart)}); turn it off on the washer first.`;
	}

	if (state !== 'INITIAL') {
		return `washer state is ${state}; download-on needs INITIAL.`;
	}
	return remoteStart === 'REMOTE_START_ON'
		? undefined
		: 'Remote Control is OFF on the washer; turn it on on the washer first.';
}

export function parseResultCode(reply: unknown): string | undefined {
	if (!isRecord(reply)) {
		return undefined;
	}
	if (typeof reply.resultCode === 'string') {
		return reply.resultCode;
	}
	return isRecord(reply.result) && typeof reply.result.resultCode === 'string' ? reply.result.resultCode : undefined;
}

function describeReply(reply: unknown): string {
	return isRecord(reply) && Object.keys(reply).length > 0 ? JSON.stringify(reply) : '(empty body)';
}

interface WasherSendOutcome {
	readonly sendSucceeded: boolean;
	readonly resultCode: string | undefined;
	readonly reply: unknown;
}

async function sendWasherRequest(
	client: ThinqApiClient,
	deviceId: string,
	body: ThinqCommandPayload & { ctrlKey: string },
	endpoint: ThinqControlEndpoint | undefined,
): Promise<WasherSendOutcome> {
	console.log('Sending...');
	try {
		const reply =
			endpoint === undefined
				? await client.sendCommandAndGetResponse(deviceId, body)
				: await client.sendCommandAndGetResponse(deviceId, body, endpoint);
		const resultCode = parseResultCode(reply);
		console.log('HTTP status: 2xx (no error thrown)');
		console.log(
			resultCode === undefined
				? 'resultCode: (none)'
				: `resultCode: ${resultCode} - ${describeThinqResultCode(resultCode)}`,
		);
		console.log(`Reply: ${describeReply(reply)}`);
		if (resultCode !== '0000') {
			process.exitCode = 1;
		}
		return { sendSucceeded: true, resultCode, reply };
	} catch (error) {
		const failure = describeSendFailure(error);
		for (const line of failure.lines) {
			console.log(line);
		}
		if (failure.resultCode !== undefined) {
			console.log(`resultCode: ${failure.resultCode} - ${describeThinqResultCode(failure.resultCode)}`);
		}
		process.exitCode = 1;
		return { sendSucceeded: false, resultCode: failure.resultCode, reply: undefined };
	}
}

function printWasherStatus(title: string, after: WasherFields, before: WasherFields): void {
	console.log(`--- Status (${title}) ---`);
	for (const line of formatWasherFieldLines(after)) {
		console.log(line);
	}
	console.log('--- Changes ---');
	for (const line of diffWasherFields(before, after)) {
		console.log(line);
	}
}

export async function cmdWasherControl(
	session: CliSession,
	options: WasherControlOptions,
	logger: AnsiLogger,
): Promise<void> {
	const client = createWasherClient(session, logger);

	const initialDevices = (await client.getListDevices()).map(toThinqDevice);
	const target = findWasherTarget(initialDevices, options.deviceId);
	if (!target) {
		console.error(
			options.deviceId
				? `Device "${maskDeviceId(options.deviceId)}" was not found. Discovered device ids:`
				: 'No washer found. Discovered device ids:',
		);
		for (const device of initialDevices) {
			console.log(`  ${maskDeviceId(device.id)}  type=${device.type}  name=${device.name}`);
		}
		process.exitCode = 1;
		return;
	}
	if (!isWasherDevice(target)) {
		console.error(`Device ${maskDeviceId(target.id)} is type ${target.type}, not WASHER. Nothing sent.`);
		process.exitCode = 1;
		return;
	}
	if (!target.modelJsonUri) {
		console.error('Device has no modelJsonUri; cannot build the request. Nothing sent.');
		process.exitCode = 1;
		return;
	}

	const deviceId = target.id;
	const masked = maskDeviceId(deviceId);
	const model = await client.getDeviceModel(target.modelJsonUri);

	const { course: courseId } = options;
	if (courseId !== undefined) {
		const courses = isRecord(model.Course) ? Object.keys(model.Course) : [];
		if (!courses.includes(courseId)) {
			console.error(`Course "${courseId}" is not in this model's Course list. Nothing sent.`);
			process.exitCode = 1;
			return;
		}
	}

	const send = options.send;
	const isVt = isWasherVtSendName(send);
	let overrides: WasherDownloadOverrides = {};
	let vtOptions: WasherVtOptions = {};
	let vtCourseId: string | undefined;
	try {
		if (send === 'vt-course') {
			vtCourseId = resolveWasherCourseId(model, courseId === undefined ? undefined : { courseId });
			if (vtCourseId === undefined) {
				throw new Error('Model has no usable default course.');
			}
			vtOptions = {
				soilWash:
					options.soil === undefined
						? undefined
						: resolveWasherOverrideValue('soilWash', options.soil, model, courseId),
				rinse:
					options.rinse === undefined ? undefined : resolveWasherOverrideValue('rinse', options.rinse, model, courseId),
				spin:
					options.spin === undefined ? undefined : resolveWasherOverrideValue('spin', options.spin, model, courseId),
				temp:
					options.temp === undefined ? undefined : resolveWasherOverrideValue('temp', options.temp, model, courseId),
			};
		} else if (!isVt) {
			overrides = {
				spin:
					options.spin === undefined ? undefined : resolveWasherOverrideValue('spin', options.spin, model, courseId),
				temp:
					options.temp === undefined ? undefined : resolveWasherOverrideValue('temp', options.temp, model, courseId),
			};
		}
	} catch (error) {
		console.error(`${errorMessage(error)} Nothing sent.`);
		process.exitCode = 1;
		return;
	}

	if (options.signature && getWasherDownloadedCourseKey(model) === undefined) {
		console.error('Model has no Config.downloadedCourseType; --signature is not available. Nothing sent.');
		process.exitCode = 1;
		return;
	}

	const request = isVt
		? buildWasherVtRequest(send, model, { courseId: vtCourseId, options: vtOptions, variant: options.variant })
		: buildWasherControlRequest(send, model, {
				courseId,
				overrides,
				signature: options.signature,
			});
	if (request === undefined) {
		console.error(
			isVt
				? `Model has no usable control for "${send}" (vtCtrl needs Config.uniProtocol true and ControlWifi.vtCtrl). Nothing sent.`
				: `Model has no usable control for "${send}". Nothing sent.`,
		);
		process.exitCode = 1;
		return;
	}

	// Fresh read right before the send decision: the guard and the "before" print both use this snapshot.
	const freshTarget = findWasherTarget((await client.getListDevices()).map(toThinqDevice), deviceId);
	if (!freshTarget) {
		console.error(`Washer ${masked} is missing from the device list. Nothing sent.`);
		process.exitCode = 1;
		return;
	}
	const before = readWasherFields(freshTarget);

	console.log(`Device: ${freshTarget.name} (${masked})`);
	console.log('--- Before ---');
	for (const line of formatWasherFieldLines(before)) {
		console.log(line);
	}
	const endpoint = options.endpoint ?? 'control-sync';
	console.log(`Request: POST service/devices/${masked}/${endpoint}`);
	console.log(`Body: ${JSON.stringify({ command: 'Set', ...request.body }, null, 2)}`);
	if (isVt) {
		console.log(
			`Variant: ${options.variant.toUpperCase()}; endpoint and body shape are inferred from the LG app and not proven.`,
		);
	}
	if (request.mayStartCycle) {
		console.log('WARNING: this may START a wash cycle.');
	}
	if (send === 'vt-start') {
		console.log(
			'WARNING: this may START a wash cycle (water, heat, motor). Only continue if the drum content is meant to be washed with the course shown above (washerDryer.course).',
		);
	}

	const guardReason =
		(isVt
			? evaluateWasherVtGuard(send, before, freshTarget.online)
			: evaluateWasherGuard(send, before, freshTarget.online)) ??
		(request.mayStartCycle && !options.allowStart
			? `--allow-start is required for ${send} (it may start a cycle).`
			: undefined);

	if (!options.yes) {
		console.log(guardReason === undefined ? 'Guard: PASS' : `Guard: WOULD REFUSE - ${guardReason}`);
		console.log('DRY RUN: nothing sent. Re-run with --yes to send.');
		return;
	}
	if (guardReason !== undefined) {
		console.log(`Refused: ${guardReason} Nothing sent.`);
		process.exitCode = 1;
		return;
	}

	const sent = await sendWasherRequest(client, deviceId, request.body, options.endpoint);

	if (!isVt) {
		await sleep(options.waitSeconds * 1000);

		let after: WasherFields;
		try {
			const afterTarget = findWasherTarget((await client.getListDevices()).map(toThinqDevice), deviceId);
			if (!afterTarget) {
				console.error(`Washer ${masked} is missing from the device list after the send.`);
				process.exitCode = 1;
				return;
			}
			after = readWasherFields(afterTarget);
		} catch (error) {
			const prefix = sent.sendSucceeded ? 'Send succeeded but status refetch failed' : 'Status refetch failed';
			console.error(`${prefix}: ${errorMessage(error)}`);
			process.exitCode = 1;
			return;
		}

		printWasherStatus(`after ${options.waitSeconds}s`, after, before);
		return;
	}

	let deviceMissing = false;
	const readAfterSend = async (): Promise<WasherFields> => {
		const afterTarget = findWasherTarget((await client.getListDevices()).map(toThinqDevice), deviceId);
		if (!afterTarget) {
			deviceMissing = true;
			throw new Error(`Washer ${masked} is missing from the device list after the send.`);
		}
		return readWasherFields(afterTarget);
	};

	try {
		const poll = await pollWasherFields(readAfterSend, before, sleep);
		printWasherStatus(`after ${poll.polls} poll(s) of ${WASHER_POLL_INTERVAL_MS} ms`, poll.fields, before);

		let finalFields = poll.fields;
		if (options.waitSeconds > 0 && poll.changedKeys.length === 0) {
			await sleep(options.waitSeconds * 1000);
			finalFields = await readAfterSend();
			printWasherStatus(`after +${options.waitSeconds}s`, finalFields, before);
		}

		for (const ack of extractWasherVtReturnCodes(sent.reply)) {
			console.log(`vtAck returnCode: ${ack}`);
		}
		for (const line of classifyWasherVtOutcome({
			resultCode: sent.resultCode,
			changedKeys: changedWasherFieldKeys(before, finalFields),
		})) {
			console.log(line);
		}
	} catch (error) {
		if (deviceMissing) {
			console.error(errorMessage(error));
		} else {
			const prefix = sent.sendSucceeded ? 'Send succeeded but status refetch failed' : 'Status refetch failed';
			console.error(`${prefix}: ${errorMessage(error)}`);
		}
		process.exitCode = 1;
	}
}
