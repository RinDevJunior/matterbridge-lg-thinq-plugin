<!--
Commit message template. Subject <= 72 chars, imperative mood, lowercase after the type, no trailing period.
Body optional: explain WHY and the effect, wrap at about 72 chars, blank line between subject and body.
Do NOT add Co-Authored-By or any "Generated with" line.
No trailer: do NOT end with a Claude-Session line or any other attribution line, even when the session offers one.
Do NOT name where an idea came from (a reference repo, tool or version, e.g. "follows <project> 1.2"). Describe what the change does and why.
-->

```
<type>: <short summary>

<optional body: why this change, and its effect. Mention new config options with defaults. No reference to the source of the idea.>
```

## Types (only those our history uses)

| Type       | When                                |
| ---------- | ----------------------------------- |
| `feat`     | New behavior or capability          |
| `fix`      | Bug fix                             |
| `docs`     | Documentation only                  |
| `chore`    | Tooling, config, deps, version bump |
| `test`     | Tests only                          |
| `refactor` | Restructure, same behavior          |
| `perf`     | Performance only                    |
| `style`    | Formatting only, no logic change    |

No scope in parentheses: our history does not use them.

## PR number

A suffix like `(#11)` is added automatically by squash merges. Never write it by hand.

## Examples

```
feat: add read-only ThinQ Connect API probe command
feat: wire washer Start/Pause/Stop to ThinQ
fix: stop air conditioner polling after a ThinQ keep-alive failure
docs: add README.md
chore: release candidate 0.1.1-rc03
```

With a body:

```
chore: log ThinQ keep-alive failures as one line with resultCode

A failed keep-alive used to print a multi-line stack trace on every
retry. It now logs a single line with the ThinQ resultCode, so the
cause is visible without flooding the Matterbridge log. Behavior of
the retry itself is unchanged.
```
