import { describe, expect, it } from 'vitest';

import { resolveThinqGeneration } from '../../platform/thinqGeneration.js';

describe('resolveThinqGeneration', () => {
	it('should return v2 when the login type is pat', () => {
		// Arrange
		const loginType = 'pat';

		// Act
		const generation = resolveThinqGeneration(loginType);

		// Assert
		expect(generation).toBe('v2');
	});

	it('should return v1 when the login type is account', () => {
		// Arrange
		const loginType = 'account';

		// Act
		const generation = resolveThinqGeneration(loginType);

		// Assert
		expect(generation).toBe('v1');
	});

	it('should return v1 when the login type is token', () => {
		// Arrange
		const loginType = 'token';

		// Act
		const generation = resolveThinqGeneration(loginType);

		// Assert
		expect(generation).toBe('v1');
	});
});
