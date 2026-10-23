import { describe, expect, it } from 'vitest';

import type { ThinqWasherControlConfig } from '../../../model/LgThinqPluginPlatformConfig.js';
import { isWasherVtSupported, resolveWasherVtStagePlan } from '../../../platform/thinq/thinqWasherVtStagePlan.js';
import { createFakeWasherModel } from '../../helpers/washerFixtures.js';

/** Model with the vtCtrl entry removed or altered, keeping every other key of the fixture. */
function modelWithControlWifi(controlWifi: Record<string, unknown>): Record<string, unknown> {
	return { ...createFakeWasherModel(), ControlWifi: controlWifi };
}

function washerControlFor(
	selectedCourse: string | undefined,
	parameters?: Record<string, string>,
	courseId = selectedCourse,
): ThinqWasherControlConfig {
	return {
		selectedCourse,
		courses: courseId === undefined ? [] : [{ id: courseId, parameters: parameters ?? {} }],
	};
}

describe('thinqWasherVtStagePlan', () => {
	describe('isWasherVtSupported', () => {
		it('should return true for the fixture model (uniProtocol true and vtCtrl Set)', () => {
			// Arrange / Act / Assert
			expect(isWasherVtSupported(createFakeWasherModel())).toBe(true);
		});

		it('should return false when uniProtocol is false', () => {
			// Arrange
			const model = { ...createFakeWasherModel(), Config: { defaultCourse: 'NORMAL', uniProtocol: false } };
			// Act / Assert
			expect(isWasherVtSupported(model)).toBe(false);
		});

		it('should return false when the vtCtrl entry is missing', () => {
			// Arrange
			const model = modelWithControlWifi({ WMDownload: { command: 'Set', data: {} } });
			// Act / Assert
			expect(isWasherVtSupported(model)).toBe(false);
		});

		it('should return false when vtCtrl.command is not Set', () => {
			// Arrange
			const model = modelWithControlWifi({ vtCtrl: { command: 'Get', data: {} } });
			// Act / Assert
			expect(isWasherVtSupported(model)).toBe(false);
		});

		it('should return false when the Config block is missing', () => {
			// Arrange
			const { Config: _config, ...withoutConfig } = createFakeWasherModel();
			// Act / Assert
			expect(isWasherVtSupported(withoutConfig)).toBe(false);
		});
	});

	describe('resolveWasherVtStagePlan', () => {
		it('should stage the course with no options when no parameters are configured', () => {
			// Arrange
			const washerControl = washerControlFor('NORMAL');
			// Act
			const plan = resolveWasherVtStagePlan(createFakeWasherModel(), washerControl);
			// Assert
			expect(plan).toEqual({ courseId: 'NORMAL', options: {}, ignoredOptions: [] });
		});

		it('should send no option cell when every configured parameter equals the course default', () => {
			// Arrange
			const washerControl = washerControlFor('NORMAL', { spin: 'SPIN_1400', temp: 'TEMP_40' });
			// Act
			const plan = resolveWasherVtStagePlan(createFakeWasherModel(), washerControl);
			// Assert
			expect(plan?.options).toEqual({});
		});

		it('should keep a configured option that differs from the default and is listed', () => {
			// Arrange
			const washerControl = washerControlFor('NORMAL', { spin: 'SPIN_1000' });
			// Act
			const plan = resolveWasherVtStagePlan(createFakeWasherModel(), washerControl);
			// Assert
			expect(plan).toEqual({ courseId: 'NORMAL', options: { spin: 'SPIN_1000' }, ignoredOptions: [] });
		});

		it('should drop an option value that the course does not list and report it as ignored', () => {
			// Arrange
			const washerControl = washerControlFor('NORMAL', { spin: 'SPIN_9999' });
			// Act
			const plan = resolveWasherVtStagePlan(createFakeWasherModel(), washerControl);
			// Assert
			expect(plan).toEqual({ courseId: 'NORMAL', options: {}, ignoredOptions: ['spin=SPIN_9999'] });
		});

		it('should ignore a non-option key such as reserveTimeMinute without reporting it', () => {
			// Arrange
			const washerControl = washerControlFor('NORMAL', { reserveTimeMinute: '30' });
			// Act
			const plan = resolveWasherVtStagePlan(createFakeWasherModel(), washerControl);
			// Assert
			expect(plan).toEqual({ courseId: 'NORMAL', options: {}, ignoredOptions: [] });
		});

		it('should drop an option the selected course does not offer at all', () => {
			// Arrange: COTTON only lists SPIN_1400 for spin
			const washerControl = washerControlFor('COTTON', { spin: 'SPIN_1000' });
			// Act
			const plan = resolveWasherVtStagePlan(createFakeWasherModel(), washerControl);
			// Assert
			expect(plan).toEqual({ courseId: 'COTTON', options: {}, ignoredOptions: ['spin=SPIN_1000'] });
		});

		it('should return undefined when selectedCourse is unset, even though Config.defaultCourse exists', () => {
			// Arrange
			const washerControl = washerControlFor(undefined);
			// Act / Assert
			expect(resolveWasherVtStagePlan(createFakeWasherModel(), washerControl)).toBeUndefined();
		});

		it('should return undefined when selectedCourse is unknown to the model', () => {
			// Arrange
			const washerControl = washerControlFor('NOPE');
			// Act / Assert
			expect(resolveWasherVtStagePlan(createFakeWasherModel(), washerControl)).toBeUndefined();
		});
	});
});
