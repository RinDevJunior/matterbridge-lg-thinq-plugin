import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinqAirConditionerDevice } from '../../../core/domain/entities/ThinqDevice.js';
import { DEFAULT_AIR_CONDITIONER_CAPABILITIES } from '../../../core/domain/value-objects/AirConditionerCapabilities.js';
import { ThinqFilterState } from '../../../core/domain/value-objects/ThinqFilterState.js';
import {
	registerFilterResetCommandHandler,
	resolveFilterResetPayload,
} from '../../../platform/thinq/thinqAirConditionerFilterResetCommandHandler.js';
import type { ThinqApiClient } from '../../../services/thinq/thinqApiClient.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

function createMockApiClient(): ThinqApiClient {
	return asPartial<ThinqApiClient>({
		getFilterState: vi.fn(),
		sendCommand: vi.fn(),
	});
}

function createMockAirConditionerDevice(): ThinqAirConditionerDevice {
	return asPartial<ThinqAirConditionerDevice>({
		id: 'device-123',
		name: 'Living Room AC',
		type: 'AC',
		modelName: 'ModelXYZ',
		platformType: 'THINQ',
		online: true,
	});
}

function createMockEndpoint() {
	return asPartial({
		log: createMockLogger(),
		addCommandHandler: vi.fn(),
		updateAttribute: vi.fn(),
	});
}

describe('thinqAirConditionerFilterResetCommandHandler', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockApiClient: ThinqApiClient;
	let mockDevice: ThinqAirConditionerDevice;
	let mockEndpoint: ReturnType<typeof createMockEndpoint>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		mockApiClient = createMockApiClient();
		mockDevice = createMockAirConditionerDevice();
		mockEndpoint = createMockEndpoint();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('resolveFilterResetPayload', () => {
		it('should return exact payload for valid filterState with fixed date', () => {
			// Arrange
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			const filterState = ThinqFilterState.fromRaw(data);
			if (!filterState) throw new Error('filterState should be defined');
			const now = new Date('2026-09-23T00:00:00Z');

			// Act
			const result = resolveFilterResetPayload(filterState, now);

			// Assert
			expect(result).toEqual({
				'airState.filterMngState.useTime': 0,
				'airState.filterMngState.remainTime': 720,
				'airState.filterMngState.maxTime': 720,
				'airState.filterMngState.changeDate': 20260923,
			});
		});

		it('should have exactly 4 keys in the payload', () => {
			// Arrange
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			const filterState = ThinqFilterState.fromRaw(data);
			if (!filterState) throw new Error('filterState should be defined');
			const now = new Date('2026-09-23T00:00:00Z');

			// Act
			const result = resolveFilterResetPayload(filterState, now);

			// Assert
			expect(Object.keys(result)).toHaveLength(4);
			expect(Object.keys(result).sort()).toEqual([
				'airState.filterMngState.changeDate',
				'airState.filterMngState.maxTime',
				'airState.filterMngState.remainTime',
				'airState.filterMngState.useTime',
			]);
		});

		it('should format changeDate with zero-padding for single-digit month/day', () => {
			// Arrange
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			const filterState = ThinqFilterState.fromRaw(data);
			if (!filterState) throw new Error('filterState should be defined');
			const now = new Date('2026-01-05T00:00:00Z');

			// Act
			const result = resolveFilterResetPayload(filterState, now);

			// Assert
			expect(result['airState.filterMngState.changeDate']).toBe(20260105);
		});

		it('should use current date when now is omitted', () => {
			// Arrange
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};
			const filterState = ThinqFilterState.fromRaw(data);
			if (!filterState) throw new Error('filterState should be defined');

			// Act
			const result = resolveFilterResetPayload(filterState);

			// Assert
			expect(result['airState.filterMngState.changeDate']).toBeDefined();
			expect(result['airState.filterMngState.changeDate']).toBeGreaterThan(20000000);
			expect(result['airState.filterMngState.changeDate']).toBeLessThan(99999999);
		});

		it('should echo back ratedMaxTimeHours unchanged', () => {
			// Arrange
			const data = {
				'airState.filterMngStates.useTime': 100,
				'airState.filterMngStates.maxTime': 500,
			};
			const filterState = ThinqFilterState.fromRaw(data);
			if (!filterState) throw new Error('filterState should be defined');
			const now = new Date('2026-09-23T00:00:00Z');

			// Act
			const result = resolveFilterResetPayload(filterState, now);

			// Assert
			expect(result['airState.filterMngState.remainTime']).toBe(500);
			expect(result['airState.filterMngState.maxTime']).toBe(500);
		});

		it('should reset useTime to 0', () => {
			// Arrange
			const data = {
				'airState.filterMngStates.useTime': 500,
				'airState.filterMngStates.maxTime': 720,
			};
			const filterState = ThinqFilterState.fromRaw(data);
			if (!filterState) throw new Error('filterState should be defined');
			const now = new Date('2026-09-23T00:00:00Z');

			// Act
			const result = resolveFilterResetPayload(filterState, now);

			// Assert
			expect(result['airState.filterMngState.useTime']).toBe(0);
		});
	});

	describe('registerFilterResetCommandHandler', () => {
		describe('registration gating', () => {
			it('should not call addCommandHandler when supportsFilterMonitoring is false', () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: false };

				// Act
				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {});

				// Assert
				expect(vi.mocked(mockEndpoint.addCommandHandler)).not.toHaveBeenCalled();
			});

			it('should call addCommandHandler when supportsFilterMonitoring is true', () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };

				// Act
				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {});

				// Assert
				expect(vi.mocked(mockEndpoint.addCommandHandler)).toHaveBeenCalledExactlyOnceWith(
					'resetCondition',
					expect.any(Function),
				);
			});
		});

		describe('handler function when allowFilterReset is false', () => {
			it('should reject when allowFilterReset is false', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: false,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act & Assert
				await expect(handler()).rejects.toThrow(/disabled by configuration/);
			});

			it('should not call getFilterState when allowFilterReset is false', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: false,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				try {
					await handler();
				} catch {
					// Expected to reject
				}

				// Assert
				expect(vi.mocked(mockApiClient.getFilterState)).not.toHaveBeenCalled();
			});

			it('should not call sendCommand when allowFilterReset is false', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: false,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				try {
					await handler();
				} catch {
					// Expected to reject
				}

				// Assert
				expect(vi.mocked(mockApiClient.sendCommand)).not.toHaveBeenCalled();
			});
		});

		describe('handler function when getFilterState returns undefined', () => {
			it('should reject when getFilterState parses to undefined (missing maxTime)', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
					'airState.filterMngStates.useTime': 11,
				});

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act & Assert
				await expect(handler()).rejects.toThrow(/no current filter data available/);
			});

			it('should not call sendCommand when filter data is undefined', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue({
					'airState.filterMngStates.useTime': 11,
				});

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				try {
					await handler();
				} catch {
					// Expected to reject
				}

				// Assert
				expect(vi.mocked(mockApiClient.sendCommand)).not.toHaveBeenCalled();
			});
		});

		describe('handler function when getFilterState rejects', () => {
			it('should reject and propagate error when getFilterState throws', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const testError = new Error('Network error');
				vi.mocked(mockApiClient.getFilterState).mockRejectedValue(testError);

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act & Assert
				await expect(handler()).rejects.toBe(testError);
			});

			it('should not call sendCommand when getFilterState throws', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				vi.mocked(mockApiClient.getFilterState).mockRejectedValue(new Error('Network error'));

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				try {
					await handler();
				} catch {
					// Expected to reject
				}

				// Assert
				expect(vi.mocked(mockApiClient.sendCommand)).not.toHaveBeenCalled();
			});
		});

		describe('handler function on success path', () => {
			it('should call sendCommand with correct payload when filter data is valid', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const filterData = {
					'airState.filterMngStates.useTime': 11,
					'airState.filterMngStates.maxTime': 720,
				};
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);
				vi.mocked(mockApiClient.sendCommand).mockResolvedValue(undefined);

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				await handler();

				// Assert
				expect(vi.mocked(mockApiClient.sendCommand)).toHaveBeenCalledOnce();
				const sendCommandCall = vi.mocked(mockApiClient.sendCommand).mock.calls[0];
				expect(sendCommandCall[0]).toBe('device-123');
				expect(sendCommandCall[1]).toMatchObject({
					ctrlKey: 'filterMngStateCtrl',
					command: 'Set',
				});
				expect(sendCommandCall[1].dataSetList).toBeDefined();
			});

			it('should build dataSetList from resolveFilterResetPayload', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const filterData = {
					'airState.filterMngStates.useTime': 11,
					'airState.filterMngStates.maxTime': 720,
				};
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);
				vi.mocked(mockApiClient.sendCommand).mockResolvedValue(undefined);

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				await handler();

				// Assert
				const sendCommandCall = vi.mocked(mockApiClient.sendCommand).mock.calls[0];
				const dataSetList = sendCommandCall[1].dataSetList as Record<string, unknown>;
				expect(dataSetList['airState.filterMngState.useTime']).toBe(0);
				expect(dataSetList['airState.filterMngState.remainTime']).toBe(720);
				expect(dataSetList['airState.filterMngState.maxTime']).toBe(720);
				expect(dataSetList['airState.filterMngState.changeDate']).toBeDefined();
			});

			it('should resolve without throwing on success', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const filterData = {
					'airState.filterMngStates.useTime': 11,
					'airState.filterMngStates.maxTime': 720,
				};
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);
				vi.mocked(mockApiClient.sendCommand).mockResolvedValue(undefined);

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act & Assert
				await expect(handler()).resolves.toBeUndefined();
			});
		});

		describe('handler function when sendCommand rejects', () => {
			it('should reject and propagate error when sendCommand throws', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const filterData = {
					'airState.filterMngStates.useTime': 11,
					'airState.filterMngStates.maxTime': 720,
				};
				const testError = new Error('ThinQ API error');
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);
				vi.mocked(mockApiClient.sendCommand).mockRejectedValue(testError);

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act & Assert
				await expect(handler()).rejects.toBe(testError);
			});

			it('should never call updateAttribute on failure', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const filterData = {
					'airState.filterMngStates.useTime': 11,
					'airState.filterMngStates.maxTime': 720,
				};
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);
				vi.mocked(mockApiClient.sendCommand).mockRejectedValue(new Error('ThinQ API error'));

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				try {
					await handler();
				} catch {
					// Expected to reject
				}

				// Assert
				expect(vi.mocked(mockEndpoint.updateAttribute)).not.toHaveBeenCalled();
			});
		});

		describe('handler function should never call updateAttribute', () => {
			it('should never call updateAttribute even on success (SDK does it)', async () => {
				// Arrange
				const capabilities = { ...DEFAULT_AIR_CONDITIONER_CAPABILITIES, supportsFilterMonitoring: true };
				const filterData = {
					'airState.filterMngStates.useTime': 11,
					'airState.filterMngStates.maxTime': 720,
				};
				vi.mocked(mockApiClient.getFilterState).mockResolvedValue(filterData);
				vi.mocked(mockApiClient.sendCommand).mockResolvedValue(undefined);

				registerFilterResetCommandHandler(mockEndpoint as any, mockDevice, mockApiClient, mockLogger, capabilities, {
					allowFilterReset: true,
				});

				const handlerCall = vi.mocked(mockEndpoint.addCommandHandler).mock.calls[0];
				const handler = handlerCall[1] as () => Promise<void>;

				// Act
				await handler();

				// Assert
				expect(vi.mocked(mockEndpoint.updateAttribute)).not.toHaveBeenCalled();
			});
		});
	});
});
