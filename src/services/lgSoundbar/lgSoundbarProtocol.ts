import { createCipheriv, createDecipheriv } from 'node:crypto';

export const LG_SOUNDBAR_PORT = 9741;

const LG_SOUNDBAR_KEY = Buffer.from('T^&*J%^7tr~4^%^&I(o%^!jIJ__+a0 k', 'utf8');
const LG_SOUNDBAR_IV = Buffer.from("'%^Ur7gy$~t+f)%@", 'utf8');
const FRAME_FLAG = 0x10;
const HEADER_LENGTH = 5;
const MAX_FRAME_BYTES = 1024 * 1024;

/** Minimal logger shape so this pure module does not depend on matterbridge. */
export interface LgSoundbarLogger {
	debug(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/** Frames a JSON payload: `0x10` flag, 4-byte big-endian ciphertext length, AES-256-CBC body. */
export function encodeLgSoundbarFrame(payload: unknown): Buffer {
	const cipher = createCipheriv('aes-256-cbc', LG_SOUNDBAR_KEY, LG_SOUNDBAR_IV);
	const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
	const header = Buffer.alloc(HEADER_LENGTH);
	header.writeUInt8(FRAME_FLAG, 0);
	header.writeUInt32BE(body.length, 1);
	return Buffer.concat([header, body]);
}

function decodeLgSoundbarBody(body: Buffer, logger: LgSoundbarLogger): unknown {
	try {
		const decipher = createDecipheriv('aes-256-cbc', LG_SOUNDBAR_KEY, LG_SOUNDBAR_IV);
		const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
		return JSON.parse(plain);
	} catch (error) {
		logger.warn(
			`LG Soundbar: dropped undecodable frame (${body.length} bytes): ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

/** Stateful byte accumulator: holds partial frames across pushes and drops frames it cannot decode. */
export class LgSoundbarFrameParser {
	private buffer: Buffer = Buffer.alloc(0);

	constructor(private readonly logger: LgSoundbarLogger) {}

	public push(chunk: Buffer): unknown[] {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		const messages: unknown[] = [];

		while (this.buffer.length >= HEADER_LENGTH) {
			if (this.buffer[0] !== FRAME_FLAG) {
				this.logger.warn('LG Soundbar: unexpected frame header, discarding buffered bytes');
				this.buffer = Buffer.alloc(0);
				break;
			}
			const frameLength = HEADER_LENGTH + this.buffer.readUInt32BE(1);
			if (frameLength - HEADER_LENGTH > MAX_FRAME_BYTES) {
				this.logger.warn('LG Soundbar: frame length out of range, discarding buffered bytes');
				this.buffer = Buffer.alloc(0);
				break;
			}
			if (this.buffer.length < frameLength) {
				break;
			}
			const body = this.buffer.subarray(HEADER_LENGTH, frameLength);
			this.buffer = this.buffer.subarray(frameLength);
			const message = decodeLgSoundbarBody(body, this.logger);
			if (message !== undefined) {
				messages.push(message);
			}
		}

		return messages;
	}
}
