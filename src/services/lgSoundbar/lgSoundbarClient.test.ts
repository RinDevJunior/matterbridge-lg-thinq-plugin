import { createDecipheriv } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LgSoundbarError } from '../../errors/LgSoundbarError.js';
import { LgSoundbarClient } from './lgSoundbarClient.js';
import { encodeLgSoundbarFrame, type LgSoundbarLogger } from './lgSoundbarProtocol.js';

const LG_SOUNDBAR_KEY = Buffer.from('T^&*J%^7tr~4^%^&I(o%^!jIJ__+a0 k', 'utf8');
const LG_SOUNDBAR_IV = Buffer.from("'%^Ur7gy$~t+f)%@", 'utf8');

function decryptWrittenFrame(frame: Buffer): unknown {
	const bodyLength = frame.readUInt32BE(1);
	const body = frame.subarray(5, 5 + bodyLength);
	const decipher = createDecipheriv('aes-256-cbc', LG_SOUNDBAR_KEY, LG_SOUNDBAR_IV);
	const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
	return JSON.parse(plain);
}

type Listener = (...args: unknown[]) => void;

const socketHarness = vi.hoisted(() => {
	class MockSocket {
		public writes: Buffer[] = [];
		public destroyed = false;
		public connectCalls: { port: number; host: string }[] = [];
		private readonly listeners = new Map<string, Listener[]>();
		private readonly onceListeners = new Map<string, Listener[]>();

		public on(event: string, cb: Listener): this {
			const existing = this.listeners.get(event) ?? [];
			existing.push(cb);
			this.listeners.set(event, existing);
			return this;
		}

		public once(event: string, cb: Listener): this {
			const existing = this.onceListeners.get(event) ?? [];
			existing.push(cb);
			this.onceListeners.set(event, existing);
			return this;
		}

		public emit(event: string, ...args: unknown[]): void {
			for (const cb of this.listeners.get(event) ?? []) cb(...args);
			const once = this.onceListeners.get(event) ?? [];
			this.onceListeners.set(event, []);
			for (const cb of once) cb(...args);
		}

		public write(data: Buffer): boolean {
			this.writes.push(Buffer.from(data));
			return true;
		}

		public connect(port: number, host: string, cb: () => void): this {
			this.connectCalls.push({ port, host });
			queueMicrotask(cb);
			return this;
		}

		public destroy(): void {
			this.destroyed = true;
		}

		public end(): void {
			this.destroyed = true;
		}
	}

	return { MockSocket, sockets: [] as InstanceType<typeof MockSocket>[] };
});

vi.mock('node:net', () => ({
	Socket: vi.fn(function () {
		const socket = new socketHarness.MockSocket();
		socketHarness.sockets.push(socket);
		return socket;
	}),
}));

function currentSocket(): InstanceType<typeof socketHarness.MockSocket> {
	const socket = socketHarness.sockets[socketHarness.sockets.length - 1];
	if (!socket) {
		throw new Error('no socket created yet');
	}
	return socket;
}

function createMockSoundbarLogger(): LgSoundbarLogger {
	return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function replyFrame(data: Record<string, unknown>, msg = 'SPK_LIST_VIEW_INFO'): Buffer {
	return encodeLgSoundbarFrame({ msg, data });
}

describe('LgSoundbarClient', () => {
	let logger: LgSoundbarLogger;

	beforeEach(() => {
		vi.clearAllMocks();
		socketHarness.sockets.length = 0;
		logger = createMockSoundbarLogger();
	});

	describe('getState', () => {
		it('should resolve with the mapped LgSoundbarState when the socket replies', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			const promise = client.getState();
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(1));
			currentSocket().emit('data', replyFrame({ b_powerstatus: true, i_vol: 20, i_vol_min: 0, i_vol_max: 40 }));
			const state = await promise;

			// Assert
			expect(state).toEqual({ powerOn: true, volume: 20, volumeMin: 0, volumeMax: 40 });
		});

		it('should reject with LgSoundbarError, not an unhandled exception, when the socket errors', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			const promise = client.getState();
			await vi.waitFor(() => expect(socketHarness.sockets.length).toBeGreaterThan(0));
			currentSocket().emit('error', new Error('ECONNREFUSED'));

			// Assert
			await expect(promise).rejects.toBeInstanceOf(LgSoundbarError);
		});
	});

	describe('setPower', () => {
		it('should send a frame whose decrypted JSON sets b_powerkey true for setPower(true)', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			await client.setPower(true);

			// Assert
			expect(decryptWrittenFrame(currentSocket().writes[0])).toEqual({
				cmd: 'set',
				data: { b_powerkey: true },
				msg: 'SPK_LIST_VIEW_INFO',
			});
		});

		it('should send a frame whose decrypted JSON sets b_powerkey false for setPower(false)', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			await client.setPower(false);

			// Assert
			expect(decryptWrittenFrame(currentSocket().writes[0])).toEqual({
				cmd: 'set',
				data: { b_powerkey: false },
				msg: 'SPK_LIST_VIEW_INFO',
			});
		});
	});

	describe('setVolume', () => {
		it('should send a frame whose decrypted JSON sets i_vol to the requested value', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			await client.setVolume(12);

			// Assert
			expect(decryptWrittenFrame(currentSocket().writes[0])).toEqual({
				cmd: 'set',
				data: { i_vol: 12 },
				msg: 'SPK_LIST_VIEW_INFO',
			});
		});
	});

	describe('getSoundMode', () => {
		it('should resolve with i_curr_eq when the socket replies with EQ_VIEW_INFO', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			const promise = client.getSoundMode();
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(1));
			currentSocket().emit('data', replyFrame({ i_curr_eq: 3 }, 'EQ_VIEW_INFO'));
			const soundMode = await promise;

			// Assert
			expect(soundMode).toBe(3);
		});

		it('should resolve undefined when the reply has no numeric i_curr_eq', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			const promise = client.getSoundMode();
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(1));
			currentSocket().emit('data', replyFrame({ i_curr_eq: 'not-a-number' }, 'EQ_VIEW_INFO'));
			const soundMode = await promise;

			// Assert
			expect(soundMode).toBeUndefined();
		});
	});

	describe('setSoundMode', () => {
		it('should send a frame whose decrypted JSON sets i_curr_eq to the requested value', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			await client.setSoundMode(5);

			// Assert
			expect(decryptWrittenFrame(currentSocket().writes[0])).toEqual({
				cmd: 'set',
				data: { i_curr_eq: 5 },
				msg: 'EQ_VIEW_INFO',
			});
		});
	});

	describe('message-category-aware reply matching', () => {
		it('should not settle a pending getSoundMode() from a stale SPK_LIST_VIEW_INFO frame, and resolve once EQ_VIEW_INFO arrives', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);
			const promise = client.getSoundMode();
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(1));
			let settled = false;
			promise.then(
				() => (settled = true),
				() => (settled = true),
			);

			// Act
			currentSocket().emit(
				'data',
				replyFrame({ b_powerstatus: true, i_vol: 1, i_vol_min: 0, i_vol_max: 10 }, 'SPK_LIST_VIEW_INFO'),
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Assert
			expect(settled).toBe(false);

			// Act
			currentSocket().emit('data', replyFrame({ i_curr_eq: 7 }, 'EQ_VIEW_INFO'));

			// Assert
			await expect(promise).resolves.toBe(7);
		});
	});

	describe('FIFO single-in-flight guard', () => {
		it('should only send the second request after the first reply arrives', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);

			// Act
			const first = client.getState();
			const second = client.getState();
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(1));

			// Assert
			expect(currentSocket().writes.length).toBe(1);

			// Act
			currentSocket().emit('data', replyFrame({ b_powerstatus: true, i_vol: 1, i_vol_min: 0, i_vol_max: 10 }));
			await first;
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(2));
			currentSocket().emit('data', replyFrame({ b_powerstatus: false, i_vol: 2, i_vol_min: 0, i_vol_max: 10 }));

			// Assert
			await expect(second).resolves.toEqual({ powerOn: false, volume: 2, volumeMin: 0, volumeMax: 10 });
		});
	});

	describe('send timeout', () => {
		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should reject with LgSoundbarError when no reply arrives in time, and still work for a later call', async () => {
			// Arrange
			vi.useFakeTimers();
			const client = new LgSoundbarClient({ host: '10.0.0.5', sendTimeoutMs: 1000 }, logger);

			// Act
			const timedOut = client.getState();
			const timedOutAssertion = expect(timedOut).rejects.toBeInstanceOf(LgSoundbarError);
			await vi.advanceTimersByTimeAsync(1000);

			// Assert
			await timedOutAssertion;

			// Act
			const socketCountBefore = socketHarness.sockets.length;
			const recovered = client.getState();
			for (let i = 0; i < 20 && socketHarness.sockets.length <= socketCountBefore; i++) {
				await vi.advanceTimersByTimeAsync(1);
			}
			currentSocket().emit('data', replyFrame({ b_powerstatus: true, i_vol: 5, i_vol_min: 0, i_vol_max: 10 }));

			// Assert
			await expect(recovered).resolves.toEqual({ powerOn: true, volume: 5, volumeMin: 0, volumeMax: 10 });
		});
	});

	describe('idle auto-disconnect', () => {
		afterEach(() => {
			vi.clearAllTimers();
			vi.useRealTimers();
		});

		it('should destroy the idle socket after idleDisconnectMs and reconnect on the next send', async () => {
			// Arrange
			vi.useFakeTimers();
			const client = new LgSoundbarClient({ host: '10.0.0.5', idleDisconnectMs: 1000 }, logger);
			await client.setPower(true);
			const firstSocket = currentSocket();
			expect(firstSocket.destroyed).toBe(false);

			// Act
			await vi.advanceTimersByTimeAsync(1000);

			// Assert
			expect(firstSocket.destroyed).toBe(true);

			// Act
			await client.setPower(false);

			// Assert
			expect(currentSocket()).not.toBe(firstSocket);
		});
	});

	describe('garbled inbound frame', () => {
		it('should not settle the in-flight request until a valid frame arrives', async () => {
			// Arrange
			const client = new LgSoundbarClient({ host: '10.0.0.5' }, logger);
			const promise = client.getState();
			await vi.waitFor(() => expect(currentSocket().writes.length).toBe(1));
			let settled = false;
			promise.then(
				() => (settled = true),
				() => (settled = true),
			);

			// Act
			const garbled = Buffer.concat([Buffer.from([0x10, 0, 0, 0, 16]), Buffer.alloc(16, 0xff)]);
			currentSocket().emit('data', garbled);
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Assert
			expect(settled).toBe(false);

			// Act
			currentSocket().emit('data', replyFrame({ b_powerstatus: true, i_vol: 1, i_vol_min: 0, i_vol_max: 10 }));

			// Assert
			await expect(promise).resolves.toEqual({ powerOn: true, volume: 1, volumeMin: 0, volumeMax: 10 });
			expect(logger.warn).toHaveBeenCalled();
		});
	});
});
