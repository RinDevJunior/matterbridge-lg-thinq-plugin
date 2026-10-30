import { describe, expect, it } from 'vitest';

import * as washerCommon from '../../../cli/commands/washerCommon.js';
import { parseResultCode } from '../../../cli/commands/washerControl.js';
import * as washerFields from '../../../platform/thinq/thinqWasherFields.js';

describe('thinqWasherFields', () => {
	describe('washerCommon re-exports', () => {
		it('should re-export the same readWasherFields function object', () => {
			// Arrange / Act / Assert
			expect(washerCommon.readWasherFields).toBe(washerFields.readWasherFields);
		});

		it('should re-export the same parseWasherField function object', () => {
			expect(washerCommon.parseWasherField).toBe(washerFields.parseWasherField);
		});

		it('should re-export the same changedWasherFieldKeys function object', () => {
			expect(washerCommon.changedWasherFieldKeys).toBe(washerFields.changedWasherFieldKeys);
		});

		it('should re-export the same describeThinqResultCode function object', () => {
			expect(washerCommon.describeThinqResultCode).toBe(washerFields.describeThinqResultCode);
		});

		it('should re-export the same describeSendFailure function object', () => {
			expect(washerCommon.describeSendFailure).toBe(washerFields.describeSendFailure);
		});
	});

	describe('washerControl re-exports', () => {
		it('should re-export the same parseResultCode function object', () => {
			expect(parseResultCode).toBe(washerFields.parseResultCode);
		});
	});

	describe('parseResultCode', () => {
		it('should return the top-level resultCode when present', () => {
			expect(washerFields.parseResultCode({ resultCode: '0000' })).toBe('0000');
		});

		it('should return the nested result.resultCode when the top level is absent', () => {
			expect(washerFields.parseResultCode({ result: { resultCode: '0111' } })).toBe('0111');
		});

		it('should return undefined when the reply is not a record', () => {
			expect(washerFields.parseResultCode('0000')).toBeUndefined();
			expect(washerFields.parseResultCode(null)).toBeUndefined();
		});

		it('should return undefined when no resultCode exists at either level', () => {
			expect(washerFields.parseResultCode({ result: { data: {} } })).toBeUndefined();
		});
	});
});
