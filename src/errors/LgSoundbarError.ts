import { BaseError } from './BaseError.js';

/** Error from the local-network LG Soundbar TCP client (connect, send, or reply failures). */
export class LgSoundbarError extends BaseError {
	constructor(message: string, metadata?: Record<string, unknown>) {
		super(message, 'LG_SOUNDBAR_ERROR', undefined, metadata);
	}
}
