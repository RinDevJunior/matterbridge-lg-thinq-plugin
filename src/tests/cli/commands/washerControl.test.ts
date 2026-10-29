import type { Mock, MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliSession } from '../../../cli/types.js';
import type { ThinqApiClient, ThinqDeviceData } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';
import { createFakeWasherModel } from '../../helpers/washerFixtures.js';

vi.mock('../../../cli/commands/washerCommon.js', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	createWasherClient: vi.fn(),
}));

import { createWasherClient } from '../../../cli/commands/washerCommon.js';
import {
	cmdWasherControl,
	parseWasherControlOptions,
	resolveWasherOverrideValue,
} from '../../../cli/commands/washerControl.js';

const FULL_DEVICE_ID = '11112222-3333-4444-5555-66667777abcd';
const MODEL_URI = 'https://example.invalid/model-secret-uri.json';
const ACCESS_TOKEN = 'access-token-secret-value';
const SESSION = asPartial<CliSession>({
	loginType: 'token',
	country: 'US',
	language: 'en-US',
	userData: asPartial<CliSession['userData']>({ accessToken: ACCESS_TOKEN, refreshToken: 'refresh-secret' }),
});

const READY_FOR_COURSE = {
	state: 'INITIAL',
	remoteStart: 'REMOTE_START_OFF',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
};

const READY_FOR_START = {
	state: 'INITIAL',
	doorClose: 'DOORCLOSE_ON',
	remoteStart: 'REMOTE_START_ON',
	course: 'NORMAL',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
};

const READY_FOR_PAUSE = {
	state: 'PAUSE',
	childLock: 'CHILDLOCK_OFF',
	error: 'ERROR_NO',
};

/** Expected vtCtrl body for a single-cell send (variant a), as printed by `cmdWasherControl`. */
function expectedVtBody(cell: { cmd: string; value: string }): unknown {
	return {
		command: 'Set',
		ctrlKey: 'vtCtrl',
		dataSetList: {
			ctrlTarget: ['UNDEFINE'],
			reqDevType: 'APP',
			productType: 'NORMAL',
			vtData: { UNDEFINE: [{ ...cell, type: 'ABSOLUTE' }] },
		},
	};
}

/** Parses the JSON printed after `Body: ` in the captured console output. */
function printedBodyOf(spy: MockInstance): unknown {
	const line = spy.mock.calls.map((call: unknown[]) => String(call[0])).find((text) => text.startsWith('Body: '));
	return JSON.parse((line ?? '').slice('Body: '.length)) as unknown;
}

/** Raw device-list entry for `toThinqDevice`. `deviceType` 201 is WASHER. */
function rawWasherEntry(
	washerDryer: Record<string, unknown>,
	overrides: { online?: boolean; deviceId?: string; deviceType?: number } = {},
): ThinqDeviceData {
	return {
		deviceId: overrides.deviceId ?? FULL_DEVICE_ID,
		alias: 'Fake Washer',
		modelJsonUri: MODEL_URI,
		deviceType: overrides.deviceType ?? 201,
		snapshot: { washerDryer },
		online: overrides.online ?? true,
	};
}

function createMockWasherClient(): { getListDevices: Mock; getDeviceModel: Mock; sendCommandAndGetResponse: Mock } {
	return {
		getListDevices: vi.fn(),
		getDeviceModel: vi.fn(),
		sendCommandAndGetResponse: vi.fn(),
	};
}

function baseOptions(
	overrides: Partial<Parameters<typeof cmdWasherControl>[1]> = {},
): Parameters<typeof cmdWasherControl>[1] {
	return {
		deviceId: undefined,
		send: 'vt-course',
		yes: false,
		allowStart: false,
		allowInterrupt: false,
		waitSeconds: 3,
		course: 'NORMAL',
		spin: undefined,
		temp: undefined,
		rinse: undefined,
		soil: undefined,
		variant: 'a',
		signature: false,
		noCourse: false,
		endpoint: undefined,
		...overrides,
	};
}

function outputOf(spy: MockInstance): string {
	return spy.mock.calls.map((call: unknown[]) => call.map(String).join(' ')).join('\n');
}

describe('parseWasherControlOptions', () => {
	describe('defaults and valid combinations', () => {
		it('should default to dry run, no allow-start, variant a, no endpoint and 3 seconds for vt-course', () => {
			// Arrange
			const args = { send: 'vt-course' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options).toMatchObject({
				send: 'vt-course',
				yes: false,
				allowStart: false,
				variant: 'a',
				endpoint: undefined,
				allowInterrupt: false,
				waitSeconds: 3,
			});
		});

		it('should map --variant B to lower case b', () => {
			// Arrange
			const args = { send: 'vt-course', variant: 'B' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.variant).toBe('b');
		});

		it('should map --variant a to a', () => {
			// Arrange
			const args = { send: 'vt-course', variant: 'a' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.variant).toBe('a');
		});

		it('should throw Invalid --variant for --variant C', () => {
			// Arrange
			const args = { send: 'vt-course', variant: 'C' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('Invalid --variant "C". Allowed: A, B.');
		});

		it('should accept --rinse 3 and --soil HEAVY for vt-course', () => {
			// Arrange
			const args = { send: 'vt-course', rinse: '3', soil: 'HEAVY' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.rinse).toBe('3');
			expect(options.soil).toBe('HEAVY');
		});

		it('should accept --allow-start on vt-start', () => {
			// Arrange
			const args = { send: 'vt-start', 'allow-start': 'true' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.allowStart).toBe(true);
		});

		it('should accept --allow-start on download-on', () => {
			// Arrange
			const args = { send: 'download-on', 'allow-start': 'true' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.allowStart).toBe(true);
		});

		it('should keep legacy download-off options unchanged with variant a and no rinse or soil', () => {
			// Arrange
			const args = { send: 'download-off', signature: 'true', spin: '1200' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options).toMatchObject({
				send: 'download-off',
				signature: true,
				spin: '1200',
				variant: 'a',
				rinse: undefined,
				soil: undefined,
				yes: false,
				allowStart: false,
				allowInterrupt: false,
				waitSeconds: 3,
			});
		});
	});

	describe('option applicability', () => {
		it('should refuse --rinse on vt-start', () => {
			// Arrange
			const args = { send: 'vt-start', rinse: '3' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('--rinse and --soil apply only to vt-course.');
		});

		it('should refuse --variant on the legacy wake send', () => {
			// Arrange
			const args = { send: 'wake', variant: 'a' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('--variant applies only to the vt-* sends.');
		});

		it('should refuse --allow-start on vt-course', () => {
			// Arrange
			const args = { send: 'vt-course', 'allow-start': 'true' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--allow-start applies only to download-on, vt-start and vt-resume.',
			);
		});

		it('should refuse --allow-start on wake', () => {
			// Arrange
			const args = { send: 'wake', 'allow-start': 'true' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--allow-start applies only to download-on, vt-start and vt-resume.',
			);
		});

		it('should refuse --course, --spin or --temp on wake with the existing message', () => {
			// Arrange
			const args = { send: 'wake', spin: '800' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--course, --spin, --temp and --signature apply only to download-off and download-on.',
			);
		});

		it('should refuse --course on vt-start', () => {
			// Arrange
			const args = { send: 'vt-start', course: 'NORMAL' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--course, --spin, --temp, --rinse and --soil apply only to vt-course, download-off and download-on.',
			);
		});

		it('should refuse --signature on vt-course', () => {
			// Arrange
			const args = { send: 'vt-course', signature: 'true' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--signature applies only to download-off and download-on.',
			);
		});
	});

	describe('new vt-resume and vt-power-off options', () => {
		const NEW_SENDS = ['vt-resume', 'vt-power-off'] as const;

		it('should accept --allow-start on vt-resume and set allowStart true', () => {
			// Arrange
			const args = { send: 'vt-resume', 'allow-start': 'true' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.allowStart).toBe(true);
		});

		it('should accept vt-resume without --allow-start and leave allowStart false', () => {
			// Arrange
			const args = { send: 'vt-resume' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options).toMatchObject({ send: 'vt-resume', allowStart: false, allowInterrupt: false });
		});

		it('should accept --allow-interrupt on vt-power-off and set allowInterrupt true', () => {
			// Arrange
			const args = { send: 'vt-power-off', 'allow-interrupt': 'true' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.allowInterrupt).toBe(true);
		});

		it('should default allowInterrupt to false for vt-power-off', () => {
			// Arrange
			const args = { send: 'vt-power-off' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options).toMatchObject({ send: 'vt-power-off', allowInterrupt: false, allowStart: false });
		});

		it.each(['vt-resume', 'vt-start', 'vt-pause', 'vt-power-on', 'vt-course', 'wake', 'download-on'])(
			'should refuse --allow-interrupt on %s',
			(send) => {
				// Arrange
				const args = { send, 'allow-interrupt': 'true' };

				// Act / Assert
				expect(() => parseWasherControlOptions(args)).toThrow('--allow-interrupt applies only to vt-power-off.');
			},
		);

		it('should refuse --allow-start on vt-power-off with the new allow-start text', () => {
			// Arrange
			const args = { send: 'vt-power-off', 'allow-start': 'true' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--allow-start applies only to download-on, vt-start and vt-resume.',
			);
		});

		it('should refuse --allow-interrupt with a value as a bare-flag error', () => {
			// Arrange
			const args = { send: 'vt-power-off', 'allow-interrupt': '5' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--allow-interrupt is a bare flag and takes no value (got "5").',
			);
		});

		it.each(
			NEW_SENDS.flatMap((send) => [
				['course', send, 'NORMAL'] as const,
				['spin', send, '800'] as const,
				['temp', send, 'COLD'] as const,
			]),
		)('should refuse --%s on %s with the vt-course-only message', (key, send, value) => {
			// Arrange
			const args = { send, [key]: value };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--course, --spin, --temp, --rinse and --soil apply only to vt-course, download-off and download-on.',
			);
		});

		it.each(NEW_SENDS)('should refuse --rinse and --soil on %s', (send) => {
			// Arrange
			const args = { send, rinse: '3', soil: 'HEAVY' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('--rinse and --soil apply only to vt-course.');
		});

		it.each(NEW_SENDS)('should accept --variant B on %s and map it to b', (send) => {
			// Arrange
			const args = { send, variant: 'B' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.variant).toBe('b');
		});

		it.each(NEW_SENDS)('should refuse --signature on %s', (send) => {
			// Arrange
			const args = { send, signature: 'true' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--signature applies only to download-off and download-on.',
			);
		});

		it('should refuse an unknown send vt-cancel and list vt-resume and vt-power-off as allowed', () => {
			// Arrange
			const args = { send: 'vt-cancel' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(/Unknown --send "vt-cancel".*vt-resume, vt-power-off/);
		});
	});

	describe('no-course option (vt-course only)', () => {
		it('should parse --no-course with an option and leave course undefined', () => {
			// Arrange
			const args = { send: 'vt-course', 'no-course': 'true', rinse: 'RINSE_3' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options).toMatchObject({ send: 'vt-course', noCourse: true, course: undefined, rinse: 'RINSE_3' });
		});

		it('should default noCourse to false when the flag is absent', () => {
			// Arrange
			const args = { send: 'vt-course', rinse: 'RINSE_3' };

			// Act
			const options = parseWasherControlOptions(args);

			// Assert
			expect(options.noCourse).toBe(false);
		});

		it.each([
			[
				'a send other than vt-course',
				{ send: 'vt-start', 'no-course': 'true' },
				'--no-course applies only to vt-course.',
			],
			[
				'--course',
				{ send: 'vt-course', 'no-course': 'true', course: 'NORMAL', rinse: 'RINSE_3' },
				'--no-course cannot be combined with --course.',
			],
			[
				'no option value at all',
				{ send: 'vt-course', 'no-course': 'true' },
				'--no-course needs at least one of --soil, --rinse, --spin, --temp (the body would be empty).',
			],
		])('should refuse --no-course with %s', (_label, args, message) => {
			// Arrange / Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(message);
		});

		it('should refuse --no-course given a value as a bare-flag error', () => {
			// Arrange
			const args = { send: 'vt-course', 'no-course': 'NORMAL', rinse: 'RINSE_3' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				'--no-course is a bare flag and takes no value (got "NORMAL").',
			);
		});
	});

	describe('value validation', () => {
		it('should refuse --yes with a value because it is a bare flag', () => {
			// Arrange
			const args = { send: 'vt-course', yes: '5' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('--yes is a bare flag and takes no value (got "5").');
		});

		it('should refuse a --spin value with spaces or punctuation', () => {
			// Arrange
			const args = { send: 'download-off', spin: 'bad value!' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('Invalid --spin "bad value!"');
		});

		it('should refuse an unknown --send and list the vt sends', () => {
			// Arrange
			const args = { send: 'vt-off' };

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow(
				/Unknown --send "vt-off".*vt-course, vt-start, vt-pause, vt-power-on/,
			);
		});

		it('should refuse a missing --send', () => {
			// Arrange
			const args = {};

			// Act / Assert
			expect(() => parseWasherControlOptions(args)).toThrow('Missing --send.');
		});
	});
});

describe('resolveWasherOverrideValue', () => {
	it('should resolve a short spin value to SPIN_800', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act
		const value = resolveWasherOverrideValue('spin', '800', model);

		// Assert
		expect(value).toBe('SPIN_800');
	});

	it('should resolve a short temp value to TEMP_COLD', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act
		const value = resolveWasherOverrideValue('temp', 'cold', model);

		// Assert
		expect(value).toBe('TEMP_COLD');
	});

	it('should resolve a short rinse value to RINSE_3', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act
		const value = resolveWasherOverrideValue('rinse', '3', model);

		// Assert
		expect(value).toBe('RINSE_3');
	});

	it('should resolve a short soilWash value to SOILWASH_HEAVY', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act
		const value = resolveWasherOverrideValue('soilWash', 'heavy', model);

		// Assert
		expect(value).toBe('SOILWASH_HEAVY');
	});

	it('should pass a full enum name through unchanged', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act
		const value = resolveWasherOverrideValue('spin', 'SPIN_800', model);

		// Assert
		expect(value).toBe('SPIN_800');
	});

	it('should throw with the Allowed list when the value is not selectable by the course', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act / Assert
		expect(() => resolveWasherOverrideValue('spin', '999', model)).toThrow(
			'Allowed: SPIN_800, SPIN_1000, SPIN_1200, SPIN_1400',
		);
	});

	it('should throw when the course has no option for that key', () => {
		// Arrange
		const model = createFakeWasherModel();

		// Act / Assert
		expect(() => resolveWasherOverrideValue('rinse', '3', model, 'COTTON')).toThrow(
			'Course "COTTON" lists no rinse options.',
		);
	});
});

describe('cmdWasherControl', () => {
	let client: ReturnType<typeof createMockWasherClient>;
	let logSpy: MockInstance;
	let errorSpy: MockInstance;

	/** Sets the device list the CLI sees (both the initial and fresh reads use it unless overridden). */
	function givenWasher(
		washerDryer: Record<string, unknown>,
		overrides: { online?: boolean; deviceType?: number } = {},
	): void {
		client.getListDevices.mockResolvedValue([rawWasherEntry(washerDryer, overrides)]);
	}

	function givenReadyForCourse(): void {
		givenWasher(READY_FOR_COURSE);
	}

	function givenReadyForStart(): void {
		givenWasher(READY_FOR_START);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		client = createMockWasherClient();
		client.getDeviceModel.mockResolvedValue(createFakeWasherModel());
		client.sendCommandAndGetResponse.mockResolvedValue({ resultCode: '0000' });
		vi.mocked(createWasherClient).mockReturnValue(asPartial<ThinqApiClient>(client));
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = undefined;
	});

	describe('dry run', () => {
		it('should send nothing and print DRY RUN, Guard PASS and the vtCtrl body by default', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			await cmdWasherControl(SESSION, baseOptions(), createMockLogger());

			// Assert
			const output = outputOf(logSpy);
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(output).toContain('DRY RUN');
			expect(output).toContain('Guard: PASS');
			expect(output).toContain('"ctrlKey": "vtCtrl"');
		});

		it('should print a dry-run body that equals the body sent with --yes', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			await cmdWasherControl(SESSION, baseOptions(), createMockLogger());
			const bodyLine = logSpy.mock.calls
				.map((call: unknown[]) => String(call[0]))
				.find((line) => line.startsWith('Body: '));
			const printedBody: unknown = JSON.parse((bodyLine ?? '').slice('Body: '.length));
			logSpy.mockClear();
			const run = cmdWasherControl(SESSION, baseOptions({ yes: true }), createMockLogger());
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(printedBody).toStrictEqual({ command: 'Set', ...client.sendCommandAndGetResponse.mock.calls[0][1] });
		});

		it('should print Guard WOULD REFUSE and still send nothing when the guard fails', async () => {
			// Arrange
			givenWasher({ ...READY_FOR_COURSE, state: 'RUNNING' });

			// Act
			await cmdWasherControl(SESSION, baseOptions(), createMockLogger());

			// Assert
			expect(outputOf(logSpy)).toContain('Guard: WOULD REFUSE');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});

		it('should print the WMDownload body and no Verdict line for legacy download-off in dry run', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			await cmdWasherControl(SESSION, baseOptions({ send: 'download-off', course: undefined }), createMockLogger());

			// Assert
			const output = outputOf(logSpy);
			expect(output).toContain('"ctrlKey": "WMDownload"');
			expect(output).toContain('"remoteStart": "REMOTE_START_OFF"');
			expect(output).not.toContain('Verdict:');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});
	});

	describe('no-course dry run and send', () => {
		it('should print a course-less body with only the rinse cell, the unconfirmed warning, and send nothing without --yes', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-course', course: undefined, noCourse: true, rinse: 'RINSE_3' }),
				createMockLogger(),
			);

			// Assert
			expect(printedBodyOf(logSpy)).toStrictEqual(expectedVtBody({ cmd: 'rinse', value: 'RINSE_3' }));
			expect(outputOf(logSpy)).toContain('NEVER been confirmed on hardware');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});
	});

	describe('refusals', () => {
		it('should refuse with Refused and exit 1 when --yes is set but the guard fails', async () => {
			// Arrange
			givenWasher({ ...READY_FOR_COURSE, state: 'RUNNING' });

			// Act
			await cmdWasherControl(SESSION, baseOptions({ yes: true }), createMockLogger());

			// Assert
			expect(outputOf(logSpy)).toContain('Refused:');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should refuse vt-start without --allow-start even when every state condition is good', async () => {
			// Arrange
			givenReadyForStart();

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-start', course: undefined, yes: true }),
				createMockLogger(),
			);

			// Assert
			expect(outputOf(logSpy)).toContain('--allow-start is required for vt-start');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});

		it('should refuse with Not a WASHER text and send nothing for a non-washer device', async () => {
			// Arrange
			givenWasher(READY_FOR_COURSE, { deviceType: 401 });

			// Act
			await cmdWasherControl(SESSION, baseOptions({ yes: true, deviceId: FULL_DEVICE_ID }), createMockLogger());

			// Assert
			expect(outputOf(errorSpy)).toContain('not WASHER. Nothing sent.');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should print Nothing sent when the model has no uniProtocol', async () => {
			// Arrange
			givenReadyForCourse();
			const model = createFakeWasherModel();
			(model.Config as Record<string, unknown>).uniProtocol = false;
			client.getDeviceModel.mockResolvedValue(model);

			// Act
			await cmdWasherControl(SESSION, baseOptions({ yes: true }), createMockLogger());

			// Assert
			expect(outputOf(errorSpy)).toContain('Nothing sent.');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});
	});

	describe('send path', () => {
		it('should send exactly once with the device id and body, and no endpoint argument, for the default endpoint', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			const run = cmdWasherControl(SESSION, baseOptions({ yes: true }), createMockLogger());
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			const [deviceId, body, ...rest] = client.sendCommandAndGetResponse.mock.calls[0];
			expect(deviceId).toBe(FULL_DEVICE_ID);
			expect(body).toMatchObject({ ctrlKey: 'vtCtrl', command: 'Set' });
			expect(rest).toHaveLength(0);
		});

		it('should pass control as the third argument when --endpoint control is given', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			const run = cmdWasherControl(SESSION, baseOptions({ yes: true, endpoint: 'control' }), createMockLogger());
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(client.sendCommandAndGetResponse.mock.calls[0][2]).toBe('control');
		});

		it('should print a Verdict line and Changes with course when the refetched course differs', async () => {
			// Arrange
			client.getListDevices
				.mockResolvedValueOnce([rawWasherEntry(READY_FOR_COURSE)])
				.mockResolvedValueOnce([rawWasherEntry(READY_FOR_COURSE)])
				.mockResolvedValue([rawWasherEntry({ ...READY_FOR_COURSE, course: 'NORMAL' })]);

			// Act
			const run = cmdWasherControl(SESSION, baseOptions({ yes: true }), createMockLogger());
			await vi.runAllTimersAsync();
			await run;

			// Assert
			const output = outputOf(logSpy);
			expect(output).toContain('--- Changes ---');
			expect(output).toContain('course:');
			expect(output).toContain('Verdict:');
		});

		it('should send a vt-start once with --allow-start and print the START warning', async () => {
			// Arrange
			givenReadyForStart();

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-start', course: undefined, yes: true, allowStart: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(outputOf(logSpy)).toContain('START a wash cycle');
		});

		it('should report the HTTP error, exit 1, still print a Verdict and send only once when the send rejects', async () => {
			// Arrange
			givenReadyForCourse();
			client.sendCommandAndGetResponse.mockRejectedValue({ response: { status: 400, data: { resultCode: '0111' } } });

			// Act
			const run = cmdWasherControl(SESSION, baseOptions({ yes: true }), createMockLogger());
			await vi.runAllTimersAsync();
			await run;

			// Assert
			const output = outputOf(logSpy);
			expect(output).toContain('0111');
			expect(output).toContain('Verdict:');
			expect(process.exitCode).toBe(1);
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
		});

		it('should not print a Verdict line for legacy download-off with --yes (single --wait path)', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'download-off', course: undefined, yes: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(outputOf(logSpy)).not.toContain('Verdict:');
			expect(outputOf(logSpy)).toContain('--- Status (after 3s) ---');
		});
	});

	describe('vt-resume', () => {
		const RESUME_CELL = { cmd: 'wmControl', value: 'RESUME' };

		it('should print WOULD REFUSE for the missing --allow-start, the RESUME body and warning, and send nothing in a dry run', async () => {
			// Arrange
			givenWasher(READY_FOR_PAUSE);

			// Act
			await cmdWasherControl(SESSION, baseOptions({ send: 'vt-resume', course: undefined }), createMockLogger());

			// Assert
			const output = outputOf(logSpy);
			expect(output).toContain('Guard: WOULD REFUSE - --allow-start is required for vt-resume');
			expect(printedBodyOf(logSpy)).toStrictEqual(expectedVtBody(RESUME_CELL));
			expect(output).toContain('this RESUMES the paused wash cycle');
			expect(output).toContain('DRY RUN');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});

		it('should refuse with --allow-start text, exit 1 and send nothing for --yes without --allow-start', async () => {
			// Arrange
			givenWasher(READY_FOR_PAUSE);

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-resume', course: undefined, yes: true }),
				createMockLogger(),
			);

			// Assert
			expect(outputOf(logSpy)).toContain('Refused:');
			expect(outputOf(logSpy)).toContain('--allow-start is required for vt-resume');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should send exactly once with the RESUME body, print the warning and a Verdict for --yes --allow-start in PAUSE', async () => {
			// Arrange
			givenWasher(READY_FOR_PAUSE);

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-resume', course: undefined, yes: true, allowStart: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(client.sendCommandAndGetResponse.mock.calls[0][0]).toBe(FULL_DEVICE_ID);
			expect(client.sendCommandAndGetResponse.mock.calls[0][1]).toMatchObject({ ctrlKey: 'vtCtrl', command: 'Set' });
			expect(printedBodyOf(logSpy)).toStrictEqual(expectedVtBody(RESUME_CELL));
			expect(outputOf(logSpy)).toContain('this RESUMES the paused wash cycle');
			expect(outputOf(logSpy)).toContain('Verdict:');
		});

		it('should refuse with needs PAUSE and send nothing for --yes --allow-start in RUNNING', async () => {
			// Arrange
			givenWasher({ ...READY_FOR_PAUSE, state: 'RUNNING' });

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-resume', course: undefined, yes: true, allowStart: true }),
				createMockLogger(),
			);

			// Assert
			expect(outputOf(logSpy)).toContain('Refused:');
			expect(outputOf(logSpy)).toContain('vt-resume needs PAUSE');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});
	});

	describe('vt-power-off', () => {
		const POWER_OFF_CELL = { cmd: 'power', value: 'POWER_OFF' };

		it('should print Guard PASS, the POWER_OFF body and warning, and send nothing in a dry run from INITIAL', async () => {
			// Arrange
			givenWasher(READY_FOR_COURSE);

			// Act
			await cmdWasherControl(SESSION, baseOptions({ send: 'vt-power-off', course: undefined }), createMockLogger());

			// Assert
			const output = outputOf(logSpy);
			expect(output).toContain('Guard: PASS');
			expect(printedBodyOf(logSpy)).toStrictEqual(expectedVtBody(POWER_OFF_CELL));
			expect(output).toContain('this powers the washer OFF');
			expect(output).toContain('DRY RUN');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});

		it('should print Guard WOULD REFUSE mentioning --allow-interrupt in a dry run from PAUSE without the flag', async () => {
			// Arrange
			givenWasher(READY_FOR_PAUSE);

			// Act
			await cmdWasherControl(SESSION, baseOptions({ send: 'vt-power-off', course: undefined }), createMockLogger());

			// Assert
			expect(outputOf(logSpy)).toContain('Guard: WOULD REFUSE');
			expect(outputOf(logSpy)).toContain('--allow-interrupt');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});

		it('should print Guard PASS in a dry run from PAUSE with allowInterrupt true', async () => {
			// Arrange
			givenWasher(READY_FOR_PAUSE);

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, allowInterrupt: true }),
				createMockLogger(),
			);

			// Assert
			expect(outputOf(logSpy)).toContain('Guard: PASS');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
		});

		it('should refuse with Refused, exit 1 and send nothing for --yes in RUNNING without the flag', async () => {
			// Arrange
			givenWasher({ ...READY_FOR_PAUSE, state: 'RUNNING' });

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, yes: true }),
				createMockLogger(),
			);

			// Assert
			expect(outputOf(logSpy)).toContain('Refused:');
			expect(outputOf(logSpy)).toContain('--allow-interrupt');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should send exactly once and print a Verdict for --yes with allowInterrupt in RUNNING', async () => {
			// Arrange
			givenWasher({ ...READY_FOR_PAUSE, state: 'RUNNING' });

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, yes: true, allowInterrupt: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(printedBodyOf(logSpy)).toStrictEqual(expectedVtBody(POWER_OFF_CELL));
			expect(outputOf(logSpy)).toContain('Verdict:');
		});

		it('should send exactly once without the flag when state is ERROR with child lock ON, because the guard does not check them', async () => {
			// Arrange
			givenWasher({ state: 'ERROR', childLock: 'CHILDLOCK_ON', error: 'ERROR_DE1' });

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, yes: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(outputOf(logSpy)).not.toContain('Refused:');
		});

		it('should refuse with already POWEROFF, exit 1 and send nothing for --yes --allow-interrupt in POWEROFF', async () => {
			// Arrange
			givenWasher({ state: 'POWEROFF' });

			// Act
			await cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, yes: true, allowInterrupt: true }),
				createMockLogger(),
			);

			// Assert
			expect(outputOf(logSpy)).toContain('already POWEROFF');
			expect(client.sendCommandAndGetResponse).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
		});

		it('should send exactly once without --allow-start and never print the --allow-start requirement', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, yes: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(client.sendCommandAndGetResponse).toHaveBeenCalledTimes(1);
			expect(outputOf(logSpy)).not.toContain('--allow-start is required');
		});

		it('should never print the full device id for a vt-power-off send', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			const run = cmdWasherControl(
				SESSION,
				baseOptions({ send: 'vt-power-off', course: undefined, yes: true }),
				createMockLogger(),
			);
			await vi.runAllTimersAsync();
			await run;

			// Assert
			expect(outputOf(logSpy) + outputOf(errorSpy)).not.toContain(FULL_DEVICE_ID);
		});
	});

	describe('masking', () => {
		it('should never print the full device id, the model URI or the access token', async () => {
			// Arrange
			givenReadyForCourse();

			// Act
			await cmdWasherControl(SESSION, baseOptions(), createMockLogger());

			// Assert
			const output = outputOf(logSpy) + outputOf(errorSpy);
			expect(output).not.toContain(FULL_DEVICE_ID);
			expect(output).not.toContain(MODEL_URI);
			expect(output).not.toContain(ACCESS_TOKEN);
			expect(output).toContain('abcd');
		});
	});
});
