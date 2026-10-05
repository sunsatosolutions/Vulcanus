# Design: decision lifecycle and the import memory inbox

Status: **approved 2026-10-05, shipping together in 0.6.0.** Two features, one shared idea: memory that
knows when it stopped being true, and an import that proposes memory rather
than only project names.

- **A. Decision lifecycle** — decisions can supersede each other and expire;
  `doctor` checks the chain, `recall` and `search` stop presenting dead
  decisions as live ones.
- **C. Memory inbox** — `vulcanus import` extracts candidate decisions and rules
  from the operator's own messages; nothing reaches a note until the operator
  accepts it.

A is built first inside the release. C builds on it: an imported candidate that contradicts an
existing decision is offered as a supersession, not as a duplicate.

Prior art: temporal knowledge graphs (Zep/Graphiti) attach `valid_at` /
`invalid_at` to every fact and let retrieval include or exclude expired facts.
That is the part borrowed here. Their write path — an agent updating the graph
on its own — is the part deliberately not borrowed; see
[Non-goals](#non-goals).

---

## Problem

Today a correction is prose. When a decision changes, the operator (or an
agent) appends a new `## Heading` to the Decisions note and maybe writes
"replaces the above" in a sentence. Nothing machine-checkable connects the two,
so:

1. An agent reading the Decisions note sees both and has to guess which is
   current. Appended order is the only hint, and agents do not reliably honour
   it.
2. The Capsule can keep summarising the old decision indefinitely. `status`
   catches a Capsule older than its Decisions note, but not a Capsule that is
   newer and still wrong.
3. Time-bounded decisions ("launch pricing until end of Q4") have no expiry;
   they silently become false.

And on the import side: `import` reads thousands of the operator's messages,
finds project names, and throws away the part that matters most — the
decisions the operator already stated in those conversations. A new vault
starts with empty Decisions notes even when the history holds dozens.

---

## A. Decision lifecycle

### Syntax

Lifecycle lives in the decision's own section, as inline fields directly under
the heading. Dataview-style `key:: value` is used because it is readable as
plain Markdown, renders in Obsidian, and is trivially parseable.

```md
## Usage-Based Pricing

supersedes:: [[Acme Decisions#Flat Pricing]]

### Decision

Price per active seat, billed monthly.
```

```md
## Flat Pricing

superseded-by:: [[Acme Decisions#Usage-Based Pricing]]
superseded-on:: 2026-10-05

### Decision

One flat price for every plan.
```

```md
## Launch Discount

valid-until:: 2026-12-31

### Decision

40% off the first year for sign-ups before launch.
```

Fields:

| Field | On | Meaning |
| --- | --- | --- |
| `supersedes::` | new decision | wikilink to the heading it replaces |
| `superseded-by::` | old decision | wikilink to the heading that replaced it |
| `superseded-on::` | old decision | ISO date the replacement was recorded |
| `valid-until::` | any decision | ISO date after which it is no longer true |

Rules:

- Keys are fixed English tokens in every vault language, like the `AGENTS.md`
  protocol. They are machine fields, not prose; translating them would make a
  vault unparseable when its language changes. The surrounding note text stays
  localised.
- Targets are heading links (`[[Note#Heading]]`). Same-note links may use the
  short form `[[#Heading]]`.
- The old section is **never deleted or rewritten**. Supersession only adds
  fields. History stays readable, and the Operator Content rule holds.
- The same fields work on `## … Rule` sections in a Rules note, with the same
  checks. Decisions are the main case, so the docs lead with them.

### Parsing

New module `src/memory/lifecycle.ts`, pure functions, no I/O:

```ts
interface DecisionEntry {
  note: string; // vault-relative path
  heading: string; // "## " text, verbatim
  supersedes: LinkRef[];
  supersededBy: LinkRef[];
  supersededOn?: string;
  validUntil?: string;
  line: number;
}

function parseDecisions(path: string, text: string): DecisionEntry[];
function lifecycleState(entry: DecisionEntry, today: string): "live" | "superseded" | "expired";
```

Parsing reuses `visibleMarkdown`, so fields inside code fences and comments are
ignored, the same way wikilinks already are.

### `doctor` checks

`wikiTargets` strips `#heading` today, so heading anchors are never validated.
Lifecycle links are validated fully, because a dangling one is worse than none.

| Code | Level | Condition |
| --- | --- | --- |
| `LIFECYCLE` | error | `supersedes::` / `superseded-by::` target note or heading does not exist |
| `LIFECYCLE` | error | a supersession cycle (A → B → A) |
| `LIFECYCLE` | error | malformed date in `superseded-on::` / `valid-until::` |
| `LIFECYCLE` | warning | one-sided link: A `supersedes::` B, but B has no `superseded-by::` A (or the reverse) |
| `EXPIRED` | warning | `valid-until::` is in the past and the decision is not superseded |
| `STALE-REF` | warning | the project Capsule links to a superseded or expired heading |

`doctor --repair` fixes one-sided links only: it inserts the missing
`superseded-by::` / `superseded-on::` lines under the old heading. It never
removes a field and never touches anything else in the section. Expired and
stale-reference findings need a human decision, so repair leaves them alone.

### MCP surface

- **`append_decision`** gains an optional `supersedes` input: the title of an
  existing decision in the same project. When it is given, the tool writes the
  new section with `supersedes::` **and** adds `superseded-by::` +
  `superseded-on::` under the old heading, in one call. If the old heading does
  not exist, the call fails and nothing is written, so a typo cannot create a
  half-linked pair.
- **`recall`** adds `superseded` and `expired` arrays (heading + replacement)
  for the matched project, so an agent knows which sections to skip without
  reading the whole note.
- **`search`** marks hits inside a superseded or expired section
  (`state: "superseded"`) and ranks them below live hits. They are not hidden,
  because "why did we stop doing X" is a legitimate question.
- `vault_status` reports counts: live, superseded, expired.

### Generated content

- `Update Format` note: a new "Superseding a Decision" section, translated,
  shows both sides of a supersession and `valid-until::`.
- `AGENTS.md`: one new protocol line: when a confirmed decision replaces an
  earlier one, record it with `supersedes::` (or `append_decision` with
  `supersedes`); never delete the old section.
- Skills: the recall skill tells the agent to treat `superseded-by::` and
  expired sections as history; the MCP skill mentions `supersedes` and the
  `lifecycle` list in `recall`.
- **`PROTOCOL_VERSION` 2 → 3.** Existing vaults get the drift warning and pick
  the new protocol up through `vulcanus update`. That is the existing mechanism,
  so no new migration path is needed.

No manifest change. Lifecycle is per-section content, not structure, so
nothing derived from `vulcanus.json` moves.

### Tests

All in `lifecycle.test.ts`:

- parsing (fences and comments ignored, short-form links, multiple fields,
  CRLF), state at boundary dates, real calendar dates, heading comparison;
- field insertion under a heading, after an existing field block;
- analysis: broken targets, whole-note links, cycles reported once, one-sided
  links, expiry, a Capsule linking a superseded heading;
- in a vault: doctor findings, `--repair` inserting only the back-reference and
  idempotent on a second run, `append_decision`/`append_rule` with
  `supersedes`, refused targets writing nothing, `recall` and `search` states.

---

## C. Memory inbox

### Flow

```txt
vulcanus import  (existing)
  └─ choose source → project candidates → accept projects        (unchanged)
  └─ NEW: "Also look for decisions and rules in these conversations?"  [y/N]
        extract   operator's own messages only, per accepted or existing project
        score     cue strength × repetition × recency
        dedupe    against each other and against existing Decisions/Rules
        review    per project: accept / edit / skip, one candidate at a time
        write     accepted → appendDecision / appendRule, with provenance
```

There is also a standalone entry point for vaults that already exist:
`vulcanus import --memory-only` skips project discovery and maps conversations
to existing projects through source grouping (`group`), the AI cluster when
`--ai-group` was used, or the project's name and triggers.

### Extraction (local, deterministic, default)

- **User messages only.** An assistant's sentence is not the operator's
  decision. This also halves what is read.
- Sentence split, then cue matching against the lists in `src/memory/cues.ts`.
  Every locale's cues are matched whatever the vault's language, since people
  switch languages mid-conversation. Examples:
  - decision cues: `we decided`, `let's go with`, `final:`, `karar verdik`,
    `… ile gidiyoruz`, `wir nehmen`, `vamos con`
  - rule cues: `from now on`, `never`, `always`, `do not`, `bundan sonra`,
    `asla`, `her zaman`, `ab jetzt`, `nunca`
  - correction cues: `actually`, `no, it's`, `düzeltme`, `aslında`, which raise
    supersession detection.
- Skip questions (ending in `?`), code, quoted text, and sentences under 4 or
  over 40 words.
- Score = cue weight + log(repetitions across conversations) + recency. The
  same sentence restated in five conversations is the strongest signal.
- Dedupe with folded token-set Jaccard (the folding already used by
  `analyze.ts`): ≥ 0.6 against another candidate merges them. Against the vault
  the measure is coverage (the share of the candidate's words a section holds),
  since a section is much longer than a sentence: ≥ 0.7 drops the candidate as
  already known, including restatements of superseded decisions.
- **Supersession hint:** a candidate whose coverage of a live section of the
  same kind is ≥ 0.35 (≥ 0.25 with a correction cue) is shown as "may replace
  *<heading>*".
  Accepting it as a replacement goes through A's `supersedes` path.
- Cap: 15 candidates per project per run, highest score first. The review is
  meant to take minutes, not an afternoon.

An opt-in `--ai-extract` mirrors the existing `--ai-group`. It hands a digest
to an installed AI CLI under the same disclosure-before-sending rule. The digest
is the heuristic's candidate sentences with their project names, nothing more,
never whole transcripts. The model may only re-rank, merge, or rephrase; every
candidate it returns must trace back to a source sentence id, or it is dropped.

### Review

One prompt per candidate, grouped by project:

```txt
Acme · decision · 3 conversations · last 2026-09-14
  "We're going with usage-based pricing, flat pricing is off the table."
  may replace: Flat Pricing
  › accept as decision   accept as replacement   accept as rule   edit   skip   stop
```

- `edit` opens the text inline before writing, since the accepted wording becomes
  the memory.
- `stop` ends the review and keeps what was accepted so far.
- Nothing auto-accepts candidates. `--json` with `--memory-only` reports counts
  per project only. Accepting memory is always a human act.

### Write

Accepted items go through the existing `appendDecision` / `appendRule`, plus a
provenance line in the section:

```md
## Usage-Based Pricing

source:: import · claude-code · 2026-09-14

### Decision

We're going with usage-based pricing.
```

The Import Log note is unchanged: per-section `source::` is the provenance, and
recording memory counts in the Import Log would have needed a manifest change.

### Privacy and the Import Privacy rule

The current rule says imports are reduced to candidate names with counts and
then discarded, and that raw conversation content is never written to a vault.
C changes that, so the rule was amended explicitly rather than read around.
The amended wording:

> An import may surface sentences from the operator's own messages as memory
> candidates. Candidates live only in memory for the review session. A
> candidate reaches a note only when the operator accepts it, and only in the
> form they accepted, which they may edit. Assistant messages and whole
> transcripts are never written. Nothing leaves the machine unless the
> operator opts in to `--ai-extract` and is shown the digest first.

Default: **no persistence of pending candidates.** Skipped candidates are gone,
and a `memory` scope in the seen ledger — separate from project discovery's —
stops them reappearing on the next incremental run. A review stopped early does
not mark its conversations reviewed. A
persistent inbox (`<stateDir>/inbox.jsonl`, an MCP `propose_decision` that
agents write to instead of `append_decision`) is the natural next step but is
**out of scope** here; see Open questions.

### Tests

All in `memory.test.ts`, with neutral placeholder projects only:

- cue matching per locale (including Turkish suffixed "-le/-la" forms), word
  edges, question/code skipping, user-messages-only;
- repetition scoring, the weight-1 bar, the per-project cap, coverage against
  the vault and the supersession hint;
- `--ai-extract`: only candidate sentences are sent; untraceable, empty,
  cross-project, or mis-typed entries are discarded; evidence is carried over;
- the review through the swappable prompt driver: replace, edit, rule, skip,
  stop, a blank heading falling back to the suggestion, assistant text never
  written;
- `import --memory-only` end to end on a Markdown folder, and the separate
  memory ledger keeping a second run quiet.

---

## Non-goals

- **No autonomous memory writes.** Neither feature lets an agent or the CLI
  change memory without an operator decision. This is the line between a
  memory the operator trusts and one that drifts.
- **No embeddings, no network at vault runtime.** Lifecycle and extraction are
  string and date logic. The Local-Only rule is unchanged.
- **No typed relations beyond supersession.** `depends_on` / `part_of`
  could reuse the same field syntax later. They are not added until supersession
  has proven the pattern.
- **No manifest changes.** If one turns out to be needed, that is a design bug
  to raise, not something to patch in.

## Rollout

One release, 0.6.0: lifecycle parsing, doctor checks, `--repair` back-links, MCP
`supersedes` and states, protocol 3, templates, then heuristic extraction for
en/tr/de/es, the review flow, `--memory-only`, provenance, and `--ai-extract`.
The lifecycle is built first because the inbox's supersession hint depends on it.

## Resolved questions

1. Import Privacy rule amendment: **accepted** as worded above.
2. English field keys in every vault language: **yes**.
3. Persistent inbox and MCP `propose_decision`: **deferred** until the review
   UX is proven.
4. Rules lifecycle: **supported and documented** in 0.6.0.
