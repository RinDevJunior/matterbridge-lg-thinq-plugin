import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LgSoundbarDeviceConfig } from '../../model/LgThinqPluginPlatformConfig.js';
import { discoverLgSoundbars, resolveLgSoundbarDeviceConfigs } from './lgSoundbarDiscovery.js';
import type { LgSoundbarLogger } from './lgSoundbarProtocol.js';

const CAST_SERVICE_NAME = '_googlecast._tcp.local';

type Listener = (...args: unknown[]) => void;

const dgramHarness = vi.hoisted(() => {
	class MockUdpSocket {
		public sendCalls: { buf: Buffer; offset: number; len: number; port: number; addr: string }[] = [];
		public closed = false;
		private readonly listeners = new Map<string, Listener[]>();

		public on(event: string, cb: Listener): this {
			const existing = this.listeners.get(event) ?? [];
			existing.push(cb);
			this.listeners.set(event, existing);
			return this;
		}

		public emit(event: string, ...args: unknown[]): void {
			for (const cb of this.listeners.get(event) ?? []) cb(...args);
		}

		public bind(_port: number, cb: () => void): void {
			queueMicrotask(cb);
		}

		public addMembership(_addr: string): void {
			// no-op
		}

		public setMulticastTTL(_ttl: number): void {
			// no-op
		}

		public send(
			buf: Buffer,
			offset: number,
			len: number,
			port: number,
			addr: string,
			cb?: (error: Error | null) => void,
		): void {
			this.sendCalls.push({ buf, offset, len, port, addr });
			if (cb) {
				queueMicrotask(() => cb(null));
			}
		}

		public close(): void {
			this.closed = true;
		}
	}

	return { MockUdpSocket, sockets: [] as InstanceType<typeof MockUdpSocket>[] };
});

vi.mock('node:dgram', () => ({
	createSocket: vi.fn(() => {
		const socket = new dgramHarness.MockUdpSocket();
		dgramHarness.sockets.push(socket);
		return socket;
	}),
}));

const netHarness = vi.hoisted(() => {
	class MockTcpSocket {
		public connectCalls: { port: number; host: string }[] = [];
		public destroyed = false;
		public timeoutMs: number | undefined;
		private readonly onceListeners = new Map<string, Listener[]>();

		public setTimeout(ms: number): this {
			this.timeoutMs = ms;
			return this;
		}

		public once(event: string, cb: Listener): this {
			const existing = this.onceListeners.get(event) ?? [];
			existing.push(cb);
			this.onceListeners.set(event, existing);
			return this;
		}

		public emit(event: string, ...args: unknown[]): void {
			const callbacks = this.onceListeners.get(event) ?? [];
			this.onceListeners.set(event, []);
			for (const cb of callbacks) cb(...args);
		}

		public connect(port: number, host: string): this {
			this.connectCalls.push({ port, host });
			return this;
		}

		public destroy(): void {
			this.destroyed = true;
		}
	}

	return { MockTcpSocket, sockets: [] as InstanceType<typeof MockTcpSocket>[] };
});

vi.mock('node:net', () => ({
	Socket: vi.fn(function () {
		const socket = new netHarness.MockTcpSocket();
		netHarness.sockets.push(socket);
		return socket;
	}),
}));

function createMockSoundbarLogger(): LgSoundbarLogger {
	return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function encodeDnsNameSimple(name: string): Buffer {
	const buffers: Buffer[] = [];
	for (const label of name.split('.')) {
		const labelBuf = Buffer.from(label, 'utf8');
		buffers.push(Buffer.from([labelBuf.length]), labelBuf);
	}
	buffers.push(Buffer.from([0]));
	return Buffer.concat(buffers);
}

/** Builds a minimal valid mDNS response buffer with one PTR answer whose owner name is `ownerName`. */
function buildMdnsResponse(ownerName: string): Buffer {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(0, 0); // id
	header.writeUInt16BE(0x8400, 2); // flags: QR + AA
	header.writeUInt16BE(0, 4); // qdCount
	header.writeUInt16BE(1, 6); // anCount
	header.writeUInt16BE(0, 8); // nsCount
	header.writeUInt16BE(0, 10); // arCount

	const name = encodeDnsNameSimple(ownerName);
	const typeClassTtl = Buffer.alloc(8);
	typeClassTtl.writeUInt16BE(12, 0); // TYPE PTR
	typeClassTtl.writeUInt16BE(1, 2); // CLASS IN
	typeClassTtl.writeUInt32BE(120, 4); // TTL
	const rdlength = Buffer.alloc(2);
	rdlength.writeUInt16BE(1, 0);
	const rdata = Buffer.from([0x00]);

	return Buffer.concat([header, name, typeClassTtl, rdlength, rdata]);
}

async function flushMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

describe('lgSoundbarDiscovery', () => {
	let logger: LgSoundbarLogger;

	beforeEach(() => {
		vi.clearAllMocks();
		dgramHarness.sockets.length = 0;
		netHarness.sockets.length = 0;
		logger = createMockSoundbarLogger();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe('discoverLgSoundbars', () => {
		it('should return no candidates when no mDNS response arrives before the timeout', async () => {
			// Arrange
			vi.useFakeTimers();

			// Act
			const promise = discoverLgSoundbars(logger, { mdnsTimeoutMs: 1000, probeTimeoutMs: 500 });
			await vi.advanceTimersByTimeAsync(1000);
			const result = await promise;

			// Assert
			expect(result).toEqual([]);
		});

		it('should return no candidates when an mDNS response arrives but does not answer the cast service question', async () => {
			// Arrange
			vi.useFakeTimers();
			const promise = discoverLgSoundbars(logger, { mdnsTimeoutMs: 1000, probeTimeoutMs: 500 });
			const socket = dgramHarness.sockets[0];

			// Act
			socket.emit('message', buildMdnsResponse('_http._tcp.local'), { address: '10.0.0.9' });
			await vi.advanceTimersByTimeAsync(1000);
			const result = await promise;

			// Assert
			expect(result).toEqual([]);
			expect(netHarness.sockets).toHaveLength(0);
		});

		it('should TCP-probe every unique responder IP and return only the ones that accept the connection', async () => {
			// Arrange
			vi.useFakeTimers();
			const promise = discoverLgSoundbars(logger, { mdnsTimeoutMs: 1000, probeTimeoutMs: 500 });
			const socket = dgramHarness.sockets[0];
			socket.emit('message', buildMdnsResponse(CAST_SERVICE_NAME), { address: '10.0.0.10' });
			socket.emit('message', buildMdnsResponse(CAST_SERVICE_NAME), { address: '10.0.0.11' });

			// Act
			await vi.advanceTimersByTimeAsync(1000);
			await flushMicrotasks();
			const goodSocket = netHarness.sockets.find((s) => s.connectCalls[0]?.host === '10.0.0.10');
			const badSocket = netHarness.sockets.find((s) => s.connectCalls[0]?.host === '10.0.0.11');
			if (!goodSocket || !badSocket) {
				throw new Error('expected both probe sockets to have been created');
			}
			goodSocket.emit('connect');
			badSocket.emit('error', new Error('ECONNREFUSED'));
			const result = await promise;

			// Assert
			expect(result).toEqual([{ host: '10.0.0.10' }]);
		});

		it('should dedupe multiple matching mDNS responses from the same IP into a single TCP probe', async () => {
			// Arrange
			vi.useFakeTimers();
			const promise = discoverLgSoundbars(logger, { mdnsTimeoutMs: 1000, probeTimeoutMs: 500 });
			const socket = dgramHarness.sockets[0];
			socket.emit('message', buildMdnsResponse(CAST_SERVICE_NAME), { address: '10.0.0.10' });
			socket.emit('message', buildMdnsResponse(CAST_SERVICE_NAME), { address: '10.0.0.10' });

			// Act
			await vi.advanceTimersByTimeAsync(1000);
			await flushMicrotasks();
			const matchingSockets = netHarness.sockets.filter((s) => s.connectCalls[0]?.host === '10.0.0.10');

			// Assert
			expect(matchingSockets).toHaveLength(1);

			// cleanup: settle the pending probe so the outer promise resolves
			matchingSockets[0].emit('connect');
			await promise;
		});

		it('should resolve to an empty array, not reject, when the UDP socket emits an error', async () => {
			// Arrange
			vi.useFakeTimers();
			const promise = discoverLgSoundbars(logger, { mdnsTimeoutMs: 1000, probeTimeoutMs: 500 });
			const socket = dgramHarness.sockets[0];

			// Act
			socket.emit('error', new Error('EADDRINUSE'));
			const result = await promise;

			// Assert
			expect(result).toEqual([]);
			expect(logger.warn).toHaveBeenCalled();
		});

		it('should run TCP probes concurrently, not serially', async () => {
			// Arrange
			vi.useFakeTimers();
			const promise = discoverLgSoundbars(logger, { mdnsTimeoutMs: 1000, probeTimeoutMs: 500 });
			const socket = dgramHarness.sockets[0];
			socket.emit('message', buildMdnsResponse(CAST_SERVICE_NAME), { address: '10.0.0.10' });
			socket.emit('message', buildMdnsResponse(CAST_SERVICE_NAME), { address: '10.0.0.11' });

			// Act
			await vi.advanceTimersByTimeAsync(1000);
			await flushMicrotasks();

			// Assert: both probe sockets were created and connect() invoked before either settled.
			expect(netHarness.sockets).toHaveLength(2);
			expect(netHarness.sockets[0].connectCalls).toHaveLength(1);
			expect(netHarness.sockets[1].connectCalls).toHaveLength(1);

			// cleanup
			netHarness.sockets[0].emit('connect');
			netHarness.sockets[1].emit('connect');
			const result = await promise;
			expect(result).toHaveLength(2);
		});
	});

	describe('resolveLgSoundbarDeviceConfigs', () => {
		it('should return the input unchanged and never call discover when every config already has a host', async () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', host: '10.0.0.6' },
			];
			const discover = vi.fn();

			// Act
			const result = await resolveLgSoundbarDeviceConfigs(configs, logger, discover);

			// Assert
			expect(discover).not.toHaveBeenCalled();
			expect(result).toEqual(configs);
		});

		it('should fill in the host of the single config missing it when discover returns exactly one candidate', async () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [{ id: 'sb1', host: '10.0.0.5' }, { id: 'sb2' }];
			const discover = vi.fn().mockResolvedValue([{ host: '10.0.0.7' }]);

			// Act
			const result = await resolveLgSoundbarDeviceConfigs(configs, logger, discover);

			// Assert
			expect(result).toEqual([
				{ id: 'sb1', host: '10.0.0.5' },
				{ id: 'sb2', host: '10.0.0.7' },
			]);
		});

		it('should drop the host-less entry and log a warning when discover returns zero candidates', async () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [{ id: 'sb1', host: '10.0.0.5' }, { id: 'sb2' }];
			const discover = vi.fn().mockResolvedValue([]);

			// Act
			const result = await resolveLgSoundbarDeviceConfigs(configs, logger, discover);

			// Assert
			expect(result).toEqual([{ id: 'sb1', host: '10.0.0.5' }]);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb2'));
		});

		it('should drop the host-less entry and log a warning when discover returns more than one candidate', async () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [{ id: 'sb1', host: '10.0.0.5' }, { id: 'sb2' }];
			const discover = vi.fn().mockResolvedValue([{ host: '10.0.0.7' }, { host: '10.0.0.8' }]);

			// Act
			const result = await resolveLgSoundbarDeviceConfigs(configs, logger, discover);

			// Assert
			expect(result).toEqual([{ id: 'sb1', host: '10.0.0.5' }]);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb2'));
		});

		it('should drop all host-less entries and log a warning when more than one config is missing a host', async () => {
			// Arrange
			const configs: LgSoundbarDeviceConfig[] = [{ id: 'sb1', host: '10.0.0.5' }, { id: 'sb2' }, { id: 'sb3' }];
			const discover = vi.fn().mockResolvedValue([{ host: '10.0.0.7' }]);

			// Act
			const result = await resolveLgSoundbarDeviceConfigs(configs, logger, discover);

			// Assert
			expect(result).toEqual([{ id: 'sb1', host: '10.0.0.5' }]);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb2'));
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sb3'));
		});
	});
});
