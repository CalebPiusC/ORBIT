# Upstream patches

Orbit keeps its changes in separate layers — configuration, plugins, theme files, documentation and
new CLI modules — so that OpenCode updates can still be merged. This file records the handful of
upstream files that had to be **edited in place**, why, and what to expect when merging `dev`.

Rule of thumb when merging upstream: every file below is a conflict candidate. Everything else Orbit
adds is new files that upstream will never touch.

## Name and folders (Phase 1)

| File | Change | Why |
| --- | --- | --- |
| `packages/util/src/global.ts` | `const app = "opencode"` replaced by `brand.name` from the new `packages/util/src/brand.ts` | Orbit's config/data/state/cache/tmp folders are `~/.config/orbit`, `~/.local/share/orbit`, `~/.local/state/orbit`, `~/.cache/orbit`, `/tmp/orbit`. |
| `packages/util/test/global.test.ts` | Folder expectations changed from `opencode` to `orbit` | Follows the rename above. |
| `packages/cli/src/index.ts` | `import "./brand/bootstrap"` as the first import | The one-time import of existing OpenCode data must run before any module creates Orbit folders. |
| `packages/cli/package.json` | package `name` → `orbit`, `bin` → `orbit`, `orbit2`, docker pack path | Published name and command. |
| `packages/cli/bin/opencode.cjs` → `bin/orbit.cjs` | file renamed, command and `sourceCommand` updated | Wrapper that finds the platform binary. |
| `packages/cli/bin/opencode2.cjs` → `bin/orbit2.cjs` | file renamed, requires `./orbit.cjs` | Compatibility alias. |
| `packages/cli/script/build.ts` | `binary` and `OPENCODE_CLI_NAME` → `orbit` | Built artifact and CLI name. |
| `packages/cli/script/pack.ts` | `command`, `legacyCommand`, `binary` → `orbit`, `orbit2`, `orbit` | npm package packing. |
| `packages/cli/src/commands/commands.ts` | help text says Orbit; root name falls back to `orbit` | User-facing help. |
| `packages/cli/src/acp/*.ts` | agent name, login label, server-unavailable and prompt-failed messages | User-facing text in the ACP server. |
| `packages/cli/src/commands/handlers/default.ts`, `handlers/pair.ts` | update-failure and pairing warnings say Orbit | User-facing text. |
| `packages/tui/src/app.tsx` | window title `OpenCode` / `OC \|` → `Orbit` / `Orbit \|` | Terminal title. |
| `packages/core/src/plugin/plan.ts` | plan files moved from `~/.opencode/plan` to `<config>/plan` | Uses Orbit's config folder. |
| `packages/cli/src/commands/handlers/{pair,stats,acp,mcp/auth}.ts`, `mini.ts`, `mini-host.ts`, `server-process.ts`, `services/remote-tunnel.ts`, `acp/service.ts` | command hints and headings say `orbit ...` | Users copy these strings into their terminal. |
| `packages/tui/src/{component/dialog-pair.tsx,util/error.ts,util/presentation.ts,mini/splash.ts}` | command hints say `orbit ...` | Same reason. |
| `packages/cli/dev/*` | self-imports `orbit/vite-host` after the package rename | The CLI package is now named `orbit`, so its own subpath imports changed. |
| `packages/cli/test/*` | usage strings, folder names and notices updated to `orbit` | Follows the rename. |

## Known follow-ups (not changed yet)

- **Project config folder and file names** still use the upstream convention: `.opencode/` directories and
  `opencode.json` / `opencode.jsonc` files. Renaming them touches config discovery, TUI plugin discovery
  and the agent/skill/theme loaders, so it is scheduled as its own step.
- **Database file** stays `opencode-<channel>.db` inside Orbit's data folder. It is an implementation
  detail users never type, and renaming it would touch fixtures and tests for no user-visible gain.
- **Internal `@opencode/*` package names and `OPENCODE_*` environment variables** are unchanged by
  design. CI/release plumbing that filters on `@opencode/cli` (for example
  `.github/workflows/check-test.yml`, `.github/release/*.sh`) needs updating when the release pipeline is
  reworked for Orbit.
- **Marketing, console and desktop packages** (`packages/web`, `console`, `desktop`, `app`, `stats`,
  `posts`) are parked: they still carry upstream branding and are excluded from the Orbit build.

## User-visible strings still carrying upstream branding (parked)

- `stats` share card prints `opencode.ai` as the source line, and the TUI has Go/console upsell
  surfaces plus `opencode.ai` documentation links. They are replaced in the theme/UI step (Phase 2)
  and the docs step (Phase 8) once Orbit has its own URL.
- `packages/web`, `packages/console`, `packages/desktop`, `packages/app`, `packages/stats` and
  `packages/posts` are not built or released for Orbit.
