<!--
Pull request template. Fill every section; delete a section only if it truly does not apply.
Keep it short and in simple English. Do NOT add a "Generated with" line.
Trailer: end the PR description with the attribution line given by the session (the claude.ai/code/session link) when present; never hard-code it here.
Title: conventional-commit style, general, no tool or source names
(example: `feat: report washer state in Matterbridge when ThinQ goes offline`).
-->

## Summary

<!-- 1 to 3 sentences: what this PR does and why, from the user's point of view. -->

## Changes

<!-- One bullet per change (add the commit id in backticks when there are several commits).
     Say what changed and the effect. Mention new config options with default values.
     Mention behavior changes explicitly. -->

- `abc1234` What changed and its effect.

## Testing

<!-- Tick only what you ran. Say plainly what was not tested. -->

- [ ] `npm run precommit:ci` (lint, type-check, duplicate check, format, tests)
- [ ] `npm run format:ci`
- [ ] `npm run lint:fix:ci`
- [ ] `npm run type-check:ci`
- [ ] `npm run test:ci`
- [ ] Manually verified on <appliance model (washer / air conditioner) / Matterbridge version>: <what was checked>

## Related issue

Closes/relates to #<number> or None
