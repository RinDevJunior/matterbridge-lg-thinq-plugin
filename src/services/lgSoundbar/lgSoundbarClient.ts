import { Socket } from 'node:net';

import { LgSoundbarError } from '../../errors/LgSoundbarError.js';
import {
	encodeLgSoundbarFrame,
	LG_SOUNDBAR_PORT,
	LgSoundbarFrameParser,
	type LgSoundbarLogger,
} from './lgSoundbarProtocol.js';

const SOUNDBAR_MSG = 'SPK_LIST_VIEW_INFO';
const SOUND_MODE_MSG = 'EQ_VIEW_INFO';
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_SEND_TIMEOUT_MS = 5000;
const DEFAULT_IDLE_DISCONNECT_MS = 5000;

export interface LgSoundbarConnectionOptions {
	host: string;
	port?: number;
	connectTimeoutMs?: number;
	sendTimeoutMs?: number;
	idleDisconnectMs?: number;
}

export interface LgSoundbarState {
	readonly powerOn: boolean | undefined;
	readonly volume: number | undefined;
	readonly volumeMin: number | undefined;
	readonly volumeMax: number | undefined;
	readonly soundMode?: number;
}

interface ReplyWaiter {
	expectedMsg: string;
	resolve: (data: Record<string, unknown>) => void;
	reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Per-soundbar TCP client. One command is in flight at a time (queued), the socket connects on demand,
 * closes after an idle period, and is re-established lazily on the next command.
 */
export class LgSoundbarClient {
	private readonly host: string;
	private readonly port: number;
	private readonly connectTimeoutMs: number;
	private readonly sendTimeoutMs: number;
	private readonly idleDisconnectMs: number;
	private socket: Socket | undefined;
	private connecting: Promise<Socket> | undefined;
	private parser: LgSoundbarFrameParser;
	private replyWaiter: ReplyWaiter | undefined;
	private idleTimer: NodeJS.Timeout | undefined;
	private queueTail: Promise<unknown> = Promise.resolve();

	constructor(
		options: LgSoundbarConnectionOptions,
		private readonly logger: LgSoundbarLogger,
	) {
		this.host = options.host;
		this.port = options.port ?? LG_SOUNDBAR_PORT;
		this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		this.sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
		this.idleDisconnectMs = options.idleDisconnectMs ?? DEFAULT_IDLE_DISCONNECT_MS;
		this.parser = new LgSoundbarFrameParser(logger);
	}

	public async getState(): Promise<LgSoundbarState> {
		const data = await this.sendGet(SOUNDBAR_MSG);
		return {
			powerOn: typeof data.b_powerstatus === 'boolean' ? data.b_powerstatus : undefined,
			volume: numberOrUndefined(data.i_vol),
			volumeMin: numberOrUndefined(data.i_vol_min),
			volumeMax: numberOrUndefined(data.i_vol_max),
		};
	}

	public async setPower(on: boolean): Promise<void> {
		await this.sendSet(SOUNDBAR_MSG, { b_powerkey: on });
	}

	public async setVolume(volume: number): Promise<void> {
		await this.sendSet(SOUNDBAR_MSG, { i_vol: Math.round(volume) });
	}

	public async setMute(muted: boolean): Promise<void> {
		await this.sendSet(SOUNDBAR_MSG, { b_mute: muted });
	}

	public async getSoundMode(): Promise<number | undefined> {
		const data = await this.sendGet(SOUND_MODE_MSG);
		return numberOrUndefined(data.i_curr_eq);
	}

	public async setSoundMode(eq: number): Promise<void> {
		await this.sendSet(SOUND_MODE_MSG, { i_curr_eq: Math.round(eq) });
	}

	public destroy(): void {
		this.disconnect();
		this.replyWaiter?.reject(new LgSoundbarError('LG Soundbar client destroyed', { host: this.host }));
		this.replyWaiter = undefined;
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queueTail.then(task);
		this.queueTail = run.catch(() => undefined);
		return run;
	}

	private sendGet(msg: string): Promise<Record<string, unknown>> {
		return this.enqueue(async () => {
			const socket = await this.acquireSocket();
			try {
				const reply = this.awaitReply(msg);
				socket.write(encodeLgSoundbarFrame({ cmd: 'get', msg }));
				return await reply;
			} finally {
				this.scheduleIdleDisconnect();
			}
		});
	}

	private sendSet(msg: string, data: Record<string, unknown>): Promise<void> {
		return this.enqueue(async () => {
			const socket = await this.acquireSocket();
			try {
				socket.write(encodeLgSoundbarFrame({ cmd: 'set', data, msg }));
			} finally {
				this.scheduleIdleDisconnect();
			}
		});
	}

	private async acquireSocket(): Promise<Socket> {
		this.cancelIdleTimer();
		if (this.socket) {
			return this.socket;
		}
		this.connecting ??= this.connect().finally(() => {
			this.connecting = undefined;
		});
		return this.connecting;
	}

	private async connect(): Promise<Socket> {
		const socket = new Socket();
		this.parser = new LgSoundbarFrameParser(this.logger);
		socket.on('data', (chunk: Buffer) => this.handleData(socket, chunk));
		socket.on('error', (error: Error) => this.handleSocketFailure(socket, error));
		socket.on('close', () => this.handleSocketFailure(socket, new Error('connection closed')));

		try {
			await this.connectSocket(socket);
		} catch (error) {
			socket.destroy();
			throw error;
		}
		this.socket = socket;
		return socket;
	}

	private async connectSocket(socket: Socket): Promise<void> {
		let timer: NodeJS.Timeout | undefined;
		try {
			await new Promise<void>((resolve, reject) => {
				timer = setTimeout(() => {
					reject(new LgSoundbarError(`connect to ${this.host} timed out`, { host: this.host, port: this.port }));
				}, this.connectTimeoutMs);
				socket.once('error', (error: Error) => {
					reject(
						new LgSoundbarError(`connect to ${this.host} failed: ${error.message}`, {
							host: this.host,
							port: this.port,
						}),
					);
				});
				socket.connect(this.port, this.host, () => resolve());
			});
		} finally {
			clearTimeout(timer);
		}
	}

	private awaitReply(expectedMsg: string): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.replyWaiter = undefined;
				this.disconnect();
				reject(new LgSoundbarError(`no reply from ${this.host} within ${this.sendTimeoutMs} ms`));
			}, this.sendTimeoutMs);
			this.replyWaiter = {
				expectedMsg,
				resolve: (data) => {
					clearTimeout(timer);
					resolve(data);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
		});
	}

	private handleData(socket: Socket, chunk: Buffer): void {
		if (socket !== this.socket) {
			return;
		}
		for (const message of this.parser.push(chunk)) {
			if (
				!isRecord(message) ||
				!this.replyWaiter ||
				message.msg !== this.replyWaiter.expectedMsg ||
				!isRecord(message.data)
			) {
				this.logger.debug('LG Soundbar: ignored unsolicited message');
				continue;
			}
			const waiter = this.replyWaiter;
			this.replyWaiter = undefined;
			waiter?.resolve(message.data);
		}
	}

	private handleSocketFailure(socket: Socket, error: Error): void {
		if (socket !== this.socket) {
			return;
		}
		this.logger.debug(`LG Soundbar ${this.host}: socket ended: ${error.message}`);
		this.socket = undefined;
		const waiter = this.replyWaiter;
		this.replyWaiter = undefined;
		waiter?.reject(new LgSoundbarError(`connection to ${this.host} lost: ${error.message}`, { host: this.host }));
	}

	private disconnect(): void {
		this.cancelIdleTimer();
		const socket = this.socket;
		this.socket = undefined;
		socket?.destroy();
	}

	private scheduleIdleDisconnect(): void {
		this.cancelIdleTimer();
		this.idleTimer = setTimeout(() => {
			this.idleTimer = undefined;
			this.disconnect();
		}, this.idleDisconnectMs);
		this.idleTimer.unref();
	}

	private cancelIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = undefined;
		}
	}
}
