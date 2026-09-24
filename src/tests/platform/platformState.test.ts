import { describe, expect, it } from 'vitest';

import { PlatformState } from '../../platform/platformState.js';

describe('PlatformState', () => {
	describe('isStartupCompleted getter', () => {
		it('should return false initially', () => {
			const state = new PlatformState();
			expect(state.isStartupCompleted).toBe(false);
		});
	});

	describe('setStartupCompleted', () => {
		it('should set startup completed to true', () => {
			const state = new PlatformState();
			state.setStartupCompleted(true);
			expect(state.isStartupCompleted).toBe(true);
		});

		it('should flip from true to false', () => {
			const state = new PlatformState();
			state.setStartupCompleted(true);
			expect(state.isStartupCompleted).toBe(true);

			state.setStartupCompleted(false);
			expect(state.isStartupCompleted).toBe(false);
		});

		it('should allow multiple state changes', () => {
			const state = new PlatformState();
			state.setStartupCompleted(true);
			expect(state.isStartupCompleted).toBe(true);

			state.setStartupCompleted(false);
			expect(state.isStartupCompleted).toBe(false);

			state.setStartupCompleted(true);
			expect(state.isStartupCompleted).toBe(true);
		});
	});
});
