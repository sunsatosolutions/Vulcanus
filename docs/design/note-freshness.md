# Design: note freshness (Halflife, round 1)

Status: first round. A note-level layer next to the section-level lifecycle (`valid-until::`, `EXPIRED`, `STALE-REF`), which is unchanged. It answers one question: when did a person last look at this note, and does it still point at files that exist? It never judges whether the prose is true.

## Schema

Manifest (`vulcanus.json`), optional:

```json
"freshness": { "staleAfterDays": { "decisions": 180, "capsule": 90 } }
```

- Keys are frontmatter `type` values, compared without case. Values are whole numbers of days above 0.
- The field absent means the whole layer is off: no finding, no stale count, `review` says so. A vault that never adds it sees nothing new.
- `manifestVersion` moves 1 → 2 through the migration chain. The step changes nothing in the file: the field is optional, so a version 1 manifest is already valid. A vault written by 0.7.x and read by a CLI that knows version 2 loads as before; a CLI that only knows version 1 reports `VERSION` on a version 2 vault, which is what the field exists for.

Note frontmatter, both optional:

```yaml
reviewed: 2026-11-01   # YYYY-MM-DD, the day a person last checked the note
stale_after: 60        # days; replaces the manifest default for this note
```

## State rules

`assessNote` is pure: the note text, today's date and a path-exists function go in. `today` is a parameter (`runDoctor` option, `review` and `stats` options) so tests do not depend on the clock.

| state      | when                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `stale`    | `reviewed` is valid, a limit applies, and days since `reviewed` is greater than the limit            |
| `dead-ref` | not stale, and the note writes at least one relative path as code that does not exist               |
| `fresh`    | `reviewed` is valid, a limit applies, within it, and no dead path                                   |
| `unknown`  | everything else: no `reviewed`, no limit for its type, no frontmatter                               |

- A limit is the note's `stale_after`, else the manifest default for its `type`.
- A bad `reviewed` (not a real date, or in the future) or a bad `stale_after` (not a whole number above 0) never throws. The field is ignored (a bad `stale_after` falls back to the manifest default) and `doctor` warns with code `FRESHNESS`.
- A stale note keeps its dead paths in the result; `dead-ref` is only the state when nothing outranks it.

## Dead references

A path counts when it is written as code (an inline backtick span or a fenced block) and is a relative file or folder path. The reader is the one `drift` uses (`extractClaims`), so the two commands agree on what a path is: URLs, globs, absolute paths, `~`, `../` paths and prose like `and/or` are skipped; superseded and expired sections are skipped; frontmatter and HTML comments are not read.

Where a path is looked up:

1. the vault root;
2. the project's `root` from the manifest, for a project's own notes. No new field was added for this.

The path is found if either holds.

Limits, on purpose:

- Only warnings; the exit code does not change. A rename, or a folder in a repository this vault cannot see, looks the same as a dead path.
- The generated system notes are not scanned. They write example names (`path/to/file.md`, `Index.md`) that are not claims. Their staleness is still checked.
- A project without `root` is looked up in the vault only, so a code path in its notes reports as dead. Set `root`, or leave `freshness` off.
- A bare folder name like `docs/design` (no extension, no trailing slash, two segments) is not read as a path; this is `drift`'s rule, kept to avoid false alarms.

## Commands

- `doctor`: `STALE-NOTE` (past its limit), `DEAD-PATH` (one finding per missing path), `FRESHNESS` (unreadable field). All warnings, also in `--json`.
- `review`: stale notes, longest unreviewed first, ties by path. `--json` prints `{ enabled, today, stale }`.
- `review --ok <note>`: sets `reviewed:` to today. The note is found by name (no case, no `.md`) or by vault-relative path; an unknown or ambiguous name is a usage error (exit 2). Only the `reviewed:` line changes: replaced where it stands, or added before the closing `---`; line endings are kept. A note without frontmatter is refused, not rewritten.
- `stats`: `staleNotes`, null when freshness is off.

## Not in this round

MCP `recall` and `search` do not mention freshness. `doctor --repair` never touches `reviewed:`; a review is a person's act.
