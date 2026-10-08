# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who work with AI coding agents (Claude Code, Cursor, Codex, Gemini CLI) every day, alone or in a small team, and are tired of re-explaining the same architecture, decisions, and rules at the start of every session. They arrive from a search, a README, an MCP listing, or a link, and want to install from npm and try it within minutes.

## Product Purpose

Vulcanus is an open-source CLI (`@sunsato/vulcanus`, MIT) that builds and validates an AI-readable second brain: a Git-versioned vault of linked Markdown that a person and their agents both read. It serves the vault over MCP so an agent can `recall` a project's memory instead of starting cold. Success on the site is a visitor who understands that in one screen and runs `npm install -g @sunsato/vulcanus`.

## Positioning

Not a note-taking app, wiki, or Obsidian plugin: a generator and validator for an agent-readable memory repository. Its difference is structure that can be checked — a manifest (`vulcanus.json`) that the vault is derived from, layered and scoped recall (Recall Map → Capsule → Decisions/Rules/Context) instead of one ever-growing `CLAUDE.md`, and `vulcanus doctor` failing loudly when links break or memory goes stale. Decisions are superseded, never deleted. It runs locally: no account, no network call beyond an optional daily version check.

## Operating Context

Terminal, editor, and agent sessions; Git; Obsidian as an optional reader of the same vault. Adoption channels: prose instructions (`vulcanus agents`), Agent Skills, and MCP (`vulcanus serve`). Imports candidate project names from ChatGPT, Claude, Claude Code, and Codex histories locally. Generated notes in English, Turkish, German, and Spanish.

## Capabilities and Constraints

- The landing page is one hand-written static HTML file in `site/`, served by Cloudflare Workers as static assets, released through the webtest → rc → approval chain in `CONTRIBUTING.md`.
- Strict CSP: inline script and styles allowed only by hash (`npm run site:csp`), no `style=""` attributes, no inline event handlers, nothing loaded from another origin. Fonts or images must be self-hosted in `site/`.
- `site:check` enforces FAQ ↔ `FAQPage` JSON-LD parity, `softwareVersion` = `package.json`, one h1, description under 160 characters, canonical, OG tags, sitemap, internal and `llms.txt` links.
- The page must stay fast and readable without JavaScript.

## Brand Commitments

- Name: Vulcanus, the forge god — the vault is "forged". The forge identity (dark ground, ember accent) is kept and matured, not replaced (owner's direction, 2026-10-08): refined, premium, quiet; nothing toy-like.
- Made by Sunsato; footer credits Sunsato.
- Public material never names the maintainer's private projects or vault.

## Evidence on Hand

Product truth only: real CLI output, `docs/demo.gif`, the token-budget measurement in `docs/token-budget.md`, MIT license, npm package, MCP Registry listing, the test suite and CI matrix. No testimonials, customer logos, star or download counts — do not fabricate or add them.

## Product Principles

1. Show the mechanism, not adjectives: real commands, real vault structure, real output.
2. Honest limits stated plainly (what the token measurement does and does not prove).
3. Local and private by default is a feature worth saying.
4. One install command is always one glance away.
