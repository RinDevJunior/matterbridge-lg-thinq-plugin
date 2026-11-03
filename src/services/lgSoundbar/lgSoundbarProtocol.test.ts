import { createDecipheriv } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeLgSoundbarFrame, LgSoundbarFrameParser, type LgSoundbarLogger } from './lgSoundbarProtocol.js';

const LG_SOUNDBAR_KEY = Buffer.from('T^&*J%^7tr~4^%^&I(o%^!jIJ__+a0 k', 'utf8');
const LG_SOUNDBAR_IV = Buffer.from("'%^Ur7gy$~t+f)%@", 'utf8');

function decryptFrame(frame: Buffer): unknown {
	const bodyLength = frame.readUInt32BE(1);
	const body = frame.subarray(5, 5 + bodyLength);
	const decipher = createDecipheriv('aes-256-cbc', LG_SOUNDBAR_KEY, LG_SOUNDBAR_IV);
	const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
	return JSON.parse(plain);
}

function createMockSoundbarLogger(): LgSoundbarLogger {
	return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function buildLargePayload(): Record<string, unknown> {
	const data: Record<string, string> = {};
	for (let i = 0; i < 30; i++) {
		data[`field_${i}`] = `value_${i}_padding_to_make_this_payload_exceed_two_hundred_fifty_five_bytes`;
	}
	return { cmd: 'get', msg: 'SPK_LIST_VIEW_INFO', data };
}

describe('encodeLgSoundbarFrame', () => {
	it('should write a 4-byte big-endian ciphertext length, not a 1-byte length, when the ciphertext exceeds 255 bytes', () => {
		// Arrange
		const payload = buildLargePayload();

		// Act
		const frame = encodeLgSoundbarFrame(payload);

		// Assert
		expect(frame[0]).toBe(0x10);
		const declaredLength = frame.readUInt32BE(1);
		expect(declaredLength).toBeGreaterThan(255);
		expect(frame.length).toBe(5 + declaredLength);
	});

	it('should produce a header whose byte 0 is the 0x10 flag', () => {
		// Arrange
		const payload = { cmd: 'get', msg: 'SPK_LIST_VIEW_INFO' };

		// Act
		const frame = encodeLgSoundbarFrame(payload);

		// Assert
		expect(frame[0]).toBe(0x10);
	});

	it('should round-trip through manual AES-256-CBC decryption back to the original payload', () => {
		// Arrange
		const payload = { cmd: 'set', data: { b_powerkey: true }, msg: 'SPK_LIST_VIEW_INFO' };

		// Act
		const frame = encodeLgSoundbarFrame(payload);
		const decoded = decryptFrame(frame);

		// Assert
		expect(decoded).toEqual(payload);
	});
});

describe('LgSoundbarFrameParser', () => {
	let logger: LgSoundbarLogger;
	let parser: LgSoundbarFrameParser;

	beforeEach(() => {
		vi.clearAllMocks();
		logger = createMockSoundbarLogger();
		parser = new LgSoundbarFrameParser(logger);
	});

	it('should return one parsed message when a single chunk contains exactly one complete frame', () => {
		// Arrange
		const payload = { cmd: 'get', msg: 'SPK_LIST_VIEW_INFO' };
		const frame = encodeLgSoundbarFrame(payload);

		// Act
		const messages = parser.push(frame);

		// Assert
		expect(messages).toEqual([payload]);
	});

	it('should yield no message until the frame completes when a chunk is split across multiple push calls', () => {
		// Arrange
		const payload = { cmd: 'get', msg: 'SPK_LIST_VIEW_INFO', data: { x: 1 } };
		const frame = encodeLgSoundbarFrame(payload);
		const partialHeader = frame.subarray(0, 3);
		const restOfHeaderPlusPartialBody = frame.subarray(3, 7);
		const restOfBody = frame.subarray(7);

		// Act
		const firstResult = parser.push(partialHeader);
		const secondResult = parser.push(restOfHeaderPlusPartialBody);
		const thirdResult = parser.push(restOfBody);

		// Assert
		expect(firstResult).toEqual([]);
		expect(secondResult).toEqual([]);
		expect(thirdResult).toEqual([payload]);
	});

	it('should return both messages in order from one push call when two complete frames arrive back-to-back', () => {
		// Arrange
		const payload1 = { cmd: 'get', msg: 'SPK_LIST_VIEW_INFO', seq: 1 };
		const payload2 = { cmd: 'get', msg: 'SPK_LIST_VIEW_INFO', seq: 2 };
		const combined = Buffer.concat([encodeLgSoundbarFrame(payload1), encodeLgSoundbarFrame(payload2)]);

		// Act
		const messages = parser.push(combined);

		// Assert
		expect(messages).toEqual([payload1, payload2]);
	});

	it('should drop a frame with corrupted ciphertext and warn instead of throwing', () => {
		// Arrange
		const frame = encodeLgSoundbarFrame({ cmd: 'get', msg: 'SPK_LIST_VIEW_INFO' });
		const header = frame.subarray(0, 5);
		const corruptedBody = Buffer.alloc(frame.length - 5, 0xff);
		const corrupted = Buffer.concat([header, corruptedBody]);

		// Act
		const messages = parser.push(corrupted);

		// Assert
		expect(messages).toEqual([]);
		expect(logger.warn).toHaveBeenCalled();
	});
});
