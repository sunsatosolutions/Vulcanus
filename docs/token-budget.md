# What structured memory actually costs an agent

The claim Vulcanus makes is that a layered vault is cheaper to read than a pile
of notes. This is that claim, measured — with the method written down so you can
disagree with it, and reproduce it on your own vault.

## How to reproduce this

```bash
vulcanus init /tmp/bench --name BENCH --operator Ada \
  --projects "Meridian,Harbor,Kiln,Lumen,Atlas,Vela" \
  --profile full --defaults --no-import --no-git --yes

cd /tmp/bench && vulcanus stats --json
```

`vulcanus stats` counts characters in the real files and divides by four. That
divisor is an approximation — real tokenizers land near 4 characters per token
for English prose and closer to 3 for Turkish or dense Markdown. It is stated as
an estimate everywhere the CLI prints it, and the numbers below inherit that
caveat. **The ratio is the finding; the absolute counts are indicative.**

## The measurement

A six-project vault on the `full` profile, freshly generated, no hand-written
memory yet: 43 notes.

| What an agent reads | Tokens | Share of the vault |
| --- | ---: | ---: |
| Cold start — `AGENTS.md`, Recall Map, Admin Profile | 3,167 | 24% |
| Cold start + one project Capsule (typical recall) | 3,370 | 26% |
| The whole vault | 13,202 | 100% |

**A task-scoped recall reads 74.5% less than the vault.**

Per project, the layer boundary is the point:

| Project | Capsule | Whole cluster |
| --- | ---: | ---: |
| Meridian | 212 | 1,128 |
| Harbor | 206 | 1,095 |
| Kiln | 199 | 1,060 |
| Lumen | 203 | 1,078 |
| Atlas | 203 | 1,078 |
| Vela | 199 | 1,060 |

A Capsule costs about **19%** of its cluster. That is the number the whole
protocol is built around: route with the cheap layer, and pay for depth only
when the task actually needs it.

## What this does and does not prove

**It proves the shape holds.** The entry layer is a fixed cost, and each
additional project adds ~200 tokens to routing rather than ~1,100 to reading.
Adding projects makes the ratio *better*, not worse — at six projects a recall
reads a quarter of the vault; the same vault at thirty projects would read far
less than a tenth. That is a property of the structure, not of the content.

**It does not prove answer quality.** These are generated seed notes, not real
memory. A vault full of an operator's actual decisions has larger notes and a
larger gap — but how *well* an agent answers from a Capsule versus from the full
cluster is a different experiment, and one that needs a task set and a grader,
not a character count. Nothing here measures that.

**It does not measure a cold agent against a warm one.** The honest comparison
for "does the vault help?" is an agent with no memory at all versus an agent
that recalls first, judged on answer quality. This measures only what each read
costs. Treat the two questions separately; conflating them is how token-savings
claims turn into marketing.

## The part that costs nothing

The cold-start layer is read once per session, not once per task. Every
subsequent recall in the same session costs only its Capsule — around 200
tokens, roughly 1.5% of the vault, to route a task correctly.

That is the whole trade: pay 3,167 tokens once to know how the memory is
organized, then pay ~200 per task instead of re-reading everything, or worse,
guessing.

## Check your own numbers

```bash
vulcanus stats
```

If your Capsules are not meaningfully cheaper than your clusters, the Capsules
have stopped being summaries — that is a real finding about your vault, and
`vulcanus status` will also tell you when one has fallen behind the notes
underneath it.
