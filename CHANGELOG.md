# Changelog

## Unreleased

## 0.5.0 — 2026-08-18

### Added — the vault speaks the operator's language

Generated notes are written in the language the vault records, not only the
wizard. 501 pieces of prose across the three generators that write what a person
reads come from `src/locales/notes/<locale>.json`, and the section headings with
them. Turkish, German and Spanish ship alongside English; 360 of the 374 prose
entries are translated in each, and the fourteen that are not are note names the
vault links to by filename, CLI commands, and one wikilink label — translating
those breaks the link rather than localizing it.

Headings are the piece something else depends on, so they are handled separately:
`wireHubs` inserts a missing link under one and `doctor` reads the navigation
list from it. Both look a heading up by its English name, and `headingVariants`
returns every spelling with the vault's own language first. A hub is written in
the vault's language, a vault whose language changes still validates, and a vault
generated before any of this keeps passing.

`AGENTS.md`, the visibility rule inside it, and the `.gitignore` comments stay
English on purpose, and a test holds every locale to that: the protocol carries a
version stamp `doctor` checks and `update` merges against, so it stays one shape
in one language.

Nothing about the English output changed. 193 generated files across four vault
shapes — both profiles, both naming modes, a group, nested projects, specialized
notes — are byte-identical before and after the extraction, which is the only
reason a rewrite this size was safe to make.

### Added — German and Spanish, and one place that lists the languages

`de.json` and `es.json` for the wizard, plus the plumbing that stops a language
from arriving half-listed. `LOCALES` and `LOCALE_LABELS` drive the picker, the
`--lang` flag and its help text, and the environment detection, which matches on
the language tag rather than the region so `de_AT` and `es_MX` land on the right
catalog. Adding a language is one entry and two files.

Product vocabulary stays English in every catalog — vault, capsule, hub, recall,
skill — because that is what the CLI output, the docs and the note filenames
already call these things.

### Changed — the message catalogs are data, not TypeScript

The wizard's strings were two hand-written objects, so a translator had to edit
code. They are `src/locales/<locale>.json` now, one entry per key, with `{name}`
placeholders where a value is interpolated. The `Messages` interface stays the
source of truth and no call site changed: the catalog is built from JSON at load
time, so `t.readDone(12, 4)` still reads the same everywhere.

Equivalence was checked rather than assumed — all 238 entries across both
existing locales rendered from the old catalogs and the new ones with identical
arguments and compared — and that comparison caught the one real bug in the
migration.

### Added — an import can be grouped by an AI CLI

`vulcanus import --ai-group` asks a CLI already on PATH to read the conversation
titles and say which project each belongs to. The word-frequency pass cannot tell
that "the roastery site" and a brand name are one project; a model reading the
titles can.

It runs alongside the heuristic, not instead of it. Counts stay counted rather
than judged: agreement promotes a candidate the analysis already found, and a
name only the model proposed is added at medium confidence at best. Every way it
can fail leaves the import as it would have been, with a line saying why — no CLI
on PATH, the operator declining, a reply with no JSON in it, a CLI that hangs.

What is sent is a digest: titles, any grouping the export already recorded, and
one 160-character opening line per conversation, capped at 400. Assistant replies
never leave the machine. The operator sees that description and confirms before
anything is spawned, and the note says plainly that a locally installed CLI is
usually the front end of a hosted model.

### Added — `systemNotes`, for notes the operator keeps themselves

The generated system layer is a fixed list per profile, so a note written under
the system directory read as unmanaged and the System Hub linking it read as
over-linked. `systemNotes` in the manifest names those notes. They are branded
like any other system note, never created or rewritten, and the System Hub may
link them without complaint; a note declared but never written is reported, and
one nobody declared is still reported as unmanaged.

### Fixed — a hub's prose counted against it

`doctor` compared every wikilink in a hub against the links the manifest expects
there, so a hub that explained itself was told it had links beyond the manifest.
But a hub is a navigation list *and* prose, and the prose is the part worth
writing. The check now reads only the sections where a hub lists what it owns.
Drift in that list is still reported; the wording moved to "lists beyond the
manifest" to say which of the two it means. `wireHubs` and `doctor` take those
section names from one place, so the check and the repair cannot disagree.

### Fixed — a hub's prose counted against it

`doctor` compared every wikilink in a hub against the links the manifest
expects there, so a hub that explained itself was told it had links beyond the
manifest. But a hub is a navigation list *and* prose, and the prose is the part
worth writing: a sentence like "this product belongs to the client and lives
under their hub" is exactly what an operator should record, and it has to link
to the notes it names. The only ways out were deleting a true sentence or
living with a permanent warning — and a warning nobody can clear is one the
operator learns to scroll past, which costs more than it ever caught.

The check now reads only the sections where a hub lists what it owns. Links
anywhere else are prose and are left alone. Drift in the navigation list is
still reported, and still worth reporting; the wording moved from "links beyond
the manifest" to "lists beyond the manifest" to say which of the two it means.
`wireHubs` and `doctor` now take those section names from one place, so the
check and the repair cannot disagree about where a hub's list lives. Both
spellings of the System Hub's list are recognized, since vaults generated
earlier wrote `## Core Files` where new ones write `## System Notes`.

### Added — `systemNotes` for the notes the operator keeps themselves

The generated system layer is a fixed list per profile, and `specialized`
exists only on projects, so there was nowhere to say "this note under the
system directory is mine and it belongs". A vault that added one got it
reported as unmanaged and got the System Hub that linked it reported as
over-linked: two findings for doing nothing wrong.

`systemNotes` in `vulcanus.json` takes the note kinds the operator writes.
They are branded like every other system note, so `Release Notes` resolves to
`<Vault> Release Notes` in a branded vault and `Release Notes` in a generic
one. Declaring one makes the vault aware of it and nothing more: it is never
created, never rewritten, and `update` will not touch it. The System Hub is
allowed to link it, `wireHubs` adds the bullet if it is missing, and a note
declared but never written is reported so the declaration cannot quietly point
at nothing. A system note nobody declared is still reported as unmanaged.

`doctor` rejects a declared name that collides with one the CLI generates, and
rejects duplicates, rather than letting two notes fight over one path.

## 0.4.7 — 2026-08-17

### Added — projects can record what they are and who may hear about them

Two optional fields on each project in `vulcanus.json`. `kind` is one of
`umbrella`, `product`, `lab`, `service-brand`, `client`, `client-product` and
says what the project is, so an agent knows how to place and summarize it.
`visibility` is `public` or `private` and answers the question an agent cannot
otherwise answer: may I name this in a public repository, a commit message, an
issue?

Both are asked by `init` and `add project`. `visibility` is recorded even when
the answer is public, because "nobody has said" and "the operator said public"
are different states and only one of them is safe to act on. `recall` returns
both fields, and for a private project adds an instruction not to name it
outside the vault — phrased as an instruction rather than a flag, since the cost
of a model skimming past it is a private project in something public.
`list_projects` carries them too.

`doctor` warns on a value it does not recognize instead of failing the vault:
the axes are optional and operator-owned, but a typo like `privte` would
otherwise read as public to every agent.

This is a signal for agents, not access control — nothing here encrypts or hides
a file. It exists because a real vault hand-added these fields, had them silently
erased by the bug fixed in 0.4.6, and the two that mattered were the
`visibility: private` markers.

**Agent protocol 2.** `AGENTS.md` now carries the rule and, when a vault marks
anything private, names those projects under a `Project visibility` heading —
an agent reading the protocol instead of calling a tool would otherwise never
learn it, and the tool path alone leaves the prose path unaware. A vault that
marks nothing private gets no such section, only the general rule. `doctor`
reports the older protocol stamp and `vulcanus update` merges the section in,
keeping any sections the operator added.

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
