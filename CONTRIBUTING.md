# Contributing to Vulcanus

Thanks for looking. Vulcanus generates a memory vault that other people's AI
agents will read for years, so the bar here is less about style and more about
one thing: **a generated vault must never lie to an agent.** Everything below
follows from that.

## Getting set up

```bash
git clone https://github.com/sunsatosolutions/Vulcanus.git
cd Vulcanus
npm install
npm test
```

Node 22.12 or newer; 24 is the LTS the project is developed against. The CLI runs
straight from source while you work:

```bash
npx tsx src/cli.ts init /tmp/scratch-vault --name SCRATCH --operator You --defaults --no-git
```

Point it at a throwaway directory — never at your own vault.

## The checks

Run these before opening a pull request. CI runs the same four, plus the test
matrix on Linux, macOS, and Windows across Node 22, 24, and 26.

```bash
npm run typecheck
npm run lint
npm run format
npm test
```

Coverage thresholds are enforced separately (`npm run coverage:check`): lines
85%, branches 75%, functions 80%. If a change drops below, add the test rather
than lowering the floor.

## What matters in review

- **The vault must validate.** Any change to generation has to leave
  `vulcanus doctor` passing on a freshly generated vault, in both `core` and
  `full` profiles and both languages. The test suite does this for you; keep it
  that way.
- **Never destroy memory.** Files the operator writes are `seed`; files the CLI
  owns are `managed`. Only `managed` files may be rewritten without `--force`.
  When in doubt, archive instead of deleting — `project remove` moves notes to
  `_archive/` and that is the pattern to follow.
- **Report what happened, not what you hoped.** A command that could not push
  says so. A command that skipped a step says which. This is a memory system:
  a false success is worse than a visible failure.
- **Vault paths use forward slashes** on every platform. Anything derived from
  the filesystem goes through `vaultRelative()` before it is compared to a
  planned path or written into a note.
- **Errors say what, why, and what to do.** Use `reportProblem()` from
  `src/errors.ts` rather than a bare `stderr.write`.
- **Comments explain why, not what.** The code says what it does.

## Tests

`node:test`, no framework. Tests live in `test/*.test.ts` and run against real
temporary vaults rather than mocks — the interesting bugs are in the generated
output, not in the function calls.

Useful helpers in `test/helpers.ts`:

- `tempDir()` / `cleanup()` — a scratch vault directory.
- `manifest()` / `project()` — a valid manifest to generate from.
- `scriptedPrompts()` — answers the wizard from a fixed script and records what
  it asked, which is how the question flow is pinned down.

## Adding a language

`src/i18n.ts` holds the wizard strings. Adding a locale means adding a full
`Messages` object — the integrity test refuses partial locales, on purpose.

Be aware of the current limit: **only the wizard is localized.** The generated
notes themselves are English regardless of locale. A new wizard language on its
own therefore produces a half-translated experience, so localizing generation is
the prerequisite, and that is the more valuable contribution.

## Adding an importer

An importer is one file in `src/importers/` implementing `ImportAdapter`:

- `defaultPaths()` — where to probe automatically. Return `[]` if scanning
  without being asked would be invasive (see the Markdown adapter).
- `inspect()` — confirm a path really holds this kind of export, and describe
  it in a line a human can check.
- `load()` — an async generator, so a multi-gigabyte export never lands in
  memory at once.

Two rules: a malformed file is skipped, never thrown — half-written sessions are
normal — and **no conversation content ever enters the vault.** The importer's
output is candidate project *names* with evidence counts. The operator decides.

## Commits and pull requests

Write the commit subject as what the change does to the product ("Add MCP
server", "Refuse to overwrite a foreign pre-commit hook"), not as a file list.
Describe user-visible changes in `CHANGELOG.md` under `## Unreleased`; the
release script stamps that section, so a release with an empty one is refused.

## Releasing

Maintainers only:

```bash
npm run release -- minor      # bumps package.json, src/version.ts, CHANGELOG
git add -A && git commit -m "Release 0.4.0"
git tag v0.4.0 && git push --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which re-runs every check
and publishes to npm with provenance.
