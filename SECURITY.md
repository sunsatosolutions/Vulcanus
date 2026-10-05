# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/sunsatosolutions/Vulcanus/security/advisories/new),
not in a public issue.

Include the Vulcanus version (`vulcanus --version`), your Node version and
platform, and the steps that reproduce the problem. You will get an
acknowledgement within a few days, and a fix or a decision before any details
are made public.

## Supported versions

Only the latest release on npm receives fixes. `vulcanus update` brings a vault
up to the CLI you are running.

## Scope

Vulcanus is a local command-line tool. The areas where a flaw matters most:

- **Vault writes** — any path where the CLI or its MCP server could write
  outside the vault, overwrite a note the operator owns, or follow a crafted
  link or manifest entry somewhere it should not.
- **Imports** — conversation exports are untrusted input. A crafted export that
  causes code execution, a write outside the vault, or conversation content to
  be written without the operator accepting it is in scope.
- **Spawned tools** — the opt-in AI CLI handoff and `--ai-group` /
  `--ai-extract` passes. Anything that runs a program, or sends data, without
  the confirmation the CLI promises is in scope.
- **The MCP server** — `vulcanus serve` over stdio.
- **The landing page** at `vulcanus.sunsato.com`.

The once-a-day npm version check is the only automatic network call; it can be
disabled with `VULCANUS_NO_UPDATE_CHECK=1`.
