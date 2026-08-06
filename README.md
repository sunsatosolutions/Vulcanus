# Vulcanus

Vulcanus builds and maintains an **AI-readable second brain** — a Git-versioned vault of linked Markdown that humans and AI agents can both read, so an agent can resume work with reliable context instead of starting cold.

You answer a few questions, and Vulcanus writes the whole vault — routing layer, operator profile, agent protocol, and one memory cluster per project — then validates that the graph actually holds together. Already keep an Obsidian vault? It adds the memory structure to that vault instead of creating a separate one.

A [Sunsato](https://sunsato.com) product · [vulcanus.sunsato.com](https://vulcanus.sunsato.com)

```bash
npx @sunsato/vulcanus
```

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

## The first question is import

Before anything else, Vulcanus offers to read an existing AI history and propose your project tree from it:

| Source | What it reads |
| --- | --- |
| ChatGPT data export | `conversations-000.json` … split batches |
| Claude.ai data export | `conversations.json` + `projects.json` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/**/rollout-*.jsonl` |

Locations are auto-detected, so usually you just pick one from a list.

**Nothing from your history is copied into the vault.** Conversations are read locally, reduced to candidate project names with evidence counts, and discarded. Only the names you tick become notes; the Import Log records how many conversations were scanned, never their content.

Names the source itself grouped conversations under — a Claude project, a repository directory — are the strong signal and come pre-checked. Names inferred purely from title frequency are proposals and start unchecked.

## Commands

```bash
vulcanus init            # create a vault, or add memory to an existing Obsidian vault (default command)
```

```bash
vulcanus status          # one-screen vault health: projects, notes, doctor result, git state
```

```bash
vulcanus doctor          # validate the vault against its manifest
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
vulcanus import          # propose more projects from an AI export
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
```

`init` accepts `--lang tr|en`, `--ai [cli]`, and a target directory; `add project` and `import` accept `--ai [cli]`; `status` accepts `--json`; `doctor` accepts `--repair` and `--json`; `update` accepts `--dry-run`, `--force`, `--profile core|full`, and `--json`; `skills` accepts `--raw`, `--install`, and `--force`.

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
| `recall` | returns a project's Capsule plus the read-next list — the protocol's entry point |
| `search` | layer-aware text search; Capsule and Recall Map hits rank first |
| `list_projects` | the routing table: names, statuses, trigger words, capsule paths |
| `append_decision` | records a confirmed decision in the Decision/Details format |
| `vault_status` | the `vulcanus status` summary, as JSON |
| `doctor` | full structural validation with every finding |

Register it the way your client expects, e.g. for Claude Code:

```bash
claude mcp add vulcanus -- vulcanus serve
```

Run it from inside the vault (or any subdirectory). The manifest is re-read on every call, so edits made while the server runs are always visible.

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

Your own notes are never rewritten — `update` reports how many it left untouched. `--dry-run` shows the plan first, and notes the manifest no longer describes are listed rather than deleted. A vault written by a *newer* CLI is refused outright instead of being downgraded.

After a command, the CLI checks npm at most once a day and prints a one-line notice when a newer release exists. Set `VULCANUS_NO_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER`, or run in CI) to turn it off; it fails silently offline.

## Validation

`vulcanus doctor` is the part that keeps a growing vault honest. Every check is derived from `vulcanus.json`, so it stays correct as your tree changes:

- frontmatter completeness (`type`, `project`, `status`, `tags`) and duplicate or empty keys
- every wikilink resolves, and resolves to exactly one note
- every hub links to the notes the manifest says it owns
- every project note links back to its own hub
- every project has a Capsule reachable from the Recall Map
- no duplicate or case-colliding note names
- raw exports and generated state are actually ignored by Git

Missing structure is an error; extra hand-added links are a warning, because a vault is meant to be written in.

`vulcanus sync` refuses to commit while errors remain, and reports the push result exactly as it happened.

## Editing safety

Generated files fall into two classes:

- **managed** — `AGENTS.md`, the Index, hubs that are pure navigation, the Import Log, and the generated skills. `doctor --repair` rewrites these.
- **seed** — everything holding actual memory, including the Recall Map and every project note. These are written once and never overwritten. Adding a project appends a route and a sub-project link surgically instead of regenerating the file.

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

Source layout: `manifest/` derives every path and link expectation, `generate/` turns that plan into Markdown, `doctor/` validates the result against the same plan, `importers/` normalizes AI exports, and `commands/` wires it to the CLI.

The landing page for [vulcanus.sunsato.com](https://vulcanus.sunsato.com) lives in `site/` — a single static file with no build step, deployed by Cloudflare Pages from `site/` on every push to `main`.

## License

MIT © Sunsato
