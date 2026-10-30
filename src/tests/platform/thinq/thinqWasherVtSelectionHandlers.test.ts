import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { LaundryWasherControls, LaundryWasherMode, TemperatureControl } from 'matterbridge/matter/clusters';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqWasherDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { resolveWasherMatterPlan, type WasherMatterPlan } from '../../../platform/thinq/thinqWasherMatterPlan.js';
import type { WasherVtChange, WasherVtOutcome } from '../../../platform/thinq/thinqWasherVtController.js';
import {
	registerWasherVtSelectionHandlers,
	WASHER_SELECTION_DEBOUNCE_MS,
	type WasherVtChangeRunner,
} from '../../../platform/thinq/thinqWasherVtSelectionHandlers.js';
import { maskSecret } from '../../../utils/mask.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

type CommandHandler = (data: unknown) => Promise<void>;
type AttributeListener = (newValue: number | null, oldValue: number | null, context: { fabric?: number }) => void;
type ApplyChanges = Mock<(changes: readonly WasherVtChange[]) => Promise<WasherVtOutcome>>;

const DEVICE_ID = 'WASHER-DEVICE-0000ABCD';
const MASKED_ID = maskSecret(DEVICE_ID, 4);
const MODE_COLDWASH = 1;
const MODE_DRUM_CARE = 2;
const MODE_NORMAL = 3;
const TEMPERATURE_LABELS = ['Cold', '20C', '30C', '40C', '60C', '95C'];

const FULL_RINSE = {
	value: 'rinse',
	default: 'RINSE_2',
	selectable: ['NO_RINSE', 'RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'],
};
/** TURBO39 / SPEED14 / RINSE_SPIN shape: no "no rinse" entry. */
const NO_NONE_RINSE = {
	value: 'rinse',
	default: 'RINSE_1',
	selectable: ['RINSE_1', 'RINSE_2', 'RINSE_3', 'RINSE_4', 'RINSE_5'],
};
/** TUB_CLEAN shape: one fixed value, not writable. */
const FIXED_RINSE = { value: 'rinse', default: 'RINSE_2' };

/** Three courses: COLDWASH (mode 1, fixed temp), DRUM_CARE (mode 2, no option keys), NORMAL (mode 3, all keys). */
function buildWasherModel(normalRinse: Record<string, unknown> = FULL_RINSE): Record<string, unknown> {
	return {
		Config: { defaultCourse: 'NORMAL', courseType: 'course', smartCourseType: 'SmartCourse' },
		Course: {
			NORMAL: {
				function: [
					{ value: 'spin', default: 'SPIN_1400', selectable: ['SPIN_800', 'SPIN_1000', 'SPIN_1200', 'SPIN_1400'] },
					{
						value: 'temp',
						default: 'TEMP_40',
						selectable: ['TEMP_COLD', 'TEMP_20', 'TEMP_30', 'TEMP_40', 'TEMP_60', 'TEMP_95'],
					},
					normalRinse,
				],
			},
			COLDWASH: {
				function: [{ value: 'temp', default: 'TEMP_COLD' }],
			},
			DRUM_CARE: {
				function: [{ value: 'drumClean', default: 'DRUM_CLEAN_ON', selectable: ['DRUM_CLEAN_ON'] }],
			},
		},
	};
}

function buildPlan(model: Record<string, unknown> = buildWasherModel()): WasherMatterPlan {
	const plan = resolveWasherMatterPlan(model);
	if (plan === undefined) {
		throw new Error('fixture model must produce a plan');
	}
	return plan;
}

describe('registerWasherVtSelectionHandlers', () => {
	let logger: AnsiLogger;
	let endpoint: MatterbridgeEndpoint;
	let applyChanges: ApplyChanges;
	let runner: WasherVtChangeRunner;
	let device: ThinqWasherDevice;
	let currentMode: number | undefined;
	let temperatureLabels: string[] | undefined;

	function createEndpoint(): MatterbridgeEndpoint {
		return asPartial<MatterbridgeEndpoint>({
			log: createMockLogger(),
			addCommandHandler: vi.fn(),
			subscribeAttribute: vi.fn(),
			updateAttribute: vi.fn().mockResolvedValue(true),
			getAttribute: vi.fn((clusterId: unknown, attribute: unknown) => {
				if (clusterId === LaundryWasherMode.id && attribute === 'currentMode') {
					return currentMode;
				}
				if (clusterId === TemperatureControl.id && attribute === 'supportedTemperatureLevels') {
					return temperatureLabels;
				}
				return undefined;
			}),
		});
	}

	/** Creates a fresh endpoint and registers the selection handlers on it with the given plan. */
	function register(plan: WasherMatterPlan): void {
		endpoint = createEndpoint();
		registerWasherVtSelectionHandlers(endpoint, device, runner, plan, logger);
	}

	function commandHandler(name: string): CommandHandler {
		const entry = vi.mocked(endpoint.addCommandHandler).mock.calls.find((args: any[]) => args[0] === name);
		return entry?.[1] as CommandHandler;
	}

	function attributeListener(attribute: string): AttributeListener {
		const entry = vi.mocked(endpoint.subscribeAttribute).mock.calls.find((args: any[]) => args[1] === attribute);
		return entry?.[2] as AttributeListener;
	}

	/** Lets the debounce window close so the queued batch is sent. */
	async function closeWindow(): Promise<void> {
		await vi.advanceTimersByTimeAsync(WASHER_SELECTION_DEBOUNCE_MS);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		logger = createMockLogger();
		device = asPartial<ThinqWasherDevice>({ id: DEVICE_ID });
		applyChanges = vi
			.fn<(changes: readonly WasherVtChange[]) => Promise<WasherVtOutcome>>()
			.mockResolvedValue({ status: 'done', message: 'ok' });
		runner = { applyChanges };
		currentMode = MODE_NORMAL;
		temperatureLabels = [...TEMPERATURE_LABELS];
		register(buildPlan());
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('registration', () => {
		it('should register exactly changeToMode and setTemperature and subscribe to spinSpeedCurrent and numberOfRinses', () => {
			// Arrange / Act
			const commands = vi.mocked(endpoint.addCommandHandler).mock.calls.map(([name]) => name);
			const attributes = vi.mocked(endpoint.subscribeAttribute).mock.calls.map(([, attribute]) => attribute);
			// Assert
			expect([...commands].sort()).toEqual(['changeToMode', 'setTemperature']);
			expect([...attributes].sort()).toEqual(['numberOfRinses', 'spinSpeedCurrent']);
			expect(endpoint.addCommandHandler).toHaveBeenCalledTimes(2);
			expect(endpoint.subscribeAttribute).toHaveBeenCalledTimes(2);
		});
	});

	describe('changeToMode', () => {
		it('should send one course change and resolve when the outcome is done', async () => {
			// Arrange
			const handler = commandHandler('changeToMode');
			// Act
			await handler({ request: { newMode: MODE_NORMAL } });
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'course', courseId: 'NORMAL' }]);
		});

		it('should resolve when the outcome is noop because nothing needed to change', async () => {
			// Arrange
			applyChanges.mockResolvedValueOnce({ status: 'noop', message: 'the washer already has these settings' });
			const handler = commandHandler('changeToMode');
			// Act / Assert
			await expect(handler({ request: { newMode: MODE_NORMAL } })).resolves.toBeUndefined();
		});

		it.each(['refused', 'failed', 'unconfirmed', 'staged'] as const)(
			'should reject with the outcome message and leave the mode alone when the outcome is %s',
			async (status) => {
				// Arrange
				applyChanges.mockResolvedValueOnce({ status, message: `${status} reason` });
				const handler = commandHandler('changeToMode');
				// Act / Assert
				await expect(handler({ request: { newMode: MODE_NORMAL } })).rejects.toThrow(`${status} reason`);
				expect(endpoint.updateAttribute).not.toHaveBeenCalled();
			},
		);

		it('should reject with the not-on-this-washer text and send nothing when the mode number is unknown', async () => {
			// Arrange
			const handler = commandHandler('changeToMode');
			// Act / Assert
			await expect(handler({ request: { newMode: 99 } })).rejects.toThrow('That wash course is not on this washer.');
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it.each([
			['undefined', undefined],
			['an empty object', {}],
			['a null request', { request: null }],
			['an empty request', { request: {} }],
			['a string mode', { request: { newMode: 'x' } }],
		])('should reject with the could-not-read text and no TypeError for %s', async (_label, data) => {
			// Arrange
			const handler = commandHandler('changeToMode');
			// Act / Assert
			await expect(handler(data)).rejects.toThrow('could not read');
			expect(applyChanges).not.toHaveBeenCalled();
		});
	});

	describe('setTemperature', () => {
		it('should send the NORMAL temperature at the requested index as a temp option', async () => {
			// Arrange
			const handler = commandHandler('setTemperature');
			// Act
			await handler({ request: { targetTemperatureLevel: 2 } });
			// Assert
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'option', key: 'temp', value: 'TEMP_30' }]);
		});

		it('should reject with the out-of-range text and send nothing when the index is past the endpoint labels', async () => {
			// Arrange
			const handler = commandHandler('setTemperature');
			// Act / Assert
			await expect(handler({ request: { targetTemperatureLevel: 6 } })).rejects.toThrow(
				'That setting is not available for the selected wash course.',
			);
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should reject with the no-temperature text and send nothing when the current course has no temp setting', async () => {
			// Arrange
			currentMode = MODE_DRUM_CARE;
			const handler = commandHandler('setTemperature');
			// Act / Assert
			await expect(handler({ request: { targetTemperatureLevel: 1 } })).rejects.toThrow(
				'The selected wash course has no temperature setting.',
			);
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should resolve the index against the plan list when the endpoint has no temperature labels', async () => {
			// Arrange
			temperatureLabels = undefined;
			const handler = commandHandler('setTemperature');
			// Act
			await handler({ request: { targetTemperatureLevel: 2 } });
			// Assert
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'option', key: 'temp', value: 'TEMP_30' }]);
		});

		it('should reject with the out-of-range text when the index is past the plan list even without labels', async () => {
			// Arrange
			temperatureLabels = undefined;
			const handler = commandHandler('setTemperature');
			// Act / Assert
			await expect(handler({ request: { targetTemperatureLevel: 6 } })).rejects.toThrow(
				'That setting is not available for the selected wash course.',
			);
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it.each([
			['undefined', undefined],
			['an empty object', {}],
			['a null request', { request: null }],
			['an empty request', { request: {} }],
			['a string level', { request: { targetTemperatureLevel: 'x' } }],
		])('should reject with the could-not-read text and no TypeError for %s', async (_label, data) => {
			// Arrange
			const handler = commandHandler('setTemperature');
			// Act / Assert
			await expect(handler(data)).rejects.toThrow('could not read');
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should reject with the outcome message and leave the level alone when the batch is refused', async () => {
			// Arrange
			applyChanges.mockResolvedValueOnce({ status: 'refused', message: 'Remote Control is on' });
			const handler = commandHandler('setTemperature');
			// Act / Assert
			await expect(handler({ request: { targetTemperatureLevel: 1 } })).rejects.toThrow('Remote Control is on');
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});
	});

	describe('spinSpeedCurrent listener', () => {
		it('should ignore a local write (no fabric) without sending or reverting', async () => {
			// Arrange
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(0, 2, { fabric: undefined });
			await closeWindow();
			// Assert
			expect(applyChanges).not.toHaveBeenCalled();
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should ignore a null spin value without sending or reverting', async () => {
			// Arrange
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(null, 2, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).not.toHaveBeenCalled();
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should send the spin option and never revert when the batch is done', async () => {
			// Arrange
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(0, 2, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'option', key: 'spin', value: 'SPIN_800' }]);
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should roll back to the old index exactly once when the batch is refused', async () => {
			// Arrange
			applyChanges.mockResolvedValueOnce({ status: 'refused', message: 'door open' });
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(0, 2, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'spinSpeedCurrent',
				2,
				expect.anything(),
			);
		});

		it('should not throw and leave no unhandled rejection when the rollback write rejects', async () => {
			// Arrange
			vi.mocked(endpoint.updateAttribute).mockRejectedValueOnce(new Error('websocket closed'));
			currentMode = MODE_DRUM_CARE;
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			const call = (): void => listener(0, 2, { fabric: 1 });
			// Assert
			expect(call).not.toThrow();
			await vi.advanceTimersByTimeAsync(0);
		});

		it('should roll back and warn once without sending when the course has no spin setting', async () => {
			// Arrange
			currentMode = MODE_DRUM_CARE;
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(1, 2, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'spinSpeedCurrent',
				2,
				expect.anything(),
			);
			expect(logger.warn).toHaveBeenCalledTimes(1);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('The selected wash course has no spin setting.'),
			);
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should roll back without sending when the index is out of range for the course spin list', async () => {
			// Arrange
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(9, 2, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'spinSpeedCurrent',
				2,
				expect.anything(),
			);
			expect(logger.warn).toHaveBeenCalledTimes(1);
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should never throw for a local write, a null value, a missing list or an out-of-range index', () => {
			// Arrange
			const listener = attributeListener('spinSpeedCurrent');
			// Act / Assert
			expect(() => listener(0, 2, { fabric: undefined })).not.toThrow();
			expect(() => listener(null, 2, { fabric: 1 })).not.toThrow();
			expect(() => listener(9, 2, { fabric: 1 })).not.toThrow();
			currentMode = MODE_DRUM_CARE;
			expect(() => listener(0, 2, { fabric: 1 })).not.toThrow();
		});
	});

	describe('numberOfRinses listener', () => {
		it('should ignore a local write (no fabric) without sending or reverting', async () => {
			// Arrange
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(LaundryWasherControls.NumberOfRinses.Normal, LaundryWasherControls.NumberOfRinses.Max, {
				fabric: undefined,
			});
			await closeWindow();
			// Assert
			expect(applyChanges).not.toHaveBeenCalled();
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should ignore a non-number value without sending or reverting', async () => {
			// Arrange
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(null, LaundryWasherControls.NumberOfRinses.Max, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).not.toHaveBeenCalled();
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it.each([
			['Normal', LaundryWasherControls.NumberOfRinses.Normal, 'RINSE_2'],
			['Extra', LaundryWasherControls.NumberOfRinses.Extra, 'RINSE_3'],
			['Max', LaundryWasherControls.NumberOfRinses.Max, 'RINSE_4'],
			['None', LaundryWasherControls.NumberOfRinses.None, 'NO_RINSE'],
		])('should send the canonical value for %s', async (_label, count, value) => {
			// Arrange
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(count, LaundryWasherControls.NumberOfRinses.Normal, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'option', key: 'rinse', value }]);
		});

		it('should roll back and warn without sending when the course list has no NO_RINSE', async () => {
			// Arrange
			register(buildPlan(buildWasherModel(NO_NONE_RINSE)));
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(LaundryWasherControls.NumberOfRinses.None, LaundryWasherControls.NumberOfRinses.Max, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Max,
				expect.anything(),
			);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not allow that number of rinses'));
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should roll back and warn without sending when the rinse list is not writable', async () => {
			// Arrange
			register(buildPlan(buildWasherModel(FIXED_RINSE)));
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(LaundryWasherControls.NumberOfRinses.Normal, LaundryWasherControls.NumberOfRinses.Max, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Max,
				expect.anything(),
			);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not allow that number of rinses'));
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should roll back and warn with the no-rinse text when the current course has no rinse setting', async () => {
			// Arrange
			currentMode = MODE_DRUM_CARE;
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(LaundryWasherControls.NumberOfRinses.Normal, LaundryWasherControls.NumberOfRinses.Extra, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Extra,
				expect.anything(),
			);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('The selected wash course has no rinse setting.'),
			);
			expect(applyChanges).not.toHaveBeenCalled();
		});

		it('should roll back to the old count when the batch is refused', async () => {
			// Arrange
			applyChanges.mockResolvedValueOnce({ status: 'refused', message: 'child lock' });
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(LaundryWasherControls.NumberOfRinses.Extra, LaundryWasherControls.NumberOfRinses.Normal, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Normal,
				expect.anything(),
			);
		});

		it('should not roll back when the batch is done', async () => {
			// Arrange
			const listener = attributeListener('numberOfRinses');
			// Act
			listener(LaundryWasherControls.NumberOfRinses.Extra, LaundryWasherControls.NumberOfRinses.Normal, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(endpoint.updateAttribute).not.toHaveBeenCalled();
		});
	});

	describe('debounce and coalesce', () => {
		it('should send one batch with both the spin and the rinse change when they land inside the window', async () => {
			// Arrange
			const spin = attributeListener('spinSpeedCurrent');
			const rinse = attributeListener('numberOfRinses');
			// Act
			spin(0, 2, { fabric: 1 });
			await vi.advanceTimersByTimeAsync(100);
			rinse(LaundryWasherControls.NumberOfRinses.Extra, LaundryWasherControls.NumberOfRinses.Normal, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(applyChanges).toHaveBeenCalledWith([
				{ kind: 'option', key: 'spin', value: 'SPIN_800' },
				{ kind: 'option', key: 'rinse', value: 'RINSE_3' },
			]);
		});

		it('should keep only the last spin value when two spin writes land 200 ms apart', async () => {
			// Arrange
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(0, 2, { fabric: 1 });
			await vi.advanceTimersByTimeAsync(200);
			listener(2, 0, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'option', key: 'spin', value: 'SPIN_1200' }]);
		});

		it('should not re-arm the window when a second change arrives before it closes', async () => {
			// Arrange
			const spin = attributeListener('spinSpeedCurrent');
			const rinse = attributeListener('numberOfRinses');
			// Act
			spin(0, 2, { fabric: 1 });
			await vi.advanceTimersByTimeAsync(1000);
			rinse(LaundryWasherControls.NumberOfRinses.Normal, LaundryWasherControls.NumberOfRinses.Max, { fabric: 1 });
			await vi.advanceTimersByTimeAsync(200);
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
		});

		it('should send the pending option and the course in one call when changeToMode arrives during an open window', async () => {
			// Arrange
			attributeListener('spinSpeedCurrent')(0, 2, { fabric: 1 });
			// Act
			await commandHandler('changeToMode')({ request: { newMode: MODE_NORMAL } });
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(applyChanges).toHaveBeenCalledWith([
				{ kind: 'option', key: 'spin', value: 'SPIN_800' },
				{ kind: 'course', courseId: 'NORMAL' },
			]);
		});

		it('should send the pending option and the temperature in one call when setTemperature arrives during an open window', async () => {
			// Arrange
			attributeListener('spinSpeedCurrent')(0, 2, { fabric: 1 });
			// Act
			await commandHandler('setTemperature')({ request: { targetTemperatureLevel: 1 } });
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(applyChanges).toHaveBeenCalledWith([
				{ kind: 'option', key: 'spin', value: 'SPIN_800' },
				{ kind: 'option', key: 'temp', value: 'TEMP_20' },
			]);
		});

		it('should start a new batch for a change that arrives during an in-flight send', async () => {
			// Arrange
			let resolveFirst: ((outcome: WasherVtOutcome) => void) | undefined;
			applyChanges.mockImplementationOnce(
				() =>
					new Promise<WasherVtOutcome>((resolve) => {
						resolveFirst = resolve;
					}),
			);
			attributeListener('spinSpeedCurrent')(0, 2, { fabric: 1 });
			await closeWindow();
			// Act
			attributeListener('numberOfRinses')(
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Max,
				{
					fabric: 1,
				},
			);
			resolveFirst?.({ status: 'done', message: 'ok' });
			await vi.advanceTimersByTimeAsync(0);
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(2);
			expect(applyChanges).toHaveBeenLastCalledWith([{ kind: 'option', key: 'rinse', value: 'RINSE_2' }]);
		});

		it('should run every queued revert when one batch is refused', async () => {
			// Arrange
			applyChanges.mockResolvedValueOnce({ status: 'refused', message: 'door open' });
			attributeListener('spinSpeedCurrent')(0, 2, { fabric: 1 });
			attributeListener('numberOfRinses')(
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Max,
				{
					fabric: 1,
				},
			);
			// Act
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledTimes(1);
			expect(endpoint.updateAttribute).toHaveBeenCalledTimes(2);
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'spinSpeedCurrent',
				2,
				expect.anything(),
			);
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'numberOfRinses',
				LaundryWasherControls.NumberOfRinses.Max,
				expect.anything(),
			);
		});

		it('should treat a rejected applyChanges as a failure: revert, no unhandled rejection, command handlers reject', async () => {
			// Arrange
			applyChanges.mockRejectedValueOnce(new Error('link down'));
			attributeListener('spinSpeedCurrent')(0, 2, { fabric: 1 });
			// Act
			const pending = commandHandler('changeToMode')({ request: { newMode: MODE_NORMAL } });
			// Assert
			await expect(pending).rejects.toThrow('link down');
			expect(endpoint.updateAttribute).toHaveBeenCalledWith(
				LaundryWasherControls.id,
				'spinSpeedCurrent',
				2,
				expect.anything(),
			);
		});
	});

	describe('logging', () => {
		it('should log refusals with the masked device id and never the full id', async () => {
			// Arrange
			currentMode = MODE_DRUM_CARE;
			// Act
			attributeListener('spinSpeedCurrent')(1, 2, { fabric: 1 });
			attributeListener('numberOfRinses')(
				LaundryWasherControls.NumberOfRinses.Normal,
				LaundryWasherControls.NumberOfRinses.Max,
				{
					fabric: 1,
				},
			);
			await closeWindow();
			const logged = JSON.stringify([
				vi.mocked(logger.info).mock.calls,
				vi.mocked(logger.warn).mock.calls,
				vi.mocked(logger.error).mock.calls,
			]);
			// Assert
			expect(logged).toContain(MASKED_ID);
			expect(logged).not.toContain(DEVICE_ID);
		});
	});

	describe('current course', () => {
		it('should resolve the Normal course when the current mode is unreadable', async () => {
			// Arrange
			currentMode = undefined;
			const listener = attributeListener('spinSpeedCurrent');
			// Act
			listener(0, 2, { fabric: 1 });
			await closeWindow();
			// Assert
			expect(applyChanges).toHaveBeenCalledWith([{ kind: 'option', key: 'spin', value: 'SPIN_800' }]);
		});
	});
});
