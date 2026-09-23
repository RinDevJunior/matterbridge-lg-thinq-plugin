import { describe, expect, it } from 'vitest';

import { ThinqFilterState } from '../../../../core/domain/value-objects/ThinqFilterState.js';

describe('ThinqFilterState', () => {
	describe('fromRaw', () => {
		it('should create instance with valid data', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
				'airState.filterMngStates.changeDate': 20260919,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeDefined();
			expect(result?.remainingPercent).toBe(98);
		});

		it('should return undefined when useTime is missing', () => {
			const data = {
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeUndefined();
		});

		it('should return undefined when maxTime is missing', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeUndefined();
		});

		it('should return undefined when maxTime is zero', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 0,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeUndefined();
		});

		it('should return undefined when maxTime is negative', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': -100,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeUndefined();
		});

		it('should return undefined when data is undefined', () => {
			const result = ThinqFilterState.fromRaw(undefined);

			expect(result).toBeUndefined();
		});

		it('should return undefined when useTime is not a number', () => {
			const data = {
				'airState.filterMngStates.useTime': '11',
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeUndefined();
		});

		it('should return undefined when maxTime is not a number', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': '720',
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeUndefined();
		});

		it('should accept changeDate as optional', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result).toBeDefined();
			expect(result?.changeDate).toBeUndefined();
		});

		it('should store changeDate when present', () => {
			const data = {
				'airState.filterMngStates.useTime': 11,
				'airState.filterMngStates.maxTime': 720,
				'airState.filterMngStates.changeDate': 20260920,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result?.changeDate).toBe(20260920);
		});
	});

	describe('remainingPercent', () => {
		it('should calculate remaining percent correctly', () => {
			const data = {
				'airState.filterMngStates.useTime': 100,
				'airState.filterMngStates.maxTime': 500,
			};

			const result = ThinqFilterState.fromRaw(data);

			// (500 - 100) / 500 * 100 = 80%
			expect(result?.remainingPercent).toBe(80);
		});

		it('should return 100 when useTime is zero', () => {
			const data = {
				'airState.filterMngStates.useTime': 0,
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result?.remainingPercent).toBe(100);
		});

		it('should clamp to 0 when useTime exceeds maxTime', () => {
			const data = {
				'airState.filterMngStates.useTime': 800,
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			expect(result?.remainingPercent).toBe(0);
		});

		it('should round to nearest integer', () => {
			const data = {
				'airState.filterMngStates.useTime': 75,
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			// (720 - 75) / 720 * 100 = 89.583... rounds to 90
			expect(result?.remainingPercent).toBe(90);
		});

		it('should round down for .4 and below', () => {
			const data = {
				'airState.filterMngStates.useTime': 432,
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			// (720 - 432) / 720 * 100 = 40
			expect(result?.remainingPercent).toBe(40);
		});

		it('should handle very small remaining percentages', () => {
			const data = {
				'airState.filterMngStates.useTime': 715,
				'airState.filterMngStates.maxTime': 720,
			};

			const result = ThinqFilterState.fromRaw(data);

			// (720 - 715) / 720 * 100 = 0.694... rounds to 1
			expect(result?.remainingPercent).toBe(1);
		});
	});
});
