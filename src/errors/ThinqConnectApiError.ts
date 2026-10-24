import { BaseError } from './BaseError.js';

/** Error from the official LG ThinQ Connect API (Personal Access Token flow). */
export class ThinqConnectApiError extends BaseError {
	constructor(message: string, resultCode?: string, statusCode?: number) {
		super(message, 'THINQ_CONNECT_ERROR', statusCode, { resultCode });
	}
}
