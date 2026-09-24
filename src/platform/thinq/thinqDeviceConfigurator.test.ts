import { FanControl } from 'matterbridge/matter/clusters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapWindStrengthToFanMode, mapWindStrengthToFixedFanMode } from './thinqDeviceConfigurator.js';

describe('thinqDeviceConfigurator', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('mapWindStrengthToFanMode', () => {
		it('should map undefined to Auto mode', () => {
			const mode = mapWindStrengthToFanMode(undefined);
			expect(mode).toBe(FanControl.FanMode.Auto);
		});

		it('should map windStrength 8 (AUTO) to Auto mode', () => {
			const mode = mapWindStrengthToFanMode(8);
			expect(mode).toBe(FanControl.FanMode.Auto);
		});

		it('should map windStrength <= 2 to Low mode', () => {
			expect(mapWindStrengthToFanMode(0)).toBe(FanControl.FanMode.Low);
			expect(mapWindStrengthToFanMode(1)).toBe(FanControl.FanMode.Low);
			expect(mapWindStrengthToFanMode(2)).toBe(FanControl.FanMode.Low);
		});

		it('should map windStrength > 2 and <= 4 to Medium mode', () => {
			expect(mapWindStrengthToFanMode(3)).toBe(FanControl.FanMode.Medium);
			expect(mapWindStrengthToFanMode(4)).toBe(FanControl.FanMode.Medium);
		});

		it('should map windStrength > 4 to High mode', () => {
			expect(mapWindStrengthToFanMode(5)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFanMode(6)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFanMode(7)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFanMode(9)).toBe(FanControl.FanMode.High);
		});

		it('should handle edge case windStrength = 2.5', () => {
			const mode = mapWindStrengthToFanMode(2.5);
			expect(mode).toBe(FanControl.FanMode.Medium);
		});

		it('should handle edge case windStrength = 4.1', () => {
			const mode = mapWindStrengthToFanMode(4.1);
			expect(mode).toBe(FanControl.FanMode.High);
		});

		it('should handle very high windStrength values', () => {
			const mode = mapWindStrengthToFanMode(100);
			expect(mode).toBe(FanControl.FanMode.High);
		});

		it('should handle negative windStrength', () => {
			const mode = mapWindStrengthToFanMode(-1);
			expect(mode).toBe(FanControl.FanMode.Low);
		});
	});

	describe('mapWindStrengthToFixedFanMode', () => {
		it('should map undefined to Off mode', () => {
			const mode = mapWindStrengthToFixedFanMode(undefined);
			expect(mode).toBe(FanControl.FanMode.Off);
		});

		it('should map any defined windStrength to High mode', () => {
			expect(mapWindStrengthToFixedFanMode(0)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFixedFanMode(1)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFixedFanMode(2)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFixedFanMode(5)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFixedFanMode(8)).toBe(FanControl.FanMode.High);
			expect(mapWindStrengthToFixedFanMode(100)).toBe(FanControl.FanMode.High);
		});

		it('should map negative windStrength to High mode', () => {
			const mode = mapWindStrengthToFixedFanMode(-1);
			expect(mode).toBe(FanControl.FanMode.High);
		});

		it('should map zero windStrength to High mode', () => {
			const mode = mapWindStrengthToFixedFanMode(0);
			expect(mode).toBe(FanControl.FanMode.High);
		});
	});
});
