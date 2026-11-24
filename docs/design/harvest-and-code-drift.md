# Design: harvest and CODE-DRIFT

Status: first round (0.7.0). Two parts: `harvest` turns commit messages that give a reason into reviewed decisions; `doctor` notices when the code behind such a decision has changed.

## Where doctor finds the code repository

The vault is a separate git repository from the code, so doctor needs a path to it.

Chosen: the project's existing optional `root` in `vulcanus.json` (what `drift` already reads), plus `doctor --code <dir>` to override it for one run.

Why:

- `root` already means "where this project's source lives". A second field for the same folder would drift from the first.
- It is optional and operator-owned, and the manifest reader keeps unknown and optional keys. Reading it needs no change to the manifest shape, so there is **no migration**, and the migration chain stays empty.
- `--code` covers a run where the checkout is somewhere else (CI, another machine) without editing the manifest, like `drift --root`.
- A project with neither gets a "could not verify" warning, not a silent pass.

Rejected: a vault-wide `codeDir` field. One vault holds many projects, often in different repositories.

## Choices in the first round

- `harvest` without `--code` uses the one git repository all projects' `root`s point into; otherwise it asks for `--code`.
- Paths in `paths::` are repository-relative and are checked with `:(top,literal)` pathspecs, so a `root` that is a subfolder still works. At most 20 are recorded per commit; names containing a comma or a newline are left out.
- Only live sections are checked; superseded and expired ones are already marked as history.
- `git diff --name-only` lists whitespace-only changes even with `--ignore-all-space`, so the check uses `--numstat -z`, which prints nothing for them.
- Only commits are compared (`<commit>` to `HEAD`); uncommitted edits are not.
- A section's `commit::` must be a hex commit id; anything else is "could not verify" and never reaches git as an argument.
