import { LaundryWasher } from 'matterbridge/devices';
import { OnOff } from 'matterbridge/matter/clusters';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqConnectMatterIdentityOverride } from '../../thinqConnect/thinqConnectMatterIdentity.js';
import {
	applyThinqConnectWasherState,
	buildThinqConnectWasherEndpoint,
} from '../../thinqConnect/thinqConnectWasherEndpoint.js';
import type { ThinqConnectWasher, ThinqConnectWasherState } from '../../thinqConnect/thinqConnectWasherService.js';
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

const WASHER: ThinqConnectWasher = {
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

describe('thinqConnectWasherEndpoint', () => {
	let logger: ReturnType<typeof createMockLogger>;
	let service: MockService;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockLogger();
		service = createMockService();
		mocks.endpoint.mode = undefined;
	});

	describe('buildThinqConnectWasherEndpoint', () => {
		it('should set the endpoint mode to server so the washer runs as its own Matter node', () => {
			// Arrange & Act
			buildThinqConnectWasherEndpoint(WASHER, service, logger);

			// Assert
			expect(mocks.endpoint.mode).toBe('server');
		});

		it('should register exactly the on and off command handlers', () => {
			// Arrange & Act
			buildThinqConnectWasherEndpoint(WASHER, service, logger);

			// Assert
			const names = mocks.endpoint.addCommandHandler.mock.calls.map((entry: unknown[]) => entry[0]);
			expect(names).toEqual(['on', 'off']);
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
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
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
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
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
			buildThinqConnectWasherEndpoint(WASHER, service, logger);
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
	});
});
