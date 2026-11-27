# Vulcanus

**Your coding agent starts every session cold.** You re-explain the architecture, repeat decisions you already made, and watch it break a rule you set last week. The context lives in your head and in a scrollback buffer that is already gone.

Vulcanus fixes that at the source. It builds an **AI-readable second brain** — a Git-versioned vault of linked Markdown that you and your agents both read — and serves it over MCP, so an agent can `recall` a project instead of guessing at it.

```bash
npm install -g @sunsato/vulcanus
vulcanus
```

Install it globally: the MCP server (`vulcanus serve`), the skills, and the commit hook all run the `vulcanus` command, so it has to be on your PATH. `npx @sunsato/vulcanus` works for a one-off look, but nothing you wire to your agents can reach it.

![Creating a vault with vulcanus init, then checking it with status and stats](https://raw.githubusercontent.com/sunsatosolutions/Vulcanus/main/docs/demo.gif)

You answer a few questions, and Vulcanus writes the whole vault — routing layer, operator profile, agent protocol, and one memory cluster per project — then validates that the graph actually holds together. Already keep an Obsidian vault? It adds the memory structure to that vault instead of creating a separate one.

Requires Node 22.12 or newer. It runs locally: no account, and no automatic network call beyond an optional once-a-day version check. Upgrade with `npm install -g @sunsato/vulcanus@latest`.

A [Sunsato](https://sunsato.com) product · [vulcanus.sunsato.com](https://vulcanus.sunsato.com)

## Why a vault and not a prompt

A `CLAUDE.md` that grows forever is the thing this replaces. It gets read in full on every task, it drifts out of date silently, and nothing checks that what it claims is still true.

A vault is layered instead, so recall is scoped: an agent reads the Recall Map, then the one Capsule its task needs, and goes deeper only for authority or detail. `vulcanus stats` measures that on your own vault — in the demo above, a task-scoped recall reads 59% less than the whole vault. `vulcanus doctor` then enforces that every link resolves and every project is reachable, so the memory fails loudly instead of rotting quietly.

## Wire it to your agent

The vault is only worth as much as the recall it gives your tools, so that is one command each:

```bash
claude mcp add vulcanus -- vulcanus serve   # Claude Code, or any MCP client
```

```bash
vulcanus skills --install   # skills that run the real commands, in every repo
```

```bash
vulcanus agents             # the block to paste into a tool's global instructions
```

[MCP server](#mcp-server), [Skills](#skills), and [Making agents actually use it](#making-agents-actually-use-it) below cover what each one exposes.

## What it creates

```txt
YourVault
├─ AGENTS.md              # the protocol AI agents must follow in this repo
├─ CLAUDE.md              # points Claude Code at that protocol
├─ USING-WITH-AI.md       # how to make every tool recall this vault
├─ README.md
├─ vulcanus.json          # the manifest everything is derived and validated from
├─ .claude/skills/        # invocable skills for Claude Code
├─ .agents/skills/        # the same skills for Codex, Cursor, and Gemini CLI
├─ 00_System/             # Index, Recall Map, Admin Profile, Rules, Update Format …
├─ 02_Projects/           # one cluster per project
└─ _imports/              # raw AI exports, ignored by Git
```

Each project cluster is five notes plus any specialized ones you ask for:

| Note | Holds |
| --- | --- |
| `Capsule` | the compressed must-remember summary an agent reads first |
| `Hub` | navigation and cluster boundary |
| `Context` | identity, definitions, scope |
| `Decisions` | confirmed choices and corrections |
| `Rules` | constraints on future behavior |
| `Architecture` / `Flow` / `Visual Direction` / `Content Guidelines` | optional domain depth |

The point of the layering is token economy: an agent reads the Recall Map, then one Capsule, and only goes deeper when the task actually needs authority or detail.

### What a project is, and who may hear about it

Two optional fields on each project in `vulcanus.json` carry what a note cannot enforce:

| Field | Values | Answers |
| --- | --- | --- |
| `kind` | `umbrella`, `product`, `lab`, `service-brand`, `client`, `client-product` | what this project *is*, so an agent knows how to place and summarize it |
| `visibility` | `public`, `private` | whether an agent may name this project outside the vault |

`init` and `add project` ask for both, and `visibility` is recorded either way — "nobody has said" and "the operator said public" are different states, and only one of them is safe to act on. `recall` returns the marker and, for a private project, an instruction not to name it in anything public. `doctor` warns on a value it does not recognize rather than failing the vault, because a typo like `privte` would otherwise read as public to every agent.

This is a signal, not access control: nothing here encrypts or hides a file.

### Notes you keep yourself

The generated system layer is a fixed list, so a note you write under the system
directory would otherwise read as unmanaged, and the System Hub linking it would
read as over-linked — two findings for doing nothing wrong. `systemNotes` in
`vulcanus.json` names those notes:

```json
{ "systemNotes": ["Release Notes", "Semantic Index Strategy"] }
```

They are branded like every other system note, so `Release Notes` resolves to
`<Vault> Release Notes` in a branded vault. Declaring one only makes the vault
aware of it: the note is never created, never rewritten, and `update` leaves it
alone. The System Hub may link it, `sync` adds the bullet if it is missing, and
a note declared but never written is reported so the declaration cannot quietly
point at nothing. A system note nobody declared is still reported as unmanaged.

## The first question is import

Before anything else, Vulcanus offers to read an existing AI history and propose your project tree from it:

| Source | What it reads |
| --- | --- |
| ChatGPT data export | `conversations-000.json` … split batches |
| Claude.ai data export | `conversations.json` + `projects.json` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/**/rollout-*.jsonl` |
| Gemini CLI | `~/.gemini/tmp/**/logs.json` and saved `checkpoint-<tag>.json` chats |
| Cursor | per-workspace chat history (`state.vscdb`), read through the built-in `node:sqlite` |
| Markdown folder | any directory of notes — the folder names become the project signal |

Locations are auto-detected, so usually you just pick one from a list. A Markdown folder is the exception: it is never probed on its own, and only scanned when you name the path.

Re-running `import` on the same source proposes only what is new — conversation ids already read are remembered in the vault's state directory. `--all` re-reads everything. `--json` prints the candidates with their evidence and writes nothing.

**Nothing from your history is copied into the vault unless you accept it.** Conversations are read locally, reduced to candidate project names with evidence counts, and discarded. Only the names you tick become notes; the Import Log records how many conversations were scanned, never their content.

Names the source itself grouped conversations under — a Claude project, a repository directory — are the strong signal and come pre-checked. Names inferred purely from title frequency are proposals and start unchecked.

### Decisions you already made

Your history usually holds more than project names: the choices you settled and the rules you kept repeating. After the project step, `import` asks whether to look for them (`--memory` says yes up front, `--no-memory` skips the question, and `--memory-only` skips project discovery for a vault that already has its projects).

- Only **your own messages** are read. An assistant's sentence is not your decision.
- Sentences are matched against decision and rule phrases in English, Turkish, German, and Spanish — "we decided", "from now on", "karar verdik", "ab sofort", "a partir de ahora" — and ranked by how strong the phrase is, how many conversations repeat it, and how recent it is. Questions and code are ignored.
- A conversation counts toward a project when its source grouped it there or its title names the project. Body mentions do not.
- What the vault already records is dropped. A candidate that looks like a revision of a live decision is offered as its **replacement**, so the old one is marked rather than contradicted (see [When a decision changes](#when-a-decision-changes)).
- You review each candidate: accept as decision, accept as replacement, accept as rule, edit the wording, skip, or stop. At most 15 per project per run. Nothing is accepted unattended — `--json` with `--memory-only` reports counts only.
- What you accept is written in the wording you accepted, with a `source:: import · <source> · <date>` line. Skipped candidates are discarded, and reviewed conversations are remembered so they are not proposed again (separately from project discovery, so one never hides conversations from the other).

`--ai-extract [cli]` hands the candidate sentences — not transcripts — to an installed AI CLI to merge duplicates, drop noise, and tighten wording, after showing you what will be sent. Anything it returns that does not trace back to a sentence it was given is discarded.

## Commands

```bash
vulcanus init            # create a vault, or add memory to an existing Obsidian vault (default command)
```

```bash
vulcanus status          # one-screen vault health: projects, notes, doctor result, git state
```

```bash
vulcanus stats           # token budget: what a cold-start agent reads, what recall saves
```

```bash
vulcanus doctor          # validate the vault against its manifest; reports known-pattern secrets as file:line kind (allow with .vulcanus-allow)
```

```bash
vulcanus review          # notes whose review is overdue, oldest first (--ok <note> marks one reviewed)
vulcanus drift [project] # notes that claim paths or npm scripts the project's code no longer has
vulcanus scan [--fix|--allow <file:line>] # secrets in notes; prints file:line type, never the value
vulcanus rules link <project> --root <dir> [--write]  # put the Capsule rules into the code repo (dry run by default)
vulcanus rules check --root <dir> [--json]            # copies that differ, paths or scripts that are gone
vulcanus emit [project] [--dry-run | --check]         # write current Capsule and rules into the repo's agent files
```

```bash
vulcanus add project     # add projects and wire them into the graph
```

```bash
vulcanus project remove "Name"        # unlink a project; its notes move to _archive/
vulcanus project rename "Old" "New"   # folder, notes, and every link, in one move
vulcanus project archive "Name"       # mark it archived (--restore undoes it)
```

```bash
vulcanus import          # propose more projects from an AI export or a notes folder
```

```bash
vulcanus serve           # serve the vault to MCP clients: recall, search, append_decision, …
```

```bash
vulcanus agents          # print the block that makes your AI tools use the vault
```

```bash
vulcanus skills          # agent skills that run these commands for you
```

```bash
vulcanus update          # bring the vault up to date with a newer CLI
```

```bash
vulcanus sync "topic"    # validate, then commit and push
vulcanus sync --watch    # regenerate and revalidate on every edit; never commits
```

```bash
vulcanus hooks install   # a pre-commit hook that refuses a broken graph or stale emitted agent files
```

```bash
vulcanus completion zsh  # completion script for bash | zsh | fish | pwsh
```

`init` accepts `--lang en|tr|de|es`, `--ai [cli]`, and a target directory; `add project` and `import` accept `--ai [cli]`; `status` and `stats` accept `--json`; `review` accepts `--ok <note>` and `--json`; `doctor` accepts `--repair`, `--code <dir>`, and `--json`; `harvest` accepts `--since`, `--code <dir>`, and `--json`; `drift` accepts `--root <dir>` and `--json`; `import` accepts `--source`, `--path`, `--ai-group [cli]`, `--memory`, `--no-memory`, `--memory-only`, `--ai-extract [cli]`, `--json`, and `--all`; `update` accepts `--dry-run`, `--force`, `--profile core|full`, and `--json`; `sync` accepts `--dry-run`, `--json`, and `--watch`; `skills` accepts `--raw`, `--install`, and `--force`.

`--verbose` and `--quiet` work on every command, and `--json` implies quiet so machine-readable output owns stdout.

Exit codes are part of the contract: `0` the command did what it said, `1` the vault or the operation failed validation, `2` the command was used wrongly (no vault, bad flag), `130` cancelled at a prompt. Every failure prints what happened, why, and what to do next.

### Checking notes against the code

`vulcanus drift [project]` compares what a project's Capsule, Rules, and Decisions say with the project's source folder. It reads two kinds of claim, only when they are written as code (an inline backtick or a fenced block): a relative file or folder path, and `npm run <script>` / `npm test` / `npm start`. URLs, globs, wikilinks, absolute paths, and paths that leave the folder (`../`) are ignored, and so is any section the lifecycle has superseded or expired. A path is checked against the project root, a script against the `scripts` of the root `package.json`. It is a heuristic with no LLM: prose is never judged, and a bare `a/b` only counts as a path with an extension, a trailing slash, a leading `./`, or three segments.

The source folder comes from the project's optional `root` in `vulcanus.json` (absolute, or relative to the vault), or from `--root <dir>` for one run. Without a project name, every project that has a `root` is checked.

```json
{ "id": "alpha", "name": "Alpha", "root": "../alpha-src" }
```

```text
$ vulcanus drift Alpha
┌  drift — ATLAS
│
●  Alpha  (/work/alpha-src)
│  ✖ 02_Projects/Alpha/Alpha Capsule.md:8  `config/app.json` — path not found under the project root
│      supersede "## Layout": write its replacement, then add under it: superseded-by:: [[Alpha Capsule#<replacement heading>]]  superseded-on:: 2026-06-01
│  ✖ 02_Projects/Alpha/Alpha Capsule.md:11  `npm run ship` — package.json has no "ship" script
│      supersede "## Layout": …
│
└  2 stale claims. Nothing was written; the supersede lines are suggestions.
```

In CI or a git hook, run `vulcanus drift <project>` from inside the vault and let the exit code gate: `0` passes, `1` blocks. Pass `--root <dir>` when the source folder is not the one in `vulcanus.json`.

Exit codes: `0` no drift, `1` at least one stale claim, `2` the project has no root (the error shows how to set one), the folder is missing, or the project is unknown. `drift` never writes a file; `--json` prints each finding with its note, line, claim, reason, and the suggested `supersede` fields.

### Notes that go stale (Tazelik denetimi)

Opt in with `"freshness": { "staleAfterDays": { "decisions": 180 } }` in `vulcanus.json` (note `type` to days). A note then carries `reviewed: 2026-11-01` and, to override the default, `stale_after: 60`. `doctor` warns `STALE-NOTE` when the review is older than that, `DEAD-PATH` when a relative path written as code does not exist (vault root, then the project's `root`), and `FRESHNESS` for an unreadable field. All are warnings; the exit code does not change. `vulcanus review` lists the stale notes, oldest first; `vulcanus review --ok "<note>"` sets `reviewed:` to today and touches nothing else. MCP `recall` (on the capsule and each read-next note) and `search` (on each hit) carry `status: fresh | stale | dead-ref | unknown`; a note without `reviewed:` is `unknown`, never an error. `stats` prints the stale count. Without the field, none of this runs, and `recall` and `search` answer as before. See [docs/design](docs/design/note-freshness.md).

#### Tazelik denetimi: try it on your vault

Manifest (`vulcanus.json`):

```json
"freshness": { "staleAfterDays": { "decisions": 180, "capsule": 90 } }
```

Note frontmatter (both optional):

```yaml
# the day a person last checked the note
reviewed: 2026-11-01
# days; replaces the manifest default for this note
stale_after: 60
```

Four commands:

```bash
vulcanus doctor                          # STALE-NOTE and DEAD-PATH show up as warnings
vulcanus review                          # stale notes, longest unreviewed first
vulcanus review --ok "<Project> Decisions"   # after you checked it: reviewed: today, nothing else changes
vulcanus stats                           # "stale notes" line; then ask your agent to recall the project and read each note's status
```

A project's own notes look for a relative path in the vault and in the project's `root`; set `root` first or code paths read as dead.

### Decisions from your commits

`vulcanus harvest` reads the commit messages of a code repository and offers the ones that give a reason as decisions. Git runs locally through `execFile` (no shell, no network, no GitHub API).

- `--since 30d` (the default) reads the last N days; `--since <tag>` reads everything after a tag or commit. `--code <dir>` names the repository; without it the `root` your projects share is used.
- A commit counts when its title or body says why: `because`, `instead of`, `revert`, `neden`, `yerine`, `weil`, `statt`, `porque`, `en lugar de`, and the decision phrases `import` already knows. Scoring, the 15-per-project cap, and the review are the import inbox's.
- A commit belongs to a project when the first directory of every file it changed is that project's id or name. When that is not certain, you pick the project; a project is never created from a directory name.
- A candidate the vault already records is marked *already recorded*, and one that looks like a revision is marked *may replace*.
- What you accept is written as the wording you accepted plus `paths::`, `commit::`, and `source:: harvest · git · <date>`. The commit body is never written. At the end it prints "N candidates, M accepted"; `--json` prints only those counts.

#### CODE-DRIFT

`doctor` checks every live section that has both `commit::` and `paths::`: it compares those paths between the commit and `HEAD` with `git diff --ignore-all-space --ignore-blank-lines`. A difference is a `CODE-DRIFT` warning naming the section and the changed files; a change in whitespace or blank lines is not one. A commit that is not in the repository is reported as *could not verify*. Only committed code counts: edits not yet committed are not compared.

```text
$ vulcanus harvest          # accept the candidate
$ git commit -am "Raise cache ttl"
$ vulcanus doctor
│  CODE-DRIFT
│  ▲ 02_Projects/Meridian/Meridian Decisions.md: "Cache on disk" : code changed since 262a6fe in meridian/cache.txt; verify it still holds
└  PASS — 14 notes · 60 links · 0 errors · 1 warnings
```

`recall` lists such sections under `lifecycle.codeChanged`, and `search` marks their hits `codeChanged: true`, so an agent knows to check before relying on them. The code repository is found from the project's `root` (the field `drift` already uses) or from `doctor --code <dir>`; see [docs/design](docs/design/harvest-and-code-drift.md).

### One instruction file for every tool

`vulcanus bridge` mirrors `AGENTS.md` into the files other tools read: `CLAUDE.md` and `GEMINI.md` import it with `@AGENTS.md`; `.github/copilot-instructions.md` and `.cursor/rules/agents.mdc` get a generated copy that starts with a `vulcanus:bridge` marker. It prints a diff and exits `1` when something would change; `--write` writes, `--json` prints the result. A file without the marker is yours and is never overwritten. It needs no `vulcanus.json`.

`doctor` checks these files too (in a folder with only an `AGENTS.md`, it runs just these checks):

- `INSTRUCTION-SOURCE`, `INSTRUCTION-STALE` (errors): a bridge file whose source is gone, no longer imported, or whose copy no longer matches `AGENTS.md`. Fix: `vulcanus bridge --write`.
- `EMIT-STALE` (warning), `EMIT-MISSING` (info): see [Current rules in every agent file](#current-rules-in-every-agent-file).
- `INSTRUCTION-BUDGET` (warning): the file Codex reads (`AGENTS.override.md` if non-empty, else `AGENTS.md`) is larger than 32 KiB, Codex's default `project_doc_max_bytes`; Codex cuts the rest off.
- `INSTRUCTION-CONFLICT` (warning): `AGENTS.md` and a hand-written `CLAUDE.md`, `GEMINI.md`, Copilot or Cursor file name different package managers (`npm`, `pnpm`, `yarn`, `bun`) or different test runners (`vitest`, `jest`, `mocha`, `pytest`). It shows both files and lines. Only these known words are compared; fenced code blocks, lines with "not", "never", "instead of", and a file that names two tools are skipped. `npm test` against `vitest` is not a conflict.

`status` shows `instruction files: consistent` or `N drifted`, counting all four codes.

### Current rules in every agent file

`vulcanus emit [project]` writes a project's Capsule and Rules sections that still hold into the agent files of its code repository, as one managed block between `<!-- vulcanus:begin -->` and `<!-- vulcanus:end -->`:

| File | What the block holds |
| --- | --- |
| `AGENTS.md` | the content (the source the others point at) |
| `CLAUDE.md` | `@AGENTS.md` |
| `.cursor/rules/vulcanus.mdc` | the content, in a rule file with `alwaysApply: true` |
| `.github/copilot-instructions.md` | a copy of the content |

- Only the inside of the block is ever written. Text outside it is kept byte for byte. A file with no markers gets the block appended; a missing file is created. Either one is shown as a diff and needs your yes, so with no terminal nothing is written unless you pass `--yes` (`--dry-run` still shows the difference). Updating a block that is already there needs no question.
- A section that is superseded (`superseded-by::`) or past `valid-until::` is left out, the same way `doctor` reads lifecycle. `Read Next` and the lifecycle field lines are left out too, and wikilinks keep only their label.
- A project marked `visibility: private` is not written (`--include-private` overrides). Lines that name a private project in another project's notes are dropped.
- The repository is the project's `root` in `vulcanus.json`, or `--repo <dir>`. With no project name, `emit` handles every project that has a `root`.
- `--dry-run` shows the difference and writes nothing. `--check` writes nothing and exits `0` when every file is current; it exits `1` and lists the files that are stale, missing, or have no block.
- The output is the same for the same notes and the same day. A `CLAUDE.md` that already has an `@AGENTS.md` line (for example from `bridge`) counts as current.
- `vulcanus doctor` reports `EMIT-STALE` (warning) when a block fell behind the notes, a file went missing or its markers are damaged, and one `EMIT-MISSING` info line for a repository `emit` never wrote to.
- `vulcanus hooks install` also makes the pre-commit hook run `vulcanus emit --check --emitted-only`: a stale copy stops the commit. Repositories `emit` never wrote to are skipped, so projects that do not use `emit` are not blocked.
- To support another tool, add one file under `src/emit/templates/` and list it in `index.ts`.

### Scripting `init`

Every wizard question can be answered from a flag, so `init` also runs without a TTY — in CI, containers, or an agent's shell. A flag skips exactly its question; `--defaults` answers everything else with the default, and `--dry-run` prints the tree that would be created without writing:

```bash
vulcanus init ./vault --name ATLAS --operator Ada --projects "Meridian, Harbor" --defaults -y
vulcanus init ./vault --name ATLAS --defaults --dry-run   # look before you leap
```

The full set: `--name`, `--full-name`, `--tagline`, `--naming branded|generic`, `--profile core|full`, `--operator`, `--role`, `--aliases`, `--projects`, `--no-import`, `--git` / `--no-git`, `--defaults`, `--dry-run`.

## Filling the project notes

Whenever projects are added — by `init`, `add project`, or `import` — Vulcanus asks how their notes should get their content: answer the questions here, skip and write them yourself later, or hand the job to an AI CLI already installed on your machine.

The AI path probes your PATH for `claude`, `codex`, `cursor-agent` (also installed as `agent`), and `gemini`, offers only what is really there, and asks where each project's source code lives — proposing the directories your past Claude Code and Codex sessions ran in. Before anything starts it tells you which CLI is taking over your terminal, in which directory, and exactly which notes it has been told to write. Nothing is spawned without your confirmation, and that confirmation cannot be suppressed by a flag.

The short structural questions — hierarchy, grouping, which specialized notes to create — are asked in the terminal either way. They decide the folder layout and the generated system notes, and they have to be settled before a single file exists, while the AI session only starts once the notes are there. What the AI takes over is the note bodies, which is where the work actually is.

The CLI is asked to study the codebase, question you about what the code cannot answer, and write the cluster's notes to the vault's conventions. When the session exits, `doctor` runs immediately, so an edit that broke the graph is reported rather than discovered later.

## Making agents actually use it

A vault nobody reads is a folder, so the enforcement layer ships with it.

Agents working **inside** the vault are already covered: `AGENTS.md` carries the full protocol, `CLAUDE.md` points Claude Code at it, and `.cursor/rules/vault.mdc` does the same for Cursor.

For everywhere else — other repositories, ordinary chat — run `vulcanus agents`. It prints a block naming your vault, its path, and its operator, to paste into a tool's *global* instructions:

| Tool | Where it goes |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Cursor | Settings → Rules → User Rules |
| ChatGPT | Settings → Personalization → Custom instructions |
| Gemini CLI | `~/.gemini/GEMINI.md` |

`vulcanus agents --raw` prints the snippet alone, so it can be appended straight to a file. Every generated vault also contains `USING-WITH-AI.md` with the same guidance.

## Skills

Instructions are prose a model may or may not honour. A skill is a capability it can invoke, so "sync the vault" runs the real `vulcanus sync` instead of the model improvising an equivalent. Vulcanus writes one skill per vault operation, plus a recall skill that carries the Recall Map → Capsule → Hub → Context/Decisions/Rules routing:

| Skill | Runs |
| --- | --- |
| `<vault>-recall` | nothing — it teaches the read order and the authority rules |
| `<vault>-doctor` | `vulcanus doctor`, and `--repair` when structure is missing |
| `<vault>-sync` | `vulcanus sync --dry-run`, then `vulcanus sync "topic"` |
| `<vault>-add-project` | `vulcanus add project "Name"` |
| `<vault>-import` | `vulcanus import` |
| `<vault>-update` | `vulcanus update --dry-run`, then `vulcanus update` |

Skills follow the [Agent Skills](https://agentskills.io) format: a directory per skill holding a `SKILL.md` with `name` and `description` frontmatter. The description is what decides whether a model reaches for the skill at all, so each one names the vault, the operator, and the phrasings that should trigger it.

Every vault ships its skills twice — `.claude/skills/` for Claude Code, `.agents/skills/` for Codex, Cursor, and Gemini CLI, which all read that vendor-neutral directory. Two copies of one text, versioned with the vault, so an agent opening the repository can act on day one. Tools without a skill mechanism keep the prose path; this adds a channel rather than replacing one.

That only covers agents working *inside* the vault, and the point of a second brain is recall from everywhere else. For that the skills have to live in your home configuration, which Vulcanus will not do behind your back:

```bash
vulcanus skills --install
```

That writes them to `~/.claude/skills/` and `~/.agents/skills/`, with your vault's real path baked in so an agent in another repository knows where to run. It is the only thing Vulcanus writes outside the vault, it never happens during `init`, and it leaves existing files alone unless you pass `--force`. `vulcanus skills` on its own explains what would be installed; `--raw` prints the files.

`sync` pushes to a remote and `update` rewrites files, which is a lot of consequence for one sentence of chat. Both skills instruct the agent to show the `--dry-run` output and get your confirmation in that conversation first, and every skill is told to report the command's actual output and exit code rather than reporting success. Skills are managed files, so `doctor --repair` and `update` bring template improvements to existing vaults.

## MCP server

`vulcanus serve` turns the vault into structured memory for any MCP client — Claude Code, Cursor, or your own agent runtime — instead of ad-hoc file reads:

| Tool | Does |
| --- | --- |
| `recall` | returns a project's Capsule plus the read-next list — the protocol's entry point — and names any decisions or rules that are superseded or expired |
| `search` | layer-aware text search; Capsule and Recall Map hits rank first, hits in superseded or expired sections rank last and say so |
| `list_projects` | the routing table: names, statuses, trigger words, capsule paths |
| `append_decision` | records a confirmed decision in the Decision/Details format; with `supersedes`, also marks the decision it replaces; with `paths` (and `commit`), writes `paths::` and `commit::` so `doctor` and `recall` can flag CODE-DRIFT |
| `append_rule` | records a standing rule in the project's Rules note; with `supersedes`, also marks the rule it replaces |
| `update_capsule` | replaces one section of a Capsule — never a blind whole-file rewrite |
| `vault_status` | the `vulcanus status` summary, as JSON |
| `doctor` | full structural validation with every finding |

Register it the way your client expects, e.g. for Claude Code:

```bash
claude mcp add vulcanus -- vulcanus serve
```

Run it from inside the vault (or any subdirectory), or pass `--cwd` when the client starts elsewhere. Registering it globally is fine: the server starts anywhere, and in a directory with no vault the tools say so instead of the server failing to come up. The manifest and the vault location are both resolved on every call, so a vault created — or edited — while the server runs is visible immediately.

`recall` also tells the truth about its own freshness: when a Capsule is older than the Decisions, Rules, or Context beneath it, the answer carries a staleness warning instead of presenting an outdated summary as current.

## Obsidian

The vault is a valid Obsidian vault the moment it exists — no plugin, no import. Open the folder and the graph is there, with shortest-path wikilinks and rename-safe links already configured.

Already keep an Obsidian vault? Run `init` inside it and Vulcanus adds the memory structure to that vault instead of creating a separate one beside it — a directory with a `.obsidian` folder, in the current directory or an immediate subdirectory, is detected automatically. A single detected vault is used without asking, and its identity is taken from the folder, so there is no vault name to answer; only a choice between several vaults is ever put to you. Your own notes are never overwritten — generated files are written only where nothing exists — and if the folder is already a Vulcanus vault, `init` stops and points you to `add project` or `update`.

The graph view doubles as a health check: projects appear as clusters, hubs at their centers, and an unlinked note stands out immediately. Edits made in Obsidian are plain Markdown, so the CLI and your agents pick them up straight away, and `vulcanus doctor` keeps hand edits, agent edits, and generated structure consistent.

## Staying current

`vulcanus.json` records the CLI version that last wrote the vault. When a newer CLI runs against an older vault, `doctor` warns and `vulcanus update`:

- runs any manifest schema migrations
- refreshes the files the CLI owns, so template improvements reach existing vaults
- creates notes a newer version added (including a `--profile full` upgrade)
- re-stamps the generator version and validates the result

Your own notes are never rewritten — `update` reports how many it left untouched. That includes the Index, the hubs, and the Import Log: they hold what you wrote, so a new project or a deeper system layer is *linked in* rather than regenerated. `AGENTS.md` is merged — sections you added stay, sections the protocol adds arrive. `--dry-run` shows the plan first, and notes the manifest no longer describes are listed rather than deleted. A vault written by a *newer* CLI is refused outright instead of being downgraded.

After a command, the CLI checks npm at most once a day and prints a one-line notice when a newer release exists. Set `VULCANUS_NO_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER`, or run in CI) to turn it off; it fails silently offline.

## Secret scanning (Blackbar)

A safety net for keys that end up in memory by accident. It matches known patterns only: cloud and
token prefixes (AWS, GitHub, npm, Stripe, Slack, Google, LLM keys), JWTs, private-key blocks,
passworded database URLs, `Authorization: Bearer`, command-line and `password=` values (unquoted,
quoted, or with escaped quotes), and a high-entropy value next to `password`, `secret`, `token` or
`api_key`. A clean result does not mean there is no secret.

**Tarama bir güvenlik ağıdır; sızan anahtarı yenilemenin (rotation) yerine geçmez.** A key that reached a note, a commit or a chat is exposed: rotate it, then clean up.

### Where it runs

- `vulcanus scan` reads every note in the vault, prints `file:line type` (never the value) and exits 1 when a certain match is found.
  - `--fix` shows each line as it would become, `[REDACTED:<type>]` in place of the value, and writes only after you confirm in a terminal.
  - `--allow <file:line>` records the findings on that line as false positives in `.vulcanus-allow`.
- `import` and `harvest` flag a candidate that holds a secret (kind and line, never the value) and write it masked, as `[REDACTED:github-token]`. The terminal and the ledger never show the raw value.
- MCP `append_decision`, `append_rule` and `update_capsule` refuse content with a secret and write nothing; the error names the kind and line, not the value.
- `vulcanus doctor` reports each match as a `SECRET` finding (`file:line kind`) and exits non-zero.
- `vulcanus hooks install` adds a pre-commit hook that stops a commit when the staged content has a match; a key removed from the working tree but still staged is still refused. An existing hook that Vulcanus did not write is never overwritten. Bypass once with `git commit --no-verify`.

### .vulcanus-allow

Accept a false positive in `.vulcanus-allow` at the vault root, one per line, with a reason (without one the line is an error). The file stores a location or a hash of the value, never the value itself:

```
02_Projects/Alpha/Alpha Capsule.md:12:github-token # documented example, not a real key
0123456789ab # same value anywhere; 12-hex fingerprint is in `doctor --json`
```

`scan --allow` writes a `sha256:<hash> <type>` line instead. Only `scan` reads that form; `doctor`, the hook, import and MCP do not, and `doctor` reports it as `SECRET-ALLOW`. Until the two forms are unified, prefer the reasoned entries above.

## Validation

`vulcanus doctor` is the part that keeps a growing vault honest. Every check is derived from `vulcanus.json`, so it stays correct as your tree changes:

- frontmatter completeness (`type`, `project`, `status`, `tags`) and duplicate or empty keys
- every wikilink resolves, and resolves to exactly one note
- every hub links to the notes the manifest says it owns
- every project note links back to its own hub
- every project has a Capsule reachable from the Recall Map
- no duplicate or case-colliding note names
- raw exports and generated state are actually ignored by Git
- `AGENTS.md` describes the agent protocol this CLI writes, not a superseded one
- the skill copies in `.claude/skills/` and `.agents/skills/` have not drifted apart
- every `supersedes::` / `superseded-by::` link points at a real heading, both sides agree, and nothing supersedes itself in a loop
- no decision is past its `valid-until::` date while still presented as current, and no Capsule links one that is

Missing structure is an error; extra hand-added links are a warning, because a vault is meant to be written in.

### When a decision changes

A decision that stops being true is not deleted — it is history, and "why did we stop doing X" is a fair question. It is marked instead, with fields under its heading:

```md
## Usage-Based Pricing

supersedes:: [[Acme Decisions#Flat Pricing]]

### Decision

Price per active seat.
```

```md
## Flat Pricing

superseded-by:: [[Acme Decisions#Usage-Based Pricing]]
superseded-on:: 2026-10-05
```

A decision that holds only until a date carries `valid-until:: 2026-12-31`. The keys are English in every vault language; they are fields, not prose. The same fields work on rules.

Write one side and `vulcanus doctor --repair` adds the other — it inserts the missing back-reference and touches nothing else. `append_decision` and `append_rule` write both sides in one call when given `supersedes`, and refuse, writing nothing, when the target does not exist or is already superseded. `recall` lists what is no longer current so an agent skips it, `search` ranks it last, and `vulcanus status` counts it.

`vulcanus sync` refuses to commit while errors remain, and reports the push result exactly as it happened.

## Editing safety

Generated files fall into three classes:

- **seed** — everything that can hold what you wrote: every project note, the Recall Map, the Index, every hub, and the Import Log. Written once, never overwritten. Adding a project or deepening the system layer inserts the missing links surgically instead of regenerating the file around them.
- **managed** — files the CLI fully owns: `CLAUDE.md`, the Cursor rule, and the generated skills. `doctor --repair` rewrites these.
- **merge** — `AGENTS.md` alone. It has to be both: the protocol every agent reads, so a new step must reach existing vaults, and a file you extend with instructions of your own. An update keeps every section you already have, inserts the ones the protocol added, and refreshes its version stamp. Wording changes to a section you customized will not reach you — losing your customization would be worse.

`--force` still rewrites everything, including your own notes. It is the only flag that does.

## Vault naming

The vault name you choose becomes the vault's identity: with the default `branded` naming, system notes are `ATLAS Index.md`, `ATLAS Recall Map.md`, and so on, and the vault folder is named after it — so Obsidian opens it under that name. Choose `generic` naming for portable `Index.md` / `Recall Map.md` filenames instead.

The generated vault is Obsidian-ready: shortest-form wikilinks, links that follow renames, and workspace files kept out of Git.

## Development

```bash
npm install && npm run build && npm test
```

```bash
npm run dev -- doctor
```

Source layout: `manifest/` derives every path and link expectation, `generate/` turns that plan into Markdown, `doctor/` validates the result against the same plan, `importers/` normalizes AI exports, `mcp/` holds the transport-free vault operations `serve` exposes, and `commands/` wires it to the CLI.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the checks, the review bar, and how to add an importer or a language. [`docs/token-budget.md`](docs/token-budget.md) measures what the layered structure actually saves, and how that was measured.

The landing page for [vulcanus.sunsato.com](https://vulcanus.sunsato.com) lives in `site/` — a single static file served by Cloudflare Workers as static assets (`wrangler.jsonc`). It reaches production through a promotion chain: each release is packaged once, tested on a webtest copy closed to search engines, and only that tested package goes live after approval. Releases run the full CI matrix before publishing and smoke-test the published package afterwards; [`CONTRIBUTING.md`](CONTRIBUTING.md) has the details.

## License

MIT © Sunsato
