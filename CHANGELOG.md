# Changelog

## Unreleased

### MCP server

`vulcanus serve` exposes the vault to MCP clients over stdio: `recall` (Capsule
plus read order), layer-aware `search`, `list_projects`, `append_decision`,
`append_rule`, `update_capsule`, `vault_status`, and `doctor`. The manifest is
re-read on every call, so edits made while the server runs are always visible.

`recall` reports its own freshness: when a Capsule is older than the Decisions,
Rules, or Context beneath it, the answer carries a staleness warning instead of
presenting an outdated summary as current. `update_capsule` replaces a single
named section rather than rewriting the file, so an agent cannot quietly drop
memory it did not think was important, and `Read Next` — the generated routing —
is not writable at all.

`serve` accepts `--cwd` for clients started outside the vault. Generated vaults
now document the server themselves, in `USING-WITH-AI.md` and a `<vault>-serve`
agent skill.

### Token budget

`vulcanus stats` reports what the structure actually costs: the cold-start read
(`AGENTS.md`, Recall Map, Admin Profile), a typical task-scoped recall, and the
whole vault, plus per-project capsule and cluster sizes. `--json` for scripts.

Counts are estimated at ~4 characters per token and labelled as estimates
everywhere they are printed — the ratio is the measurement, not the absolute
number. [`docs/token-budget.md`](docs/token-budget.md) records a reproducible
run and is explicit about what it does not prove.

### Importers

- **Gemini CLI** — `~/.gemini/tmp/**/logs.json` and saved `checkpoint-<tag>.json`
  chats. A `/chat save` tag is treated as a real title; a rolling log is not.
- **Cursor** — per-workspace chat history from `state.vscdb`, with the workspace
  folder as the project signal. Uses the built-in `node:sqlite`, so it reports
  itself unavailable below Node 22.5 rather than silently finding nothing.
- **Markdown folder** — any directory of notes. Never probed automatically; only
  scanned when the path is named, because scanning a home directory uninvited is
  not something an importer should do.
- **Incremental by default** — re-running `import` on the same source proposes
  only what is new. Ids already read are remembered in the vault's state
  directory; `--all` re-reads everything.
- `import --json` prints candidates with their evidence and writes nothing.

### Git hooks and watch mode

- `vulcanus hooks install` writes a pre-commit hook that runs `doctor` and
  refuses to commit a broken graph. It honours `core.hooksPath`, and it will not
  overwrite or remove a hook it did not write without `--force`.
- `vulcanus sync --watch` regenerates managed files and revalidates on every
  edit. It never commits or pushes — a commit per keystroke would bury the
  vault's history, and a push stays an explicit act.

### Project lifecycle

- `vulcanus project remove` unlinks a project and moves its notes to
  `_archive/` — never deletes them. Refuses while sub-projects exist.
- `vulcanus project rename` renames the folder, note files, and every
  wikilink, heading, and frontmatter reference in one move; name-derived
  trigger words follow.
- `vulcanus project archive [--restore]` flips the status without touching
  notes.

### New commands and flags

- `vulcanus status`: one-screen vault health — projects by status, notes on
  disk vs planned, doctor result, generator drift, git state — with `--json`.
  It also warns when a Capsule is older than the Decisions/Rules/Context it
  summarizes, judged by git history (file mtimes outside a repository).
- `init` now runs without a TTY: every question has a flag (`--name`,
  `--operator`, `--projects`, `--naming`, `--profile`, `--no-import`,
  `--git`/`--no-git`, …), `--defaults` answers the rest, and `--dry-run`
  prints the would-be file tree without writing. An explicit target no longer
  re-asks the destination.
- `--verbose` and `--quiet` on every command. `--json` implies quiet, so
  machine-readable output owns stdout.
- `sync --json` reports the doctor result, the pending changes, the commit hash,
  and whether the push actually happened.
- `vulcanus completion bash|zsh|fish|pwsh` prints a completion script, generated
  from one description of the CLI so a new command cannot reach three shells and
  miss the fourth.

### Errors and exit codes

Every failure now says what happened, why, and what to do about it, and the exit
codes are documented as a contract: `0` success, `1` failed validation, `2`
misuse (no vault, bad flag), `130` cancelled at a prompt.

### Agent protocol versioning

`AGENTS.md` carries a protocol stamp. `doctor` warns when a vault still
describes an older protocol — its agents are following superseded instructions —
and refuses a vault whose protocol is newer than the CLI understands. `doctor`
also catches the skill copies in `.claude/skills/` and `.agents/skills/` drifting
apart, which would otherwise make an agent behave differently depending on which
tool loaded it.

### Node baseline

Supported Node moves to **22.12 or newer**, tested on 22, 24 (the LTS the
project is developed against), and 26. The dependency majors this unlocks —
commander 15 and @clack/prompts 1.x — set that floor themselves, and staying
below it would have meant freezing both indefinitely.

The Cursor importer no longer needs a version check for `node:sqlite`: every
supported Node has it.

### Quality

- CI on GitHub Actions: typecheck, lint, format check, and the test suite
  across Node 18/20/22 on Linux, macOS, and Windows.
- ESLint (type-checked) added and the codebase cleaned against it.
- Test suite grown from 59 to 140: end-to-end init, doctor `--repair` and
  `--json`, manifest migrations, project lifecycle, capsule freshness, i18n
  message integrity, the MCP tool layer and its registration over an in-memory
  transport, importer edge cases (empty exports, corrupt batches, truncated
  session logs, exotic unicode titles), stats, completion, hooks, and the error
  format.
- Coverage thresholds enforced in CI: lines 85%, branches 75%, functions 80%.
- **Windows CI fixed.** `node --test test/*.test.ts` relies on shell glob
  expansion, which PowerShell does not do, so every Windows leg was failing
  before it ran a single test. The file list is expanded in JavaScript now.
- Vault-internal paths are normalized to forward slashes on every platform, so a
  path read from the filesystem can never fail to match a planned path on
  Windows.
- Release automation: `npm run release -- <version|major|minor|patch>` bumps
  `package.json`, `src/version.ts`, and the CHANGELOG heading together, and
  pushing the `v*` tag publishes to npm with provenance and drafts the GitHub
  release from the hand-written notes. A test fails if `CLI_VERSION` and
  `package.json` ever drift apart.
- Dependabot for npm and GitHub Actions, weekly and grouped.
- `exports` map and generated type declarations, so the vault operations can be
  used programmatically and not only through the CLI.
- `CONTRIBUTING.md`, issue forms, and a pull request template.

## 0.3.3

Continuing in an existing Obsidian vault no longer asks for a vault name or the
rest of the identity questions — the vault already has an identity.

- When `init` continues inside an existing Obsidian vault, the vault name is
  taken from the folder, the operator name from the vault's Git identity (then
  the OS user), and system-note naming defaults to generic so the folder name
  is not stamped into every note. None of these are asked.
- Choosing to create a separate new vault still asks for everything as before.
- If the chosen vault already has a `vulcanus.json`, `init` stops and points to
  `add project` / `update` instead of overwriting the manifest.

## 0.3.2

When a single Obsidian vault is detected, `init` now continues inside it
without asking. The choice prompt only appears when more than one vault is
found and the destination is genuinely ambiguous; an explicit `--target` still
scaffolds a separate vault wherever it points.

## 0.3.1

Documentation only. The README intro and the `init` command line now state that
`init` can add the memory structure to an Obsidian vault you already keep,
matching the 0.3.0 behavior. No code changes.

## 0.3.0

### Continue in an existing Obsidian vault

If you already keep an Obsidian vault and have started writing in it, `init` no
longer forces a separate, competing vault beside it.

- Before asking where to create the vault, `init` looks for an Obsidian vault —
  a directory holding a `.obsidian` folder — in the current directory and its
  immediate subdirectories.
- When one is found, it offers to add the memory structure to that vault or to
  scaffold a fresh one in its own directory, instead of assuming a new vault.
- Continuing in an existing vault never overwrites your own notes: generated
  files are written only where nothing exists, exactly as elsewhere.
- Passing an explicit target directory skips the prompt and is respected as-is.

## 0.2.0

Two ways to close the gap between a vault and the agents meant to use it: let an
AI write the notes in the first place, and give every agent a real capability
instead of a paragraph of prose.

### Local AI writes the project notes

When projects are added — by `init`, `add project`, or `import` — the detail
question is now a three-way choice: answer here, skip, or hand the job to an AI
CLI already installed on your machine.

- Probes PATH for `claude`, `codex`, `cursor-agent` (also shipped as `agent`),
  and `gemini`, and offers only what is really installed. When nothing is found
  it says so and asks the questions here rather than creating projects nobody
  described.
- Proposes each project's source directory from the working directories your
  past Claude Code and Codex sessions actually ran in, instead of asking blind.
- States which CLI is taking over the terminal, in which directory, and exactly
  which notes it has been told to write — then asks. That confirmation cannot be
  suppressed by `--ai` or `-y`.
- Hands over a task carrying the notes' absolute paths and every invariant
  `vulcanus doctor` enforces, and revalidates the vault the moment the session
  exits.
- `init`, `add project`, and `import` accept `--ai [cli]`.

The structural questions — hierarchy, grouping, specialized notes — are still
asked in the terminal. They decide the directory layout and the generated system
notes, and have to be settled before a file exists, while the AI session only
starts once the notes are there.

### Agent skills

`vulcanus skills` generates one [Agent Skills](https://agentskills.io) skill per
vault operation, plus a recall skill carrying the Recall Map → Capsule → Hub
routing. Skills invoke the real CLI and report its actual output and exit code.

- Every vault ships them at `.claude/skills/` and `.agents/skills/` — the second
  is the vendor-neutral directory Codex, Cursor, and Gemini CLI all read.
- `vulcanus skills --install` writes them to `~/.claude/skills/` and
  `~/.agents/skills/`, which is what makes the vault reachable from other
  repositories. Never done by `init`; existing files are kept unless `--force`.
- `sync` and `update` skills require the operator's confirmation in the current
  conversation and show a `--dry-run` first.
- Skills are managed files, so `doctor --repair` and `update` carry template
  fixes into existing vaults.

`vulcanus agents` is unchanged — this adds a channel rather than replacing one,
and tools without a skill mechanism keep the prose snippet.

### Internal

- Prompts go through a swappable driver, so a wizard's question flow can be
  tested without a TTY.
- Prettier configuration and `npm run format` / `format:check`.

## 0.1.0

Initial release.
