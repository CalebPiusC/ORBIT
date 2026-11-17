# Roadmap notes (2026-11-17)

Notes only. Nothing described here is built. Each note names the phase it belongs to in
`docs/phase-0-report.md` §8, so the roadmap stays the single list.

## Phase 2 — Look and feel

**Branding rule (2026-11-17).** `#006400` (dark green) is for the app icon and brand moments only:
app/brand icon, splash, release art, documentation headers. The working screen stays a neutral dark
theme — no green in the session UI, diffs, status line, or tool output.

Open point: this sits next to D1 (cyan `#22D3EE` accent). Either cyan stays as the in-terminal accent
and green is icon-only, or the terminal accent moves too. Needs one decision before any art is drawn.

What has been started: the Orbit **theme** and the block **wordmark** are in (commit `0026da3b`,
`packages/cli/src/brand/orbit-theme.json`, `packages/tui/src/logo.ts`). What has **not** been started:
an app/brand **icon** — `#006400` appears nowhere in the tree, and the SVG marks under
`packages/identity/` are still upstream's.

## Phase 4 — Smartness

**Optional "agent credit in commits" setting**, three modes: off (default), a co-author line, or a
separate commit identity named "ORBIT AGENT". Applies to commits the agent makes, settable per project
and globally. A GitHub App for the same purpose comes later, after Phase 9.

## Phase 5 — Tools from GitHub ("orbit tools")

**Figma and other MCP integrations as recommended tools.** The curated recommended list should be able
to name an MCP server (transport, command or URL, scope) next to git/npm tools, and the consent screen
should show which MCP server is being connected. `packages/plugins/figma` already exists upstream and is
the first candidate.

## Phase 7 — Cloud-ready

**Own token-usage log.** Record provider-reported input and output tokens per request, and show them with
`orbit usage`: today, this week, per model, with an estimated cost and a naira estimate. Document the log
format. In the web version the log is stored server-side per user. This builds on what exists: token
usage is already on the session events (`TokenUsage.Info`) and `orbit stats` already aggregates usage
through the server.

## Phase 9 — Graphical frontend / web version

**Hosted Orbit: bring-your-own-key, login required, sandboxed workspaces.** Report first, and part of the
report is already written: `docs/web-report.md` (commit `f202d700`) inventories the existing web, app and
server packages — `app`, `server`, `client`, `ui`, `session-ui`, `desktop`, `sdk`, `console`, `web` — and
states plainly that the frontend and the API already exist while accounts, per-user isolation, repo
import and hosting do not. Before any building, extend that report with the login/accounts model, the
sandboxing model for workspaces, and how a per-user key is stored and used.
