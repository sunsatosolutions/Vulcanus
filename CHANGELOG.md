# Changelog

## Unreleased

## 0.4.6 — 2026-08-17

### Fixed — reading a manifest silently dropped hand-added fields

Every command that read `vulcanus.json` rebuilt it field by field, so any key
this CLI did not recognize was gone the next time the file was written. That is
the manifest counterpart of the note-deleting bug 0.4.1 fixed, and it did real
damage: updating a vault from 0.4.1 to 0.4.5 erased hand-added `kind` and
`visibility` values from thirteen projects at once. Two of them were
`visibility: private` — the only marker telling an agent not to treat those
projects as public. Nothing in the output mentioned it. `update` reported the
notes it had left untouched and said nothing about the manifest, so without a
`git diff` the loss was invisible.

Reading now fills in defaults without pruning: each level keeps what it was
given and only supplies what is missing. A manifest is the operator's file as
much as the generator's, and a key it has never heard of is something someone
wrote on purpose. This covers every command, not just `update` — `add project`
and the `project` lifecycle commands rewrote the manifest the same way.

If a vault lost fields to this, they are in Git history:
`git diff <commit-before-update> -- vulcanus.json` and restore what was removed.

## 0.4.5 — 2026-08-17

### Added — MCP tools declare whether they write

Every tool `serve` exposes now carries MCP annotations: `readOnlyHint`,
`destructiveHint`, `idempotentHint`, and `openWorldHint`. A client deciding
whether a call needs the operator's confirmation should read a flag rather than
parse an English sentence, and until now there was nothing to read — the same
gap Glama's tool-definition review flagged across the whole set.

`recall`, `search`, `list_projects`, `vault_status`, and `doctor` are read-only.
`append_decision` and `append_rule` write and are not idempotent — calling one
twice records the entry twice. `update_capsule` is marked destructive, because
replacing a section overwrites what was there and Git is the only way back.
Nothing is open-world: every tool touches one local vault.

The descriptions say the same things in prose, and now also cover what each tool
returns, when it errors, and which sibling to prefer instead. A test asserts the
annotations match the read/write split, so a tool added later cannot quietly
ship without them.

## 0.4.4 — 2026-08-14

### Fixed — `serve` refused to start outside a vault

`vulcanus serve` exited with the no-vault error before it ever spoke MCP. That
is wrong for a server clients register once and launch wherever the operator
happens to be working: registered globally with `claude mcp add vulcanus --
vulcanus serve`, it came up only inside the vault and died in every other
repository — which a client reports as a broken server, not as a missing vault.

The server now starts anywhere and answers introspection. The vault is resolved
per tool call instead of once at construction, so calling a tool outside a vault
returns an error result naming the directory searched and how to fix it, and a
vault created or moved while the server runs is picked up without a restart.

## 0.4.3 — 2026-08-14

### Added — the MCP server is publishable to the official registry

`server.json` describes `vulcanus serve` for the MCP Registry at
`registry.modelcontextprotocol.io`, which is where MCP clients discover servers
now that the `modelcontextprotocol/servers` README has retired its third-party
list. The registry verifies that whoever publishes a listing actually owns the
npm package, by requiring `mcpName` in `package.json` to match the server name —
so the field is now there, and this release is what puts it on the registry.

No CLI behavior changes. `release.mjs` stamps the version into `server.json`
alongside the other places it is written down, because a listing whose package
version is not the one on npm is rejected.

## 0.4.2 — 2026-08-14

### Changed — the README leads with the problem, and shows the CLI running

No behavior changes in this release; the CLI is byte-for-byte what 0.4.1 was.
What changed is how the package presents itself, which was doing the product no
favors.

The README opened by naming the artifact — an AI-readable second brain — a term
crowded enough that it tells a reader nothing about what breaks without it. It
now opens with the failure: an agent that starts every session cold, and a
`CLAUDE.md` that grows forever without anything checking whether it is still
true. The MCP server is stated in the first screen instead of two hundred lines
down, since that is what connects the vault to a coding agent at all.

It also carries a recorded demo — `vulcanus init`, then `status`, then `stats` —
where before there was no image of any kind. `docs/demo.tape` records it, so the
GIF can be regenerated rather than reconstructed by hand when output changes.

The npm keywords covered five terms and none of the ones this package is
actually looked for under: `mcp`, `model-context-protocol`, `claude-code`,
`cursor`, `codex`, `agent-memory`, `context-engineering`. A published package's
keywords and README only reach the registry on a release, which is what this
release is for.

## 0.4.1 — 2026-08-07

### Fixed — `update` and `doctor --repair` deleted operator-written memory

0.4.0 regenerated four files that hold real content: the Index, the System Hub,
navigation group hubs, and the Import Log. On a vault where the operator had
written in them — a project overview, extra hub links, an import's provenance —
`vulcanus update` replaced all of it with a fresh template. That is the one
thing a memory tool must never do, and it shipped.

Those four are now `seed` files: written once, never rewritten. The graph is
kept correct by inserting what is missing instead:

- `add project` links a new project into its group hub and into the Index
  (`Main Hubs` and the project overview), the way it already patched the Recall
  Map and parent hubs.
- A new wiring pass adds any link a hub is missing — after a profile change
  deepens the system layer, for instance — without touching the rest of the
  file. `doctor --repair` runs it too, so hub coverage can now be repaired
  without regenerating the hub.

**`AGENTS.md` is merged rather than rewritten.** It has to be both: the protocol
every agent reads, so a new required step must reach existing vaults, and a file
operators extend with their own instructions. An update now keeps every section
already present, inserts the ones the protocol added, and refreshes the version
stamp. The trade-off is stated plainly: wording improvements to a section you
have customized will not reach you — losing your customization would be worse.
`--force` still rewrites everything, as it always has.

If you ran `vulcanus update` on 0.4.0 and lost content, it is in your Git
history: `git diff HEAD~1 -- <file>` and restore what was removed.

## 0.4.0 — 2026-08-07

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

### Site

[vulcanus.sunsato.com](https://vulcanus.sunsato.com) documents this release: the
full thirteen-command list, the MCP tool surface, the three new import sources,
and a token-budget section carrying the measured numbers rather than the claim.

### Node baseline

Supported Node moves to **22.12 or newer**, tested on 22, 24 (the LTS the
project is developed against), and 26. The dependency majors this unlocks —
commander 15 and @clack/prompts 1.x — set that floor themselves, and staying
below it would have meant freezing both indefinitely.

The Cursor importer no longer needs a version check for `node:sqlite`: every
supported Node has it.

### Quality

- CI on GitHub Actions: typecheck, lint, format check, and the test suite
  across Node 22/24/26 on Linux, macOS, and Windows.
- ESLint (type-checked) added and the codebase cleaned against it.
- Test suite grown from 59 to 141: end-to-end init, doctor `--repair` and
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
