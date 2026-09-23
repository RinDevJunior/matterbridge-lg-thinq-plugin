import { HepaFilterMonitoring, ResourceMonitoring } from 'matterbridge/matter/clusters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThinqFilterState } from '../../../core/domain/value-objects/ThinqFilterState.js';
import {
	applyThinqFilterStateToAirConditioner,
	resolveFilterChangeIndication,
} from '../../../platform/thinq/thinqAirConditionerFilterStateSync.js';
import { asPartial, createMockLogger } from '../../helpers/testUtils.js';

function createFilterState(filterData: Record<string, unknown>): ThinqFilterState {
	const state = ThinqFilterState.fromRaw(filterData);
	if (!state) {
		throw new Error('Failed to create ThinqFilterState from test data');
	}
	return state;
}

describe('resolveFilterChangeIndication', () => {
	it('should return Ok for remaining percent > 10', () => {
		expect(resolveFilterChangeIndication(100)).toBe(ResourceMonitoring.ChangeIndication.Ok);
		expect(resolveFilterChangeIndication(50)).toBe(ResourceMonitoring.ChangeIndication.Ok);
		expect(resolveFilterChangeIndication(11)).toBe(ResourceMonitoring.ChangeIndication.Ok);
	});

	it('should return Warning for remaining percent 1-10', () => {
		expect(resolveFilterChangeIndication(10)).toBe(ResourceMonitoring.ChangeIndication.Warning);
		expect(resolveFilterChangeIndication(5)).toBe(ResourceMonitoring.ChangeIndication.Warning);
		expect(resolveFilterChangeIndication(1)).toBe(ResourceMonitoring.ChangeIndication.Warning);
	});

	it('should return Critical for remaining percent <= 0', () => {
		expect(resolveFilterChangeIndication(0)).toBe(ResourceMonitoring.ChangeIndication.Critical);
	});
});

describe('applyThinqFilterStateToAirConditioner', () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let airConditioner: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLogger = createMockLogger();
		airConditioner = {
			id: 0x01,
			name: 'Living Room AC',
			log: mockLogger,
			updateAttribute: vi.fn().mockResolvedValue(false),
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should skip update when filterState is undefined', async () => {
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, undefined, mockLogger);

		expect(updateAttributeSpy).not.toHaveBeenCalled();
	});

	it('should log debug message when filterState is undefined', async () => {
		await applyThinqFilterStateToAirConditioner(airConditioner, undefined, mockLogger);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.stringContaining('no data, skipping HepaFilterMonitoring update'),
		);
	});

	it('should update condition and changeIndication when filterState is defined', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 11,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger);

		expect(updateAttributeSpy).toHaveBeenCalledTimes(2);
		expect(updateAttributeSpy).toHaveBeenCalledWith(HepaFilterMonitoring.id, 'condition', 98, mockLogger);
		expect(updateAttributeSpy).toHaveBeenCalledWith(
			HepaFilterMonitoring.id,
			'changeIndication',
			ResourceMonitoring.ChangeIndication.Ok,
			mockLogger,
		);
	});

	it('should set changeIndication to Ok when remaining percent > 10', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 50,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger);

		const changeIndicationCall = updateAttributeSpy.mock.calls.find(
			(call) => call[0] === HepaFilterMonitoring.id && call[1] === 'changeIndication',
		);
		expect(changeIndicationCall?.[2]).toBe(ResourceMonitoring.ChangeIndication.Ok);
	});

	it('should set changeIndication to Warning when remaining percent 1-10', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 648,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger);

		const changeIndicationCall = updateAttributeSpy.mock.calls.find(
			(call) => call[0] === HepaFilterMonitoring.id && call[1] === 'changeIndication',
		);
		expect(changeIndicationCall?.[2]).toBe(ResourceMonitoring.ChangeIndication.Warning);
	});

	it('should set changeIndication to Critical when remaining percent <= 0', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 720,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger);

		const changeIndicationCall = updateAttributeSpy.mock.calls.find(
			(call) => call[0] === HepaFilterMonitoring.id && call[1] === 'changeIndication',
		);
		expect(changeIndicationCall?.[2]).toBe(ResourceMonitoring.ChangeIndication.Critical);
	});

	it('should handle edge case with useTime > maxTime (clamped to 0)', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 800,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger);

		const conditionCall = updateAttributeSpy.mock.calls.find(
			(call) => call[0] === HepaFilterMonitoring.id && call[1] === 'condition',
		);
		expect(conditionCall?.[2]).toBe(0);

		const changeIndicationCall = updateAttributeSpy.mock.calls.find(
			(call) => call[0] === HepaFilterMonitoring.id && call[1] === 'changeIndication',
		);
		expect(changeIndicationCall?.[2]).toBe(ResourceMonitoring.ChangeIndication.Critical);
	});

	it('should use correct cluster and attribute IDs', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 11,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const updateAttributeSpy = vi.spyOn(airConditioner, 'updateAttribute').mockResolvedValue(false);

		await applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger);

		// Verify the cluster ID (113 = 0x71 for HepaFilterMonitoring)
		expect(updateAttributeSpy).toHaveBeenCalledWith(
			expect.any(Number),
			expect.any(String),
			expect.any(Number),
			mockLogger,
		);
		const calls = updateAttributeSpy.mock.calls;
		expect(calls[0][0]).toBe(HepaFilterMonitoring.id);
		expect(calls[1][0]).toBe(HepaFilterMonitoring.id);
	});

	it('should propagate updateAttribute errors', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 11,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);
		const error = new Error('Update failed');
		vi.spyOn(airConditioner, 'updateAttribute').mockRejectedValue(error);

		await expect(applyThinqFilterStateToAirConditioner(airConditioner, filterState, mockLogger)).rejects.toThrow(
			'Update failed',
		);
	});

	it('should work with minimal endpoint mock (matching test pattern)', async () => {
		const filterData = {
			'airState.filterMngStates.useTime': 11,
			'airState.filterMngStates.maxTime': 720,
		};
		const filterState = createFilterState(filterData);

		const minimalEndpoint: any = {
			updateAttribute: vi.fn().mockResolvedValue(false),
		};

		await applyThinqFilterStateToAirConditioner(minimalEndpoint, filterState, mockLogger);

		expect(minimalEndpoint.updateAttribute).toHaveBeenCalledTimes(2);
	});
});
