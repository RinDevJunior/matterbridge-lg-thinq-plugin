/**
 * Error handling module.
 *
 * Provides a hierarchical error structure for type-safe error handling throughout the plugin.
 * All errors extend from BaseError and include error codes, status codes, and metadata.
 *
 * @example
 * ```typescript
 * import { BaseError } from './errors';
 *
 * class MyError extends BaseError {}
 * ```
 */

// Base error
export { BaseError } from './BaseError.js';

// Authentication errors
export {
	AuthenticationError,
	InvalidCredentialsError,
	ManualProcessNeededError,
	TokenExpiredError,
} from './AuthenticationError.js';

// ThinQ Connect API errors
export { ThinqConnectApiError } from './ThinqConnectApiError.js';
