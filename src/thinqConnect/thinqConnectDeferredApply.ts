import type { AnsiLogger } from 'matterbridge/logger';

// Matterbridge awaits command handlers while the invoke is still open; writes must wait until it commits.
export const THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS = 250;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function deferThinqConnectApply(description: string, task: () => Promise<void>, logger: AnsiLogger): void {
	setTimeout(() => {
		void Promise.resolve()
			.then(task)
			.catch((error: unknown) => {
				logger.error(`${description} failed: ${errorMessage(error)}`);
			});
	}, THINQ_CONNECT_DEFERRED_APPLY_DELAY_MS);
}
