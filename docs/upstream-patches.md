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

## Logo, theme and TUI branding (Phase 2)

| File | Change | Why |
| --- | --- | --- |
| `packages/cli/src/brand/orbit-theme.json` | new theme document (`defs` + `theme`, accent `#22d3ee`) | Orbit's default palette, installed as a theme file instead of patched into the renderer. |
| `packages/cli/src/brand/theme.ts` | new installer: writes `<config>/themes/orbit.json`, seeds `<config>/cli.json` with the theme selection, seeds `update: disable` | Users get the Orbit theme on first run and keep upstream theme fixes; nothing is hard-coded in the TUI. |
| `packages/cli/src/brand/bootstrap.ts` | runs `installBrandAssets()` after the legacy data migration | One entry point for all first-run brand setup. |
| `packages/tui/src/logo.ts` | upstream `OPENCODE` block wordmark replaced by the Orbit mark and `ORBIT` wordmark | The logo is the most visible upstream branding. `go` keeps the compact mark for the mini banner and update monogram. |
| `packages/tui/src/component/logo.tsx` | mark drawn in the theme accent, wordmark in the text colour | Uses the theme instead of hard-coded colours. |
| `packages/tui/src/mini/splash.ts` | entry label `oc mini` → `orbit mini`, exit mark from the accent colour | Same branding in direct interactive mode. |
| `packages/tui/src/mini/theme.ts` | `RunSplashTheme.accent` added | Lets the exit banner colour the mark without touching the renderer. |
| `packages/tui/src/component/dialog-go-upsell.tsx`, `component/go-upsell-art.ts` | **deleted** | Upstream paywall upsell pointing at OpenCode Go. |
| `packages/tui/src/routes/session/index.tsx` | Go upsell trigger, storage and dialog removed; free-limit notice suggests `/models` only | No upsell surfaces remain; prompt restore on a provider limit is kept. |
| `packages/tui/src/component/usage.tsx`, `util/usage-limits.ts` | Go limit notice loses the console link; `goLimitLink` removed | No links to upstream billing pages. |
| `packages/tui/src/component/dialog-update.tsx`, `error-component.tsx`, `attention.ts`, `app.tsx` | Orbit titles, crash/update copy, docs link points at the fork README, bug reports go to the fork's issue tracker | User-facing text only. |
| `packages/tui/src/feature-plugins/system/stats.tsx` | `opencode.ai` source line removed | Upstream marketing line. |
| `packages/tui/src/{component/terminal-pane.tsx,config/index.tsx,feature-plugins/sidebar/footer.tsx,feature-plugins/system/storybook/*,mini/footer.permission.tsx,mini/footer.prompt.tsx,mini/runtime.lifecycle.ts,routes/session/permission.tsx,util/error-details.ts}` | remaining user-visible `OpenCode` strings say Orbit | Same reason. |
| `packages/tui/test/**`, `packages/tui/test/component/go-upsell-art.test.tsx` (deleted) | expectations follow the new copy; upsell tests removed with the feature | Keeps the suite honest. |
| `packages/cli/src/services/updater.ts` | installed-package guard also accepts `brand.name`; curl installs are looked up in `~/.orbit/bin` as well as `~/.opencode/bin` | Without it `orbit upgrade` never detects an install made with Orbit's own package name, and an older OpenCode install cannot update itself. |

## Known follow-ups (not changed yet)

- **Update transport still points upstream.** `packages/cli/src/services/updater.ts` fetches release metadata
  from `https://opencode.ai/update/api/...` and the curl installer from `https://opencode.ai/v2/install`,
  because Orbit has no release channel of its own yet. Nothing checks for updates automatically — the brand
  installer seeds `{"update":"disable"}` in `<config>/opencode.json`, which the updater reads — but a user who
  runs `orbit upgrade` explicitly would install an upstream OpenCode build. Gate or repoint this in Phase 8
  when Orbit publishes its own packages.

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

- The TUI is free of upstream upsells; what is left are provider IDs that the upstream API itself
  serves (`opencode-go`, `opencode-zen` in `/connect`) and the `@opencode/*` package names. Both are
  provider/runtime identifiers, not branding, so they stay.
- Parked packages (`web`, `console`, `desktop`, `app`, `stats`, `posts`) still show upstream branding
  and `opencode.ai` links; they are not built or shipped.
