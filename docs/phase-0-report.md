# Orbit — Phase 0: codebase study, requirement mapping, and plan

**Status:** study complete, no product code written. Decisions D1–D4 confirmed (§11); waiting for your "go" before Phase 1.

**What we are forking:** `CalebPiusC/ORBIT`, at commit `ff90ed9` (upstream `anomalyco/opencode`, branch `dev`, version **2.2.5**, dated 2026-11-02).
This is the current OpenCode — a TypeScript monorepo of **36 packages, ~5,560 `.ts`/`.tsx` files, ~390k lines**, MIT licensed.

---

## 0. Headline findings

1. **The TUI is a real plugin host.** `packages/tui` is SolidJS rendered by `@opentui/core`, and it loads plugins that can register routes, UI slots, dialogs, commands, markdown renderers, and themes. Most of Phase 2 (theme, status line, welcome screen) can be shipped as **an Orbit plugin + a theme file**, not as edits to TUI internals.
2. **The system prompt is one text file plus a documented override hook.** `packages/core/src/session/runner/prompt/system.txt` renders into the request; a plugin can replace `event.system[0].text` (`session.hook("context")`). Phase 4's prompting work is a clean add-on layer.
3. **Half of the "new" features already exist upstream**, just not pointed at our defaults: diff-before-apply permission prompts with approve/reject, todo checklists, a `question` tool, subagents (`general`, `explore`), auto-compaction, session revert/undo, MCP, plugin install/remove/update, and a client/server split with remote attach (`serve`, `--server`, `pair`).
4. **A literal rename is not shippable.** 3,918 files mention `opencode` (identifiers, package names, import paths, env vars, DB names, URLs). Renaming all of them destroys the ability to merge upstream. Proposal: rename every **user-facing** surface through a small constants layer + targeted edits, and keep internal `@opencode/*` package names (decision D3).
5. **Biggest real risk is scope, not difficulty.** Phases 1–3 and 6 are mostly confined and testable. Phase 4 should be delivered as prompts + hooks + small policy code, **not** a rewrite of the durable agent runner (see §9 for why).

---

## 1. How the TUI is built

| Layer | Where | Notes |
| --- | --- | --- |
| Renderer / primitives | `@opentui/core`, `@opentui/solid`, `@opentui/keymap` (v0.8.1) | Native terminal renderer with Solid reactivity; also used by the desktop app. |
| TUI application | `packages/tui/src` | `app.tsx`, `routes/` (`home`, `session`), `component/`, `context/`, `feature-plugins/`. |
| Shared session UI | `packages/session-ui/src` | Timeline, message parts, markdown, diff components — reused by TUI *and* desktop (`packages/app`). |
| CLI entry | `packages/cli/src/index.ts` → `commands/` → `handlers/default.ts` → `@opencode/tui run()` | The CLI also owns the background server process. |
| Theming | `packages/theme` (tokens, resolution) + `packages/tui/src/theme` (theme discovery, `assets/*.json`, `assets/v2/opencode.json`) | Themes are JSON: `defs` colors + semantic roles (`primary`, `accent`, `diffAdded`, …), with light/dark modes. User themes go in the config dir. |
| Logo / banner | `packages/tui/src/logo.ts` (ASCII art) + `component/logo.tsx` (tint/shadow rendering) | Home route renders it; also a "go" mini-logo. |
| Status/footer line | `packages/tui/src/feature-plugins/prompt/footer.tsx`, `.../sidebar/*` | Currently: context usage, cost, subagents, shells, goal. Model + agent appear in the session header/sidebar. |
| Keybinds | `packages/tui/src/config/keybind.ts` | `Tab` cycles agents, `ctrl+p` palette, leader keys, etc. |

Extension surface that matters to us: `packages/plugin/src/tui/*` (`slot`, `route`, `dialog`, `command`, `theme`); built-in plugins are listed in `packages/tui/src/plugin/builtins.ts`.

## 2. Where the system prompt lives

| Piece | File |
| --- | --- |
| **Main system prompt (the one to edit)** | `packages/core/src/session/runner/prompt/system.txt` |
| Tool-usage guidance injected into it (`${OPENCODE_TOOL_GUIDANCE}`) | `packages/core/src/session/system-prompt.ts` |
| Per-model-family prompt variants (override) | `packages/core/src/plugin/system-prompt/{anthropic,gpt,gpt-astra,kimi,meta,trinity}.txt`, applied by `plugin/optimize.ts` |
| Agent-specific prompts | `prompt_explore` etc. in `plugin/agent.ts`; per-agent `system` in config (`agents.<id>.system`) |
| Runtime reminders (mode switching) | `plugin/plan.ts` injects `<system-reminder>` messages |
| Project/instruction context | `packages/core/src/config/plugin/instruction.ts` (loads `AGENTS.md`, walks up directories, plus global config-dir `AGENTS.md`), `instructions/*` built-ins (date, environment, MCP, skills, references) |

Assembly order: `agent.system` if set → else `SessionSystemPrompt.make(tools)` → then a second system part with all discovered instructions (`session/model-request.ts:baseTranscript`).
The `session.hook("context")` plugin hook can rewrite either part before the request goes out — this is where Orbit's prompt layer will live.

## 3. Where the agents (build, plan) are defined

- Registry/service: `packages/core/src/agent.ts` (`Agent.Service`, `resolve`, `select`, `list`); shape in `packages/schema/src/agent.ts` (`id, name, model, request, system, description, mode: primary|subagent|all, hidden, color, steps, permissions`).
- Built-in definitions are **plugins**, registered in `packages/core/src/plugin/internal.ts`:
  - `plugin/agent.ts` → `build` (default), `general`, `explore`, `compaction`, `title`, `summary`
  - `plugin/plan.ts` → `plan`: read-only, denies `edit`, asks before shell, keeps plan files in `~/.opencode/plan` (note: hardcoded path — must move to the Orbit config dir), injects enter/leave reminders on agent switch.
- User-defined agents: `agents` key in config (`packages/schema/src/config/agent.ts`), plus `.opencode/agent/*.md` style discovery via config plugins.
- Subagent execution: `tool/plugin/subagent.ts` + `session/subagent-job.ts` (background jobs, completion notices).

## 4. How providers and models are configured

- `packages/core/src/provider.ts`: provider registry keyed by package (`@opencode/ai/providers/google`, `.../openrouter`, `.../anthropic`, …) with lazy imports; `plugin/provider/*.ts` per-provider tweaks (auth, headers, model filters).
- `packages/ai/src/providers/*`: the actual AI SDK-based implementations (`google.ts`, `openrouter.ts`, `openai.ts`, …). Gemini auth reads `GOOGLE_GENERATIVE_AI_API_KEY` (env or stored credential).
- Model metadata: bundled `packages/core/src/models-dev/snapshot.txt` (8 MB, 100+ providers, includes `gemini-2.5-flash`, `gemini-3-*`, etc.). **Works offline** — good for first-run UX.
- Resolution: `packages/core/src/model-resolver.ts` + `session/runner/model.ts`. Session model is a `providerID/modelID#variant` ref, stored per session; default comes from config `model`.
- Credentials: `packages/core/src/credential.ts` + `cli auth login` (integration picker; `google` already supported), `auth list/logout`, `debug paths`.
- Retry/policy: `packages/core/src/model-retry.ts`, `session/runner/retry.ts`, with a `session.hook("retry")` plugin escape hatch. TUI already has a "usage limit reached → switch model" surface (`component/usage.tsx`, `dialog-model-free.tsx`).

## 5. How tools work

- 19 built-in tool plugins in `packages/core/src/tool/plugin/`: `read`, `write`, `edit`, `patch`, `glob`, `grep`, `shell`, `todo`, `question`, `subagent`, `skill`, `webfetch`, `websearch`, `mcp`, `mcp-resource`, `schedule`, `artifact`, `file-diff`, `image-generate`.
- Each tool declares `Input`/`Output` schemas, a description, and calls `Permission.Service` before acting (`ask` → TUI dialog; `deny` → `Permission.BlockedError`). The **edit permission dialog already renders the diff** with approve/reject/always-allow (`packages/tui/src/routes/session/permission.tsx` → `EditBody` + `PatchDiff`).
- Tool registry/service: `packages/core/src/tool.ts`; tool prompts/guides: `packages/core/src/tool/*.txt`.
- External tools = plugins (`packages/plugin/src/effect/*`, `@opencode/plugin`), which can add agents, commands, providers, models, MCP servers, TUI routes/slots. Install/update today: `orbit plugin add|remove|update|list` (`packages/cli/src/commands/handlers/plugin/*`), accepting npm or git package specifiers, writing to global config.
- Phase 5 therefore becomes: a **manifest-driven wrapper** over the existing plugin machinery + confirmation/permissions UX, not a new plugin loader.

## 6. How config files are loaded

- Loader: `packages/core/src/config.ts` + `config/discovery.ts`. Filenames: `opencode.json`, `opencode.jsonc`; sources merged in priority order: system (`/etc/opencode`, `%ProgramData%\opencode`, `/Library/Application Support/opencode`) → global (`$XDG_CONFIG_HOME/opencode`) → project (walk up from cwd) → explicit `--config`.
- Top-level keys: `model`, `shell`, `agents`, `permissions`, `policies`, `providers`, `mcp`, `plugins`, `instructions`, `commands`, `skills`, `references`, `compaction`, `formatter`, `lsp`, `workdir`/`worktree`, `experimental`, `update`, `share`.
- Global paths come from `packages/util/src/global.ts` (`const app = "opencode"` → XDG dirs) and `packages/util/src/global-roots.ts`; DB name from `cli/src/database-path.ts` (`opencode.db`).
- TUI has its own config layer (`packages/tui/src/config`, `tui.json`) for theme/keybinds/display.
- Env vars all use the `OPENCODE_*` prefix (126 distinct `OPENCODE_*` names referenced across the packages).

---

## 7. What already exists vs. what we must build

| Requirement | Status upstream | Where |
| --- | --- | --- |
| CLI + TUI app | ✅ | `packages/cli`, `packages/tui` |
| build/plan agents | ✅ | `plugin/agent.ts`, `plugin/plan.ts` |
| Diff preview + approve/reject before edit | ✅ (needs default-on + styling) | `routes/session/permission.tsx`, `component/patch-diff.tsx` |
| Todo checklist | ✅ | `tool/plugin/todo.ts`, `component/todo-item.tsx` |
| Ask-when-unsure | ✅ (`question` tool) | `tool/plugin/question.ts` |
| Subagents | ✅ (`general`, `explore`, background jobs) | `tool/plugin/subagent.ts` |
| Context compaction | ✅ | `session/compaction.ts`, `/compact` |
| Undo/revert changes | ✅ (message-level + snapshots) | `session/revert.ts`, `session/snapshot`, keybind `session.undo` |
| Gemini provider | ✅ | `@opencode/ai/providers/google` |
| OpenRouter provider | ✅ | `@opencode/ai/providers/openrouter` |
| Provider-agnostic | ✅ | 35+ provider plugins |
| Plugin install/update/remove (npm/git) | ✅ | `cli .../handlers/plugin/*` |
| Client/server split, remote attach | ✅ | `packages/server`, `packages/client`, `serve`, `--server`, `pair` |
| Single accent theme, black/white base | ➖ partial (themes exist, need our own) | `packages/tui/src/theme` |
| Status line with model/mode/folder/git-dirty | ➖ partial (model/usage exist; folder + dirty not combined) | `feature-plugins/prompt/footer.tsx` |
| Orbit system prompt (think/ask/verify/checklist/explain) | ❌ new | prompt layer |
| `ORBIT.md` project memory | ❌ new (AGENTS.md only) | `config/plugin/instruction.ts` |
| Rate-limit → offer backup model, same task | ➖ retry exists; cross-model fallback new | `runner/retry.ts` + plugin |
| `orbit tools install <github-url>` + manifest + permissions UX | ❌ new (wrapper over plugins) | CLI |
| `orbit doctor` | ❌ new | CLI |
| Guided first run, explain mode, friendly errors | ❌ new | CLI + TUI plugin + prompt |
| One-line Windows install, release pipeline | ❌ new (`install` is bash-only) | `install.ps1`, `.github/workflows` |

---

## 8. What must change, per phase (and the risk of each)

Risk scale: **L** = confined, low blast radius; **M** = touches shared code or has UX unknowns; **H** = architectural or mergeability risk.

### Phase 1 — Rebrand (user-facing)
| Change | Layer | Risk |
| --- | --- | --- |
| Binary/command `orbit`, npm package `orbit` (bin `orbit`, `orbit2` alias), version string | `packages/cli/package.json`, `script/build.ts` (`binary`, `OPENCODE_CLI_NAME`) | L |
| Help/description/usage strings | `cli/src/commands/commands.ts` | L |
| Config dir + data dir + DB + cache (`~/.config/orbit`, `orbit.db`) | `util/global.ts` (`const app`), `cli/src/database-path.ts`, `config/discovery.ts` (`names`) | M — touches every path computation; add a one-shot migration that reads `~/.config/opencode` if our dir is empty |
| Logo/banner → Orbit mark | new `theme/assets/v2/orbit.json` + TUI plugin slot replacing `feature-plugins/home` logo, or edit `logo.ts` | L |
| Remove/replace upstream URLs, upsell surfaces, share/stats links, `opencode.ai` docs links (~391 refs in tui/core/cli) | constants module `packages/tui/src/util/links.ts` + plugin overrides; disable Go/console upsell UI | M |
| MIT license preserved + `NOTICE` (fork of OpenCode, not affiliated) | root | L |
| Internal `@opencode/*` package names & `OPENCODE_*` env vars | **leave as-is** (proposal) | — (decision D3) |

### Phase 2 — Look and feel
| Change | Layer | Risk |
| --- | --- | --- |
| `orbit` theme: black/white base + one accent, error/warn only exceptions | new theme JSON + set default in TUI plugin/config | L |
| Clear spacing/separation for user vs agent vs tool vs diff blocks | Orbit TUI plugin slots + `session-ui` component tweaks | M — shared with desktop; keep edits additive |
| Compact status line: model · mode · folder · git dirty | TUI plugin slot in the footer (server already exposes `vcs` info) | M — layout discipline at narrow widths |
| Diff + approve/reject before applying | set permission defaults to `ask` for `edit`, ensure diff body always shown, mono styling | L–M |
| Single accent enforcement | theme tokens only; no per-component colors | L |

### Phase 3 — Gemini default
| Change | Layer | Risk |
| --- | --- | --- |
| Default model `google/gemini-*`, config bootstrap on first run | new global config template + `cli` first-run step | M — must not clobber existing configs |
| First-run "paste a Gemini API key" + plain-English link (AI Studio) | `cli auth login google` extended + onboarding screen (TUI plugin) | M — key validation needs network |
| OpenRouter as built-in backup | config template + provider preset | L |
| Rate-limit/quota → tell user, offer switch, continue same task | server plugin on `session.hook("retry")` + model switch + session continuation; TUI dialog | **H** — changing model mid-turn is not an upstream path; needs careful state handling (session model update + re-dispatch, preserving transcript) |

### Phase 4 — Smartness
| Change | Layer | Risk |
| --- | --- | --- |
| Think → plan → execute, ask when unsure, verify, small steps, explain | **Orbit system prompt** (`agent.system` / context hook) + agent definitions (`orbit-build`, `orbit-plan`) | L (prompt), M (behavior quality — must be tested against real model output) |
| Verify own work (run build/tests/lint, read output, fix) | prompt + small helper: detect package manager scripts, expose as a `/verify` command | M — false "done" is a prompting problem; measure with a scripted eval |
| Visible checklist | existing `todo` tool + prompt policy + status line count | L |
| `ORBIT.md` project memory read at start | `config/plugin/instruction.ts` add `ORBIT.md` to targets (core file, ~5 lines), `/init` template writes it | L (code), M (adoption) |
| Summarize long conversations | existing compaction; tune `compaction` config + prompt | L |
| Subagents for side tasks | existing; prompt guidance about when to delegate | L |
| Design help (layout/spacing/color first) | prompt section + a `design` subagent preset | L |
| Safety: confirm destructive shell / files outside project | existing permission system; add default rules for `rm`, `git reset --hard`, paths outside cwd | M — rule quality over-blocking is the failure mode |

### Phase 5 — Tools from GitHub
| Change | Layer | Risk |
| --- | --- | --- |
| `orbit tools install <url>`, `list`, `remove`, `update` | new CLI command module + wrapper over `plugin add/remove/update` | M |
| Manifest format (`orbit-tool.json`: name, description, entry, permissions) + validation | new schema + docs | L |
| Consent screen: repo, permissions, warning that code runs locally, no silent install scripts | CLI prompt (clack) | L |
| 2–3 example tools + guide | `examples/tools/*`, docs | L |
| Curated recommended list (editable file) | `tools/recommended.json` + `orbit tools recommended` | L |
| Risk: git-hosted packages bypass npm review; need pinned ref/sha + audit print | design decision, documented | M |

### Phase 6 — Newcomer track
| Change | Layer | Risk |
| --- | --- | --- |
| Windows one-liner (`irm ... | iex` → `install.ps1`), macOS/Linux curl script | new scripts + release assets | M — cannot test on Windows here (see §10) |
| `orbit doctor` (node, git, key, internet, permissions, terminal) | new CLI command | L |
| Guided first run walkthrough | TUI plugin (onboarding route/dialog) + `orbit` first-launch flag | M |
| Safe defaults: start in plan mode, ask before edits/shell | config template + first-run flag | M — availability vs. annoyance |
| Explain mode toggle | config key + keybind + prompt injection | M |
| Friendly errors | map `SessionError`/provider errors to plain text + next step (core error renderer + TUI) | M — many error shapes |
| One-command undo of a change set | existing revert + `orbit undo` CLI + keybind/UI affordance | M — revert semantics across snapshots |

### Phase 7 — Cloud-ready
Documentation only: describe the existing split (`orbit serve` + `orbit --server <url>` + `orbit pair`, per-session SQLite + blob store, auth via server password), and leave typed seams for accounts/usage/quota in the config schema. Risk: none if we don't build it.

### Phase 8 — Docs and release
README rewrite, CONTRIBUTING, ROADMAP, `NOTICE`/credits, install docs, GitHub release workflow (build matrix already exists in `.github/workflows/release.yml` and `packages/cli/script/build.ts` — needs renaming to Orbit artifacts). Risk: M (publishing/npm names, signing) — cannot be fully done from this sandbox.

### Phase 9 — Graphical frontend
Deferred until the CLI is finished: the GUI (file tree, diff approval, chat, open/clone from GitHub, embedded terminal) rides on the same server and reuses the same core logic, so it is built last.

---

## 9. Proposed execution plan (small steps, verified each time)

**Verification harness available in this environment** (already validated):
- CLI boots: `bun run dev --help` (works; `bun install --frozen-lockfile` completed, 1,797 packages).
- TUI boots and renders: launched under a pty (`script -qec "bun run dev --standalone"`) and captured the rendered screen (logo, prompt, footer).
- Tests/typecheck: `bun test` per package; `bun turbo typecheck`.
- **Limits:** this sandbox has no model-API or `models.dev` network access, so end-to-end model runs must be simulated (`packages/simulation` + `packages/http-recorder`) or done by you; and Windows/macOS cannot be executed here.

Proposed sequence, one commit per step, gate = boots + affected tests + typecheck:

1. **Repo hygiene**: `NOTICE`, `docs/` scaffolding, branch/commit conventions, author identity set. (Phase 1 start)
2. **Orbit identity layer**: constants module for name/links/paths; binary + package + help text; config/data dirs + migration; new color config dir keeps reading old one once.
3. **Logo + theme**: Orbit mark, `orbit` theme (base + 1 accent), default theme, spacing pass.
4. **Status line** (model/mode/folder/git-dirty) + diff approval polish.
5. **First-run + Gemini**: config template, key prompt with AI Studio instructions, OpenRouter backup preset, friendly "no key yet" errors.
6. **Orbit prompt layer**: new system prompt file, `orbit-build`/`orbit-plan` agents, ORBIT.md support, verification + checklist + design + safety policy sections.
7. **Fallback on quota/rate limit** (the one genuinely new mechanism).
8. **`orbit tools`** (manifest, install/list/remove/update, consent, examples).
9. **Newcomer track** (`doctor`, onboarding, explain mode, `undo`, error copy).
10. **Docs + release** (README/CONTRIBUTING/ROADMAP, installers, workflow rename).

Phases 1–2 are low risk. Phases 3 and 4 carry the real uncertainty, so I want us to agree on how they will be tested before I build them.

## 10. Honest risks and limits

1. **"Rewrite the agent loop" (Phase 4) — I recommend not rewriting it.** The runner is a durable, resumable step machine (`session/runner/*`, `execution/*`, snapshots, compaction, retries) with a lot of invariant-preserving code. Rewriting it would (a) be the single largest source of regressions, and (b) make upstream merges painful, contradicting your layering rule. Instead: prompt layer + 2–3 targeted hooks + policy plugins gets the behavior you described, at maybe 15% of the risk. If a specific behavior proves impossible that way, I'll show you the exact blocker and propose the smallest core change.
2. **Model quality is the constraint, not our prompt.** "Free Gemini behaves carefully" depends on the model. We can enforce *structure* (plan → act → verify, checklist, ask-before-destructive) through prompting + tools, but we cannot guarantee judgment quality. Proposal: a small scripted eval set (5–10 tasks: fix a failing test, add a feature, refactor, answer a question) run before/after prompt changes so we can see whether behavior actually improved.
3. **Windows-first cannot be verified in this sandbox.** I can write PowerShell installers, keep paths `path.join`-safe, keep the existing win32 build targets, and run the full test/typecheck suite — but you must run the Windows smoke test (install, boot, key setup, one edit, one undo). I'll give you a copy-paste checklist each phase.
4. **Full end-to-end model testing is not possible here** (no provider network). I'll rely on the simulation/recorded harness plus your manual runs.
5. **Rebrand scope.** User-facing rename only; internal package names/env vars stay (D3). Renaming the DB/config dirs breaks nothing for a new project but does need a migration path if you ever want to import OpenCode data.
6. **Upstream mergeability.** Orbit-only code goes in new files where possible (`packages/orbit/*` plugin + CLI command modules + docs + scripts). Every core file edit will be listed in a running `docs/upstream-patches.md` with the reason, so you can rebase/merge upstream later knowing exactly what conflicts to expect.
7. **npm/GitHub release publishing** (installers, binaries, package names) needs credentials and registry names that only you control; I'll prepare everything and hand you the publish steps.

## 11. Decisions (confirmed 2026-11-06)

- **D1 — Accent color:** cyan `#22D3EE`. Everything else black/white/grey; only error (red) and warning (amber) may differ.
- **D2 — Git author:** `pius caleb <296163557+CalebPiusC@users.noreply.github.com>` (GitHub identity, noreply address). No co-author trailers, no "generated by" lines anywhere.
- **D3 — Rename scope:** user-facing only. Binary, npm package, help text, config/data dirs, docs and URLs become Orbit; internal `@opencode/*` packages and `OPENCODE_*` env vars stay for upstream mergeability.
- **D4 — Non-terminal surfaces:** parked. `packages/web`, `console`, `desktop`, `app`, `stats`, `posts` stay untouched and out of the Orbit build/release.

## 12. Original open questions (for the record)

- **D1 — Accent color** (the `[ACCENT COLOR]` placeholder). My default pick: **cyan `#22D3EE`** (high contrast on black/white, distinct from error red and warning amber). Alternatives: orange `#FF7A18`, lime `#A3E635`, violet `#A78BFA`.
- **D2 — Git author name + email** for all commits (no co-author lines, no "generated by"). I will not commit until you give these.
- **D3 — Internal package names**: keep `@opencode/*` + `OPENCODE_*` env vars internally (max upstream mergeability), rename only user-facing surfaces. Alternative: full internal rename (cleaner repo, painful merges).
- **D4 — Non-terminal surfaces**: `packages/web`, `console`, `desktop`, `app`, `stats`, `posts` are the marketing site, console, and desktop app (~1,500 files). Proposal: park them (leave untouched, exclude from our rebuild/release), keep the fork focused on CLI/TUI. Alternative: rebrand them too (large extra scope).

Once you confirm these, I'll start Phase 1 with step 1 (NOTICE + identity layer) and report back before moving on.
