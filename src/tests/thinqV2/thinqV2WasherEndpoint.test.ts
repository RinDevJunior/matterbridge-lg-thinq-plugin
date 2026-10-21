import { OnOff } from 'matterbridge/matter/clusters';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyThinqV2WasherState, buildThinqV2WasherEndpoint } from '../../thinqV2/thinqV2WasherEndpoint.js';
import type { ThinqV2Washer, ThinqV2WasherState } from '../../thinqV2/thinqV2WasherService.js';
import { createMockLogger } from '../helpers/testUtils.js';

const mocks = vi.hoisted(() => ({
	endpoint: {
		mode: undefined as string | undefined,
		createDefaultBasicInformationClusterServer: vi.fn(),
		addCommandHandler: vi.fn(),
		updateAttribute: vi.fn(),
	},
}));

vi.mock('matterbridge/devices', () => ({
	LaundryWasher: vi.fn(function () {
		return mocks.endpoint;
	}),
}));

type PowerHandler = () => Promise<void>;

interface MockService {
	setPower: Mock;
}

const WASHER: ThinqV2Washer = {
	deviceId: 'w1',
	name: 'Laundry',
	locationName: 'MAIN',
	operationMode: { writable: true, allowedValues: ['POWER_OFF', 'POWER_ON'] },
};

function createMockService(): MockService {
	return { setPower: vi.fn() };
}

function getHandler(name: 'on' | 'off'): PowerHandler {
	const call = mocks.endpoint.addCommandHandler.mock.calls.find((entry: unknown[]) => entry[0] === name);
	if (!call) {
		throw new Error(`no ${name} handler registered`);
	}
	return call[1] as PowerHandler;
}

describe('thinqV2WasherEndpoint', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let service: MockService;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		service = createMockService();
		mocks.endpoint.mode = undefined;
	});

	describe('buildThinqV2WasherEndpoint', () => {
		it('should set the endpoint mode to server so the washer runs as its own Matter node', () => {
			// Arrange & Act
			buildThinqV2WasherEndpoint(WASHER, service, logger);

			// Assert
			expect(mocks.endpoint.mode).toBe('server');
		});

		it('should register exactly the on and off command handlers', () => {
			// Arrange & Act
			buildThinqV2WasherEndpoint(WASHER, service, logger);

			// Assert
			const names = mocks.endpoint.addCommandHandler.mock.calls.map((entry: unknown[]) => entry[0]);
			expect(names).toEqual(['on', 'off']);
		});

		it('should set basic information with the washer name and deviceId', () => {
			// Arrange & Act
			buildThinqV2WasherEndpoint(WASHER, service, logger);

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
			buildThinqV2WasherEndpoint(WASHER, service, logger);
		});

		it('should write true once after a sent outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });

			// Act
			await getHandler('on')();

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(WASHER, true);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write true after a noop outcome with powerOn true', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'noop', state: { powerOn: true } });

			// Act
			await getHandler('on')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write false after a refused outcome with powerOn false', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'guard', state: { powerOn: false } });

			// Act
			await getHandler('on')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should write false (the requested inverse) after a failed outcome with empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act
			await getHandler('on')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should write the requested value after an outcome with unknown power state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { currentState: undefined, powerOn: undefined } });

			// Act
			await getHandler('on')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write OnOff only after setPower resolved', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });

			// Act
			await getHandler('on')();

			// Assert
			const setPowerOrder = service.setPower.mock.invocationCallOrder[0] ?? Number.NaN;
			const writeOrder = mocks.endpoint.updateAttribute.mock.invocationCallOrder[0] ?? Number.NaN;
			expect(setPowerOrder).toBeLessThan(writeOrder);
		});
	});

	describe('off handler', () => {
		beforeEach(() => {
			buildThinqV2WasherEndpoint(WASHER, service, logger);
		});

		it('should write true back after a refused outcome while the washer is RUNNING', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'running', state: { powerOn: true } });

			// Act
			await getHandler('off')();

			// Assert
			expect(service.setPower).toHaveBeenCalledWith(WASHER, false);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});

		it('should write false after a sent outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: false } });

			// Act
			await getHandler('off')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', false, logger);
		});

		it('should write true (the inverse of the requested value) after a failed outcome with empty state', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act
			await getHandler('off')();

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledTimes(1);
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', true, logger);
		});
	});

	describe('handler resilience', () => {
		beforeEach(() => {
			buildThinqV2WasherEndpoint(WASHER, service, logger);
		});

		it('should resolve without throwing when setPower returns a failed outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'failed', error: 'boom', state: {} });

			// Act & Assert
			await expect(getHandler('on')()).resolves.toBeUndefined();
		});

		it('should swallow and log an updateAttribute rejection without rethrowing', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'sent', state: { powerOn: true } });
			mocks.endpoint.updateAttribute.mockRejectedValueOnce(new Error('write failed'));

			// Act & Assert
			await expect(getHandler('on')()).resolves.toBeUndefined();
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
		});

		it('should swallow and log a setPower rejection without rethrowing', async () => {
			// Arrange
			service.setPower.mockRejectedValueOnce(new Error('unexpected'));

			// Act & Assert
			await expect(getHandler('off')()).resolves.toBeUndefined();
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unexpected'));
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
		});

		it('should not log an error on a refused outcome', async () => {
			// Arrange
			service.setPower.mockResolvedValue({ status: 'refused', reason: 'running', state: { powerOn: true } });

			// Act
			await getHandler('off')();

			// Assert
			expect(logger.error).not.toHaveBeenCalled();
		});
	});

	describe('applyThinqV2WasherState', () => {
		it.each<[boolean]>([[true], [false]])('should write OnOff with powerOn %s', async (powerOn) => {
			// Arrange
			const endpoint = buildThinqV2WasherEndpoint(WASHER, service, logger);
			const state: ThinqV2WasherState = { powerOn };

			// Act
			await applyThinqV2WasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).toHaveBeenCalledWith(OnOff.id, 'onOff', powerOn, logger);
		});

		it('should skip the write and log debug when powerOn is undefined', async () => {
			// Arrange
			const endpoint = buildThinqV2WasherEndpoint(WASHER, service, logger);
			const state: ThinqV2WasherState = { currentState: undefined, powerOn: undefined };

			// Act
			await applyThinqV2WasherState(endpoint, state, logger);

			// Assert
			expect(mocks.endpoint.updateAttribute).not.toHaveBeenCalled();
			expect(logger.debug).toHaveBeenCalledTimes(1);
		});
	});
});
