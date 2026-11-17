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

**Interface conventions (2026-11-06).** Three rules to hold the web version together, and to keep it
from drifting into a second product. Notes only; nothing built.

1. **One icon set, and every icon is named.** The web version adds to the existing 16×16 catalogue
   (`packages/ui/src/icons/catalog.ts`, rendered through `@opencode/ui/icon`, `currentColor`
   throughout) — no second family for the sidebar, the toolbar or a single screen, no bespoke SVG per
   feature. `app-icons/sprite.svg` and `provider-icons/sprite.svg` stay as they are: those are brand
   and provider marks, not UI controls. Any icon that stands alone carries a text label; the ones that
   cannot fit one (dense rows, narrow screens) get a tooltip and an `aria-label`. An icon with no name
   is a bug.

2. **Ask / Plan / Build — one switch, three names.** The composer carries a mode control: **Ask**
   answers and explains without touching files, **Plan** explores read-only and writes nothing outside
   its own plan folder, **Build** is the working agent. Two of the three exist already: Plan is
   `packages/core/src/plugin/plan.ts` (agent id `plan`, name "Plan", every edit denied except
   `<config>/plan/*`), Build is the default primary agent; Ask is a small addition — one agent
   definition and a permission set. The switch does what shift+tab does in the TUI (`agent.cycle`): it
   sets the session's agent. It is visible on every screen, keeps the choice per session, and the mode
   name shows in the status line so a screenshot explains itself.

3. **The terminal stays text-first.** When the web version grows a terminal panel, it stays a text
   panel. Status is carried by a few plain symbols — three is the target (running, done, needs you) —
   used the same way in the TUI and in the web, not one glyph per tool and not spinners that survive a
   snapshot as debris. No colour coding beyond lighter/darker and bold; the working screen stays
   neutral, as in Phase 2. Anything that needs explaining gets words.

**Hosted Orbit: bring-your-own-key, login required, sandboxed workspaces.** Report first, and part of the
report is already written: `docs/web-report.md` (commit `f202d700`) inventories the existing web, app and
server packages — `app`, `server`, `client`, `ui`, `session-ui`, `desktop`, `sdk`, `console`, `web` — and
states plainly that the frontend and the API already exist while accounts, per-user isolation, repo
import and hosting do not. Before any building, extend that report with the login/accounts model, the
sandboxing model for workspaces, and how a per-user key is stored and used.
