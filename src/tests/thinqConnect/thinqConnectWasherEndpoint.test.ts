import { LaundryWasher } from 'matterbridge/devices';
import { OnOff, OperationalState } from 'matterbridge/matter/clusters';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS } from '../../thinqConnect/thinqConnectDeferredApply.js';
import type { ThinqConnectMatterIdentityOverride } from '../../thinqConnect/thinqConnectMatterIdentity.js';
import {
	applyThinqConnectWasherState,
	buildThinqConnectWasherEndpoint,
	mapThinqConnectWasherState,
	PAUSED_STATES,
	RUNNING_STATES,
	STOPPED_STATES,
} from '../../thinqConnect/thinqConnectWasherEndpoint.js';
import type {
	ThinqConnectWasher,
	ThinqConnectWasherService,
	ThinqConnectWasherState,
} from '../../thinqConnect/thinqConnectWasherService.js';
import { createMockLogger } from '../helpers/testUtils.js';

const mocks = vi.hoisted(() => ({
	endpoint: {
		mode: undefined as string | undefined,
		createDefaultBasicInformationClusterServer: vi.fn(),
		addCommandHandler: vi.fn(),
		updateAttribute: vi.fn(),
		getAttribute: vi.fn(),
	},
}));

vi.mock('matterbridge/devices', () => ({
	LaundryWasher: vi.fn(function () {
		return mocks.endpoint;
	}),
}));

type PowerHandler = () => Promise<void>;

type CommandName = 'on' | 'off' | 'start' | 'stop' | 'pause' | 'resume';

interface MockService {
	setPower: Mock<ThinqConnectWasherService['setPower']>;
	startCycle: Mock<ThinqConnectWasherService['startCycle']>;
	stopCycle: Mock<ThinqConnectWasherService['stopCycle']>;
}

const WASHER: ThinqConnectWasher = {
	deviceId: 'w1',
	name: 'Laundry',
	locationName: 'MAIN',
	operationMode: { writable: true, allowedValues: ['POWER_OFF', 'POWER_ON'] },
};

function createMockService(): MockService {
	return {
		setPower: vi.fn<ThinqConnectWasherService['setPower']>(),
		startCycle: vi.fn<ThinqConnectWasherService['startCycle']>(),
		stopCycle: vi.fn<ThinqConnectWasherService['stopCycle']>(),
	};
}

function getHandler(name: CommandName): PowerHandler {
	const call = mocks.endpoint.addCommandHandler.mock.calls.find((entry: unknown[]) => entry[0] === name);
	if (!call) {
		throw new Error(`no ${name} handler registered`);
	}
	return call[1] as PowerHandler;
}

describe('thinqConnectWasherEndpoint', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let service: MockService;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		service = createMockService();
		mocks.endpoint.mode = undefined;
		mocks.endpoint.getAttribute.mockReset();
	});

	describe('buildThinqConnectWasherEndpoint', () => {
		it('should set the endpoint mode to server so the washer runs as its own Matter node', () => {
			// Arrange & Act
			buildThinqConnectWasherEndpoint(WASHER, service, logger);

			// Assert
			expect(mocks.endpoint.mode).toBe('server');
		});

		it('should register exactly the on, off, start, stop, pause and resume command handlers', () => {
			// Arrange & Act
			buildThinqConnectWasherEndpoint(WASHER, service, logger);

			// Assert
			const names = mocks.endpoint.addCommandHandler.mock.calls.map((entry: unknown[]) => entry[0]);
			expect(names).toEqual(['on', 'off', 'start', 'stop', 'pause', 'resume']);
		});

		it('should set basic information with the washer name and deviceId', () => {
			// Arrange & Act
			buildThinqConnectWasherEndpoint(WASHER, service, logger);

			// Assert
			expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Laundry',
				'w1',
				0xfff1,
				'Matterbridge',
				0x8001,
				'LG Washer',
			);
		});
	});

	describe('on handler', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should write nothing when the command was sent, even after the deferred delay', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });

			// Act
			await getHandler('on')();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(WASHER, true);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should write true once after the deferred delay when noop with powerOn true', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'noop', state: { powerOn: true } });

			// Act
			await getHandler('on')();

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write the requested true after the deferred delay when noop with an empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'noop', state: {} });

			// Act
			await getHandler('on')();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should reject with the reason and write false after the deferred delay when refused with powerOn false', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'guard', state: { powerOn: false } });

			// Act
			const rejection = getHandler('on')();

			// Assert
			await expect(rejection).rejects.toThrow('guard');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should reject with the error and write false (the requested inverse) after the deferred delay when failed with empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act
			const rejection = getHandler('on')();

			// Assert
			await expect(rejection).rejects.toThrow('boom');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should write the requested value after the deferred delay when noop with an unknown power state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({
				status: 'noop',
				state: { currentState: undefined, powerOn: undefined },
			});

			// Act
			await getHandler('on')();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should call setPower before the deferred OnOff write when noop', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'noop', state: { powerOn: true } });

			// Act
			await getHandler('on')();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			const setPowerOrder = service.setPower.mock.invocationCallOrder[0] ?? Number.NaN;
			const writeOrder = mocks.endpoint.updateAttribute.mock.invocationCallOrder[0] ?? Number.NaN;
			expect(setPowerOrder).toBeLessThan(writeOrder);
		});
	});

	describe('off handler', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should reject with the reason and write true after the deferred delay when refused while RUNNING', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'running', state: { powerOn: true } });

			// Act
			const rejection = getHandler('off')();

			// Assert
			await expect(rejection).rejects.toThrow('running');
			expect(service.setPower).toHaveBeenCalledWith(WASHER, false);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write nothing when the command was sent, even after the deferred delay', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: false } });

			// Act
			await getHandler('off')();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should reject with the error and write true (the inverse of the requested value) after the deferred delay when failed with empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act
			const rejection = getHandler('off')();

			// Assert
			await expect(rejection).rejects.toThrow('boom');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});
	});

	describe('handler resilience', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should reject with the error text when setPower returns a failed outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act & Assert
			await expect(getHandler('on')()).rejects.toThrow('boom');
		});

		it('should log and swallow an updateAttribute rejection from the deferred write after a noop outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'noop', state: { powerOn: true } });
			mocks.endpoint.updateAttribute.mockRejectedValueOnce(new Error('write failed'));

			// Act
			await expect(getHandler('on')()).resolves.toBeUndefined();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
		});

		it('should rethrow and log a setPower rejection without writing any attribute', async () => {
			// Arrange
			service.setPower.mockRejectedValueOnce(new Error('unexpected'));

			// Act
			const rejection = getHandler('off')();

			// Assert
			await expect(rejection).rejects.toThrow('unexpected');
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unexpected'));
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should not log an error on a refused outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'running', state: { powerOn: true } });

			// Act
			await expect(getHandler('off')()).rejects.toThrow('running');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(logger.error).not.toHaveBeenCalled();
		});
	});

	describe('start handler', () => {
		const { Running, Stopped } = OperationalState.OperationalStateEnum;

		beforeEach(() => {
			vi.useFakeTimers();
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should resolve without writing any attribute when startCycle returns sent, even after the deferred delay', async () => {
			// Arrange
			service.startCycle.mockResolvedValue({ status: 'sent', state: {} });

			// Act & Assert
			await expect(getHandler('start')()).resolves.toBeUndefined();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(service.startCycle).toHaveBeenCalledWith(WASHER);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should resolve and write the real operational state only after the deferred delay when startCycle returns noop', async () => {
			// Arrange
			service.startCycle.mockResolvedValue({
				status: 'noop',
				state: { currentState: 'RUNNING', powerOn: true, remainingSeconds: 60 },
			});

			// Act
			await expect(getHandler('start')()).resolves.toBeUndefined();

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Running,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', 60, logger);
		});

		it('should reject with the refusal reason and write Stopped only after the deferred delay when refused in POWER_OFF', async () => {
			// Arrange
			service.startCycle.mockResolvedValue({
				status: 'refused',
				reason: 'Washer is powered off. Turn it on first.',
				state: { currentState: 'POWER_OFF', powerOn: false },
			});

			// Act & Assert
			await expect(getHandler('start')()).rejects.toThrow('Washer is powered off. Turn it on first.');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
		});

		it('should reject with the hint and revert to the previous Stopped state after the deferred delay when failed with empty state', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Stopped);
			service.startCycle.mockResolvedValue({
				status: 'failed',
				error: 'boom',
				hint: 'Remote start is off on the washer.',
				state: {},
			});

			// Act & Assert
			await expect(getHandler('start')()).rejects.toThrow('Remote start is off on the washer.');
			expect(mocks.endpoint.getAttribute).toHaveBeenCalledWith(OperationalState.id, 'operationalState');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
		});

		it('should revert to the previous Running state after the deferred delay when failed with empty state', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Running);
			service.startCycle.mockResolvedValue({ status: 'failed', error: 'boom', hint: 'hint', state: {} });

			// Act
			await expect(getHandler('start')()).rejects.toThrow('hint');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Running,
				logger,
			);
		});

		it('should reject and revert to the previous state after the deferred delay when startCycle throws unexpectedly', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Stopped);
			service.startCycle.mockRejectedValue(new Error('unexpected'));

			// Act & Assert
			await expect(getHandler('start')()).rejects.toThrow('unexpected');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
		});

		it('should keep the refusal error and log a warning after the deferred delay when the revert write rejects', async () => {
			// Arrange
			service.startCycle.mockResolvedValue({
				status: 'refused',
				reason: 'Refused reason',
				state: { currentState: 'POWER_OFF', powerOn: false },
			});
			mocks.endpoint.updateAttribute.mockRejectedValueOnce(new Error('write failed'));

			// Act & Assert
			await expect(getHandler('start')()).rejects.toThrow('Refused reason');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('write failed'));
		});
	});

	describe('stop handler', () => {
		const { Running, Stopped } = OperationalState.OperationalStateEnum;

		beforeEach(() => {
			vi.useFakeTimers();
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should resolve without writing any attribute when stopCycle returns sent, even after the deferred delay', async () => {
			// Arrange
			service.stopCycle.mockResolvedValue({ status: 'sent', state: {} });

			// Act & Assert
			await expect(getHandler('stop')()).resolves.toBeUndefined();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(service.stopCycle).toHaveBeenCalledWith(WASHER);
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should resolve and write the real state only after the deferred delay when stopCycle returns noop', async () => {
			// Arrange
			service.stopCycle.mockResolvedValue({ status: 'noop', state: { currentState: 'POWER_OFF', powerOn: false } });

			// Act
			await expect(getHandler('stop')()).resolves.toBeUndefined();

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
		});

		it('should reject with the reason and write Running only after the deferred delay when refused with Remote Start off while RUNNING', async () => {
			// Arrange
			service.stopCycle.mockResolvedValue({
				status: 'refused',
				reason: 'Remote start is off on the washer.',
				state: { currentState: 'RUNNING', powerOn: true, remoteControlEnabled: false },
			});

			// Act & Assert
			await expect(getHandler('stop')()).rejects.toThrow('Remote start is off on the washer.');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();

			// Act
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Running,
				logger,
			);
		});

		it('should revert to the previous Running state after the deferred delay and reject when failed with empty state', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Running);
			service.stopCycle.mockResolvedValue({ status: 'failed', error: 'boom', hint: 'The washer failed.', state: {} });

			// Act & Assert
			await expect(getHandler('stop')()).rejects.toThrow('The washer failed.');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Running,
				logger,
			);
		});
	});

	describe('pause and resume handlers', () => {
		const { Running, Paused, Stopped } = OperationalState.OperationalStateEnum;

		beforeEach(() => {
			vi.useFakeTimers();
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should reject with a not-supported error and restore the previous Running state after the deferred delay on pause', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Running);

			// Act & Assert
			await expect(getHandler('pause')()).rejects.toThrow('Pause and resume are not supported');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Running,
				logger,
			);
		});

		it('should reject with a not-supported error and restore the previous Paused state after the deferred delay on resume', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Paused);

			// Act & Assert
			await expect(getHandler('resume')()).rejects.toThrow('Pause and resume are not supported');
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Paused,
				logger,
			);
		});

		it('should fall back to Stopped after the deferred delay when no previous state can be read on pause', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(undefined);

			// Act & Assert
			await expect(getHandler('pause')()).rejects.toThrow('Pause and resume are not supported');
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
		});

		it('should never call startCycle, stopCycle or setPower on pause or resume', async () => {
			// Arrange
			mocks.endpoint.getAttribute.mockReturnValue(Running);

			// Act
			await expect(getHandler('pause')()).rejects.toThrow();
			await expect(getHandler('resume')()).rejects.toThrow();
			await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

			// Assert
			expect(service.startCycle).not.toHaveBeenCalled();
			expect(service.stopCycle).not.toHaveBeenCalled();
			expect(service.setPower).not.toHaveBeenCalled();
		});
	});

	describe('deadlock regression (never-resolving OnOff/OperationalState write)', () => {
		const { Running } = OperationalState.OperationalStateEnum;

		const outcomeOf = (promise: Promise<void>): Promise<string> =>
			promise.then(
				() => 'resolved',
				(error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`,
			);

		beforeEach(() => {
			vi.useFakeTimers();
			mocks.endpoint.updateAttribute.mockImplementation(() => new Promise<void>(() => {}));
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
		});

		afterEach(() => {
			mocks.endpoint.updateAttribute.mockReset();
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it.each<[CommandName, () => void, string]>([
			['on', () => service.setPower.mockResolvedValue({ status: 'noop', state: { powerOn: true } }), 'resolved'],
			[
				'on',
				() => service.setPower.mockResolvedValue({ status: 'refused', reason: 'guard', state: { powerOn: false } }),
				'rejected: guard',
			],
			[
				'on',
				() => service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} }),
				'rejected: boom',
			],
			['off', () => service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: false } }), 'resolved'],
			[
				'off',
				() => service.setPower.mockResolvedValue({ status: 'refused', reason: 'running', state: { powerOn: true } }),
				'rejected: running',
			],
			[
				'off',
				() => service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} }),
				'rejected: boom',
			],
			[
				'start',
				() =>
					service.startCycle.mockResolvedValue({ status: 'noop', state: { currentState: 'RUNNING', powerOn: true } }),
				'resolved',
			],
			[
				'start',
				() =>
					service.startCycle.mockResolvedValue({
						status: 'refused',
						reason: 'Refused reason',
						state: { currentState: 'POWER_OFF', powerOn: false },
					}),
				'rejected: Refused reason',
			],
			[
				'start',
				() => service.startCycle.mockResolvedValue({ status: 'failed', error: 'boom', hint: 'hint', state: {} }),
				'rejected: hint',
			],
			[
				'stop',
				() =>
					service.stopCycle.mockResolvedValue({ status: 'noop', state: { currentState: 'POWER_OFF', powerOn: false } }),
				'resolved',
			],
			[
				'stop',
				() =>
					service.stopCycle.mockResolvedValue({
						status: 'refused',
						reason: 'Remote start is off.',
						state: { currentState: 'RUNNING', powerOn: true },
					}),
				'rejected: Remote start is off.',
			],
			[
				'stop',
				() =>
					service.stopCycle.mockResolvedValue({
						status: 'failed',
						error: 'boom',
						hint: 'The washer failed.',
						state: {},
					}),
				'rejected: The washer failed.',
			],
			[
				'pause',
				() => mocks.endpoint.getAttribute.mockReturnValue(Running),
				'rejected: Pause and resume are not supported by the ThinQ Connect API.',
			],
			[
				'resume',
				() => mocks.endpoint.getAttribute.mockReturnValue(Running),
				'rejected: Pause and resume are not supported by the ThinQ Connect API.',
			],
		])(
			'should settle the %s handler without waiting for the write (arrange %#)',
			async (command, arrange, expected) => {
				// Arrange
				arrange();

				// Act
				const settled = outcomeOf(getHandler(command)());
				await vi.advanceTimersByTimeAsync(THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);

				// Assert
				await expect(settled).resolves.toBe(expected);
			},
		);
	});

	describe('exported state sets', () => {
		it('should keep RUNNING_STATES, PAUSED_STATES and STOPPED_STATES equal to their original contents', () => {
			// Act & Assert
			expect([...RUNNING_STATES].sort()).toEqual(
				[
					'RUNNING',
					'SOAKING',
					'DETECTING',
					'RINSING',
					'DETERGENT_AMOUNT',
					'DRYING',
					'PREWASH',
					'STEAM_SOFTENING',
					'SPINNING',
					'DISPENSING',
					'ADD_DRAIN',
				].sort(),
			);
			expect([...PAUSED_STATES].sort()).toEqual(['PAUSE', 'RINSE_HOLD'].sort());
			expect([...STOPPED_STATES].sort()).toEqual(
				[
					'POWER_OFF',
					'INITIAL',
					'END',
					'RESERVED',
					'REFRESHING',
					'FROZEN_PREVENT_INITIAL',
					'FROZEN_PREVENT_RUNNING',
					'FROZEN_PREVENT_PAUSE',
				].sort(),
			);
		});
	});

	describe('mapThinqConnectWasherState', () => {
		const { Running, Paused, Stopped, Error: ErrorState } = OperationalState.OperationalStateEnum;

		it.each([
			'RUNNING',
			'SOAKING',
			'DETECTING',
			'RINSING',
			'DETERGENT_AMOUNT',
			'DRYING',
			'PREWASH',
			'STEAM_SOFTENING',
			'SPINNING',
			'DISPENSING',
			'ADD_DRAIN',
		])('should map %s to Running', (currentState) => {
			// Act
			const result = mapThinqConnectWasherState(currentState);

			// Assert
			expect(result).toBe(Running);
		});

		it.each(['PAUSE', 'RINSE_HOLD'])('should map %s to Paused', (currentState) => {
			// Act
			const result = mapThinqConnectWasherState(currentState);

			// Assert
			expect(result).toBe(Paused);
		});

		it('should map ERROR to Error', () => {
			// Act
			const result = mapThinqConnectWasherState('ERROR');

			// Assert
			expect(result).toBe(ErrorState);
		});

		it.each([
			'POWER_OFF',
			'INITIAL',
			'END',
			'RESERVED',
			'REFRESHING',
			'FROZEN_PREVENT_INITIAL',
			'FROZEN_PREVENT_RUNNING',
			'FROZEN_PREVENT_PAUSE',
		])('should map %s to Stopped', (currentState) => {
			// Act
			const result = mapThinqConnectWasherState(currentState);

			// Assert
			expect(result).toBe(Stopped);
		});

		it.each(['SOMETHING_NEW', 'running', ''])(
			'should map unknown or non-canonical %j to Stopped, never Running',
			(currentState) => {
				// Act
				const result = mapThinqConnectWasherState(currentState);

				// Assert
				expect(result).toBe(Stopped);
			},
		);

		it('should map undefined to Stopped', () => {
			// Act
			const result = mapThinqConnectWasherState(undefined);

			// Assert
			expect(result).toBe(Stopped);
		});
	});

	describe('applyThinqConnectWasherState operational state', () => {
		const { Running, Paused, Stopped, Error: ErrorState } = OperationalState.OperationalStateEnum;

		it('should write OnOff true, Running, NoError and the remaining countdown for RUNNING', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'RUNNING', powerOn: true, remainingSeconds: 5400 };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(4);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Running,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalError',
				{ errorStateId: OperationalState.ErrorState.NoError },
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', 5400, logger);
		});

		it('should write Paused and keep the remaining countdown for PAUSE', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'PAUSE', powerOn: true, remainingSeconds: 600 };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Paused,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', 600, logger);
		});

		it('should write OnOff false, Stopped, NoError and countdown 0 for POWER_OFF', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'POWER_OFF', powerOn: false };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalError',
				{ errorStateId: OperationalState.ErrorState.NoError },
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', 0, logger);
		});

		it('should write Error and UnableToCompleteOperation for ERROR', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'ERROR', powerOn: true };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				ErrorState,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalError',
				{ errorStateId: OperationalState.ErrorState.UnableToCompleteOperation },
				logger,
			);
		});

		it('should write Stopped and countdown 0 for INITIAL even when remainingSeconds is set', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'INITIAL', powerOn: true, remainingSeconds: 7080 };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', 0, logger);
		});

		it('should write a null countdown when RUNNING has no remaining time', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'RUNNING', powerOn: true, remainingSeconds: undefined };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', null, logger);
		});

		it('should write Stopped with one debug log naming the state when the state is unknown', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: 'SOMETHING_NEW', powerOn: true, remainingSeconds: 120 };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(
				OperationalState.id,
				'operationalState',
				Stopped,
				logger,
			);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OperationalState.id, 'countdownTime', 0, logger);
			expect(logger.debug).toHaveBeenCalledTimes(1);
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('SOMETHING_NEW'));
		});

		it('should write exactly one OnOff attribute and no OperationalState when only powerOn is given', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { powerOn: true };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should propagate an updateAttribute rejection to the caller', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			mocks.endpoint.updateAttribute.mockRejectedValueOnce(new Error('write failed'));

			// Act & Assert
			await expect(
				applyThinqConnectWasherState(endpoint, { currentState: 'RUNNING', powerOn: true }, logger),
			).rejects.toThrow('write failed');
		});
	});

	describe('applyThinqConnectWasherState', () => {
		it.each<[boolean]>([[true], [false]])('should write OnOff with powerOn %s', async (powerOn) => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { powerOn };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', powerOn, logger);
		});

		it('should skip the write and log debug when powerOn is undefined', async () => {
			// Arrange
			const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger);
			const state: ThinqConnectWasherState = { currentState: undefined, powerOn: undefined };

			// Act
			await applyThinqConnectWasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
			expect(logger.debug).toHaveBeenCalledTimes(1);
		});
	});

	describe('buildThinqConnectWasherEndpoint identity overrides', () => {
		const WASHER_IDENTITY_CASES: {
			field: string;
			identity: ThinqConnectMatterIdentityOverride;
			expected: [number, string, number, string];
		}[] = [
			{ field: 'no override (defaults)', identity: {}, expected: [0xfff1, 'Matterbridge', 0x8001, 'LG Washer'] },
			{ field: 'vendorId', identity: { vendorId: 0x1234 }, expected: [0x1234, 'Matterbridge', 0x8001, 'LG Washer'] },
			{ field: 'vendorName', identity: { vendorName: 'Acme' }, expected: [0xfff1, 'Acme', 0x8001, 'LG Washer'] },
			{ field: 'productId', identity: { productId: 0x8123 }, expected: [0xfff1, 'Matterbridge', 0x8123, 'LG Washer'] },
			{
				field: 'productName',
				identity: { productName: 'Den Washer' },
				expected: [0xfff1, 'Matterbridge', 0x8001, 'Den Washer'],
			},
			{
				field: 'undefined vendorId falls back to default',
				identity: { vendorId: undefined, productName: 'Den Washer' },
				expected: [0xfff1, 'Matterbridge', 0x8001, 'Den Washer'],
			},
		];

		it.each(WASHER_IDENTITY_CASES)(
			'should apply only the $field identity field to basic information',
			({ identity, expected }) => {
				// Arrange & Act
				buildThinqConnectWasherEndpoint(WASHER, service, logger, identity);

				// Assert
				expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
					'Laundry',
					'w1',
					...expected,
				);
			},
		);

		it('should keep the deviceId as serial number and uniqueId when every identity field is overridden', () => {
			// Arrange
			const identity: ThinqConnectMatterIdentityOverride = {
				vendorId: 0x1234,
				vendorName: 'Acme',
				productId: 0x8123,
				productName: 'Den Washer',
			};

			// Act
			buildThinqConnectWasherEndpoint(WASHER, service, logger, identity);

			// Assert
			expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
				'Laundry',
				'w1',
				0x1234,
				'Acme',
				0x8123,
				'Den Washer',
			);
			expect(vi.mocked(LaundryWasher)).toHaveBeenCalledWith('Laundry', 'w1');
		});

		describe('legacyId (account-login id) identity', () => {
			const LEGACY_WASHER_ID = 'ee7980cc-7dba-13a4-af04-dc69cc57b6a8';

			it('should construct the LaundryWasher and basic information with the legacy id when legacyId is set', () => {
				// Arrange
				const identity: ThinqConnectMatterIdentityOverride = { legacyId: LEGACY_WASHER_ID };

				// Act
				const endpoint = buildThinqConnectWasherEndpoint(WASHER, service, logger, identity);

				// Assert
				expect(vi.mocked(LaundryWasher)).toHaveBeenCalledWith('Laundry', LEGACY_WASHER_ID);
				expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
					'Laundry',
					LEGACY_WASHER_ID,
					0xfff1,
					'Matterbridge',
					0x8001,
					'LG Washer',
				);
				expect(mocks.endpoint.mode).toBe('server');
				expect(endpoint).toBe(mocks.endpoint);
			});

			it('should keep the existing w1 id and serial when legacyId is undefined', () => {
				// Arrange
				const identity: ThinqConnectMatterIdentityOverride = { legacyId: undefined };

				// Act
				buildThinqConnectWasherEndpoint(WASHER, service, logger, identity);

				// Assert
				expect(vi.mocked(LaundryWasher)).toHaveBeenCalledWith('Laundry', 'w1');
				expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
					'Laundry',
					'w1',
					0xfff1,
					'Matterbridge',
					0x8001,
					'LG Washer',
				);
			});

			it('should apply the vendor and product overrides and use the legacy id as serial when both are set', () => {
				// Arrange
				const identity: ThinqConnectMatterIdentityOverride = {
					legacyId: LEGACY_WASHER_ID,
					vendorId: 0x1234,
					vendorName: 'Acme',
					productId: 0x8123,
					productName: 'Den Washer',
				};

				// Act
				buildThinqConnectWasherEndpoint(WASHER, service, logger, identity);

				// Assert
				expect(vi.mocked(LaundryWasher)).toHaveBeenCalledWith('Laundry', LEGACY_WASHER_ID);
				expect(mocks.endpoint.createDefaultBasicInformationClusterServer).toHaveBeenCalledWith(
					'Laundry',
					LEGACY_WASHER_ID,
					0x1234,
					'Acme',
					0x8123,
					'Den Washer',
				);
			});

			it('should call the power command with the original washer when legacyId is set', async () => {
				// Arrange
				service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });
				buildThinqConnectWasherEndpoint(WASHER, service, logger, { legacyId: LEGACY_WASHER_ID });

				// Act
				await getHandler('on')();

				// Assert
				expect(service.setPower).toHaveBeenCalledWith(WASHER, true);
				expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ThinQ Connect w1'));
				expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining(LEGACY_WASHER_ID));
			});

			it.each(['start', 'stop'] as const)(
				'should call the %s cycle command with the original washer when legacyId is set',
				async (command) => {
					// Arrange
					service.startCycle.mockResolvedValue({ status: 'sent', state: {} });
					service.stopCycle.mockResolvedValue({ status: 'sent', state: {} });
					buildThinqConnectWasherEndpoint(WASHER, service, logger, { legacyId: LEGACY_WASHER_ID });

					// Act
					await getHandler(command)();

					// Assert
					const cycleMock = command === 'start' ? service.startCycle : service.stopCycle;
					expect(cycleMock).toHaveBeenCalledWith(WASHER);
					expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalledWith(
						expect.anything(),
						'operationalState',
						expect.anything(),
						expect.anything(),
					);
				},
			);
		});
	});
});
