# Memory Archive

Older entries pruned from `.claude/memory.md` to respect its per-section cap. Consult when working on the areas named below.

## Common Pitfalls (archived)

- `classifyIslands` (`legacyIslandDetection.ts`) size-heuristic bug (Jul 27, fixed): was gating per `hasNoWallOrZoneData` map-wide; now evaluates per-island as last-resort fallback — deleted 4-line variable, removed gate from condition, updated doc comment.
- Implementer must NOT run full builds or the whole test suite — its gate is `format:ci` → `lint:fix:ci` → `type-check:ci` only; `build:local:ci`/`test:ci` belong to compiler/test-writer.
- `platformRunner.ts:120` writes `activeMapId` BEFORE `handleActiveMapChanged` — a guard inside the handler can't prevent `activeMapId` desync, and the same-map guard (`:119`) then swallows an identical-mapId retry.
- `SELECT_AREAS` empty-input path (`roborockVacuumCleaner.ts:164-176`) must NOT call `trySwitchMap` — keep empty vs explicit branches structurally separate with early `return`, else V10/V1 (`activeMapId=-1`) fires unguarded `switchMap` on every global-clean.
- ESLint `preserve-caught-error` requires re-thrown errors to carry `{ cause: err }` — omitting it fails `lint:fix:ci` even when the message embeds the original error text.
- ESLint `no-base-to-string` prohibits stringifying `err.cause` directly in templates (`String(err.cause)`) — check `if (cause instanceof Error)` first, then safely access `.message`; this prevents accidental `[object Object]` in logs.
