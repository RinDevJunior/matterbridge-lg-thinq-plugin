/* eslint-disable n/no-process-exit */
import { spawnSync } from 'node:child_process';

spawnSync('npx vitest run --reporter=junit --outputFile=test-report.junit.xml', {
	shell: true,
	stdio: 'ignore',
});

const { status } = spawnSync('node scripts/parse-junit-failures.mjs', {
	shell: true,
	stdio: 'inherit',
});

process.exit(status ?? 1);
