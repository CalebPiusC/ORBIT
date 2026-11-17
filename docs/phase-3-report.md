# Phase 3, Part A — report before any code

Status: **no code written for Phase 3.** This document is reconnaissance + a proposal. Seven decisions at the
end need a "go" (or a different answer) before Part B starts.

Scope of Part B, for reference: Gemini as the default brain, plain-English free-key onboarding, OpenRouter as a
built-in backup, automatic quota fallback that keeps the same task and conversation, automatic return to the
primary when the limit resets, a one-command manual switch back, friendly errors, and tests.

---

## 1. What can and cannot be tested without live model access

### Cannot be tested here (no keys, no provider network)

| Thing | Why |
| --- | --- |
| Any real Gemini/OpenRouter call | Sandbox has no API keys and no outbound route to `generativelanguage.googleapis.com` or `openrouter.ai` |
| The real shape of a Gemini free-tier 429 | Only the classifier's rules are inspectable, not live payloads (see §3.4) |
| Real reset windows (per-minute vs per-day caps) | Quota accounting is provider-side |
| Whether an OpenRouter `:free` model accepts our tool payload | Needs a live call |
| Eval baseline (`evals/run.ts`) | Every task runs a real model |
| Windows/macOS behaviour of anything | No such machine in this sandbox |

### Can be tested here, deterministically and offline — this is the important part

Three harnesses already exist in the repo and need no new dependency:

1. **`@opencode/http-recorder` cassettes** (`packages/http-recorder`). A cassette is plain JSON:
   `{ version, metadata, interactions: [{ transport: "http", request: { method, url, headers, body },
   response: { status, headers, body } }] }`. Replay claims one interaction per request, picks the first unused
   match, and the matcher is configurable (`layerFetch(name, { match })`), so a cassette can match on method +
   URL only and still answer a *rewritten* body (a different `model` field after a switch).
   It also **dies if a recorded interaction went unused** — so "the retry happened" becomes an assertion rather
   than an inference.
2. **The recorded-runner pattern**: `packages/core/test/session-runner-recorded.test.ts` boots the real
   `SessionRunnerLLM` + real DB + real plugin hooks against a cassette
   (`packages/core/test/fixtures/recordings/session-runner/openai-chat-streams-text.json`) with only
   `SessionRunnerModel` mocked. A fallback test can copy that setup with a hand-written two-interaction cassette
   (429 with a Google-shaped body, then a 200 stream) and assert: the session model changed, the notice text was
   published, the answer completed, and exactly one switch happened.
3. **The retry-policy harness**: `packages/core/test/session-runner-retry.test.ts` drives
   `SessionRunnerRetry.policy()` with real `AIError` causes and a `hook` seam, which is exactly the pipeline the
   fallback decision will live in. Quota/rate-limit causes are constructible (`QuotaExceededError`,
   `RateLimitError` from `@opencode/ai/effect`).

Also present but not planned for use: `packages/simulation` (network replacement, `OPENCODE_SIMULATE`,
`packages/cli/src/server-process.ts:113` → `packages/server/src/routes.ts:162`) and the external
`opencode-drive` package used by `script/drive/*.ts`. Both are viable but heavier — simulation only registers the
models.dev route unless driven, and `opencode-drive` is not a workspace dependency here. I would use simulation
only if a test needs a full server boot.

### Planned test set for Part B

| Test | Level | What it proves |
| --- | --- | --- |
| `model-fallback.test.ts` (new) | unit | Mode resolution (always / ask / never), backup candidate ordering, reset-window math, "already on the backup" no-ops |
| `session-runner-fallback.test.ts` (new) | runner + cassette | 429 → switch → same task completes; notice published; one switch |
| `session-runner-fallback-off.test.ts` | runner + cassette | fallback disabled → the current behaviour is unchanged (error, no switch) |
| `session-fallback-reset.test.ts` | unit | After the reset window the next step switches back to the primary; a manual switch back works immediately |
| `session-error-*.test.ts` additions | unit | Wrong key / missing key / network down map to plain-English text |
| `evals/run.ts --dry-run` | smoke | The eval harness still parses tasks (no model call) |

Nothing above needs a key. What they cannot prove: that the *real* providers behave as the cassette says. That
stays on your machine (§2, §6).

---

## 2. The eval baseline: not runnable here; exact commands for you

`evals/run.ts` (7 tasks) spawns `bun packages/cli/src/index.ts run <prompt> --agent build --format json --auto
[--model …]`, then scores with `bash -lc "<check>"` (`evals/run.ts:96-104,123`). In this sandbox `--dry-run`
works; a real run cannot.

**Windows gotcha, stated plainly:** the score step shells out to `bash -lc`. Stock Windows PowerShell has no
`bash`, so every task will report `check=failed` even when the model did the work. The transcript is still
written to `evals/results/<task>/transcript.log`, so a manual read works, but the pass/fail column is not
trustworthy on Windows. Codespaces (Linux) and WSL are fine. Fixing this is a small change to the eval runner
(decsion D6).

### Codespaces / Linux / WSL

```bash
git clone https://github.com/CalebPiusC/ORBIT.git && cd ORBIT
git switch arena/11e9240c-orbit
npm i -g bun && bun install
export GOOGLE_GENERATIVE_AI_API_KEY="paste-key-here"
bun evals/run.ts --dry-run
bun evals/run.ts --model google/gemini-3.8-flash
```

### Windows PowerShell

```powershell
git clone https://github.com/CalebPiusC/ORBIT.git; cd ORBIT
git switch arena/11e9240c-orbit
npm i -g bun; bun install
$env:GOOGLE_GENERATIVE_AI_API_KEY = "paste-key-here"
bun evals/run.ts --dry-run
bun evals/run.ts --model google/gemini-3.8-flash
```

Notes that apply to both:
- `GOOGLE_GENERATIVE_AI_API_KEY` (or `GEMINI_API_KEY`) is read from the environment by the Google provider, so the
  baseline does not need `orbit auth login` first. Unverified at runtime here — no key — but it is the code path
  in `packages/ai/src/providers/google.ts:40`.
- Output lands in `evals/results/` (`summary.json` + one directory per task). This is a **baseline**, so run it
  before Part B lands and keep the summary; the comparison afterwards is what matters.
- OpenRouter instead of Gemini: `$env:OPENROUTER_API_KEY` / `export OPENROUTER_API_KEY` and
  `--model openrouter/openrouter/free`.

---

## 3. Where it lives today

### 3.1 Default provider and model selection

| What | Where |
| --- | --- |
| Config key `model` (short `provider/model` or `{providerID, model, variant}`) | `packages/schema/src/config.ts:33`, `packages/schema/src/config/model.ts:20` |
| Config value becomes the session default | `packages/core/src/model.ts:160-165` (`defaultModel`) |
| `Model.default()` — configured model if enabled, otherwise the first available text model | `packages/core/src/model.ts:300-306` |
| Free-model preference when signed out (`PREFERRED_FREE` reordering) | `packages/core/src/model.ts:327-345` |
| Per-session resolution (session model → agent model → default), and `ModelUnavailable` when the chosen model is gone | `packages/core/src/session/runner/model.ts:76-100` |
| `Model.small()` — title/compaction helper model, ranked by family | `packages/core/src/model.ts:307-320` |
| Provider packages (dynamic import, `google`, `google-vertex`) | `packages/core/src/provider.ts`, `packages/core/src/model-resolver.ts` |
| Provider catalog incl. which models are enabled | `packages/core/src/plugin/models-dev.ts` + bundled `packages/core/src/models-dev/snapshot.txt` (230 providers, offline) |

There is **no `provider` default key** in the schema, and no concept of a backup model anywhere. That is the gap
Part B fills. Today Gemini is reachable as `google/gemini-*` — nothing Orbit-specific is needed to *use* it, only
to make it the default and to onboard people onto it.

### 3.2 First-run API key flow

| What | Where |
| --- | --- |
| Any models.dev provider that declares env vars automatically becomes a connectable integration with a `key` method and an `env` method | `packages/core/src/plugin/models-dev.ts:41-55` — this is why `google` and `openrouter` already work with zero new code |
| Google's env names | snapshot: `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GEMINI_API_KEY` |
| OpenRouter's env name | snapshot: `OPENROUTER_API_KEY` |
| Credential storage: SQLite table, one row per key, `activate` picks the live one, legacy `auth.json` migrated | `packages/core/src/credential.ts`, `packages/core/src/credential/sql.ts` |
| CLI login: masked key prompt, integration picker, `google` ranked 5th | `packages/cli/src/commands/handlers/auth/login.ts:20-27,155`, `packages/cli/src/commands/handlers/auth/form.ts:63` |
| TUI connect: `/connect` → `DialogIntegration` → form → credential | `packages/tui/src/app.tsx:1019`, `packages/tui/src/component/dialog-integration.tsx:862` |
| TUI onboarding card ("Connect from 75+ providers") | `packages/tui/src/feature-plugins/sidebar/footer.tsx:55-70` |
| Secret masking | CLI yes (clack `password()`); **TUI form fields have no masked type** (`packages/schema/src/form.ts` has no secret format) |

So: onboarding is a UX and copy problem, not a storage problem. A Gemini key entered through the existing key
flow is stored by the existing system — exactly as required, no new storage.

### 3.3 Retry logic

| Layer | Where | Behaviour |
| --- | --- | --- |
| Same-model retry schedule | `packages/core/src/model-retry.ts:17-63` | 10 retries, 2→10 s gaps with jitter, honours `retryAfterMs` capped at 15 min |
| Retryability by error class | `packages/ai/src/schema/errors.ts:197-229` | `RateLimit`, `ProviderInternal`, `Transport`, `UnknownProvider` retryable; **`QuotaExceeded`, `Authentication`, `InvalidRequest` are not** |
| Session retry policy + plugin hook | `packages/core/src/session/runner/retry.ts:26-60` | Builds the hook event `{sessionID, agent, model, error, attempt, decision}`, calls `input.hook(event)`, lets the plugin override `{retry, delay}` |
| Plugin contract | `packages/plugin/src/effect/session.ts` (`SessionHooks.retry`) | `{retry:false}` or `{retry:true, delay}` only — it cannot change the model itself |
| Where the decision is consumed | `packages/core/src/session/runner/step.ts` (`Outcome.Retry` vs `Outcome.Continue`) | Same-model retry only while no output has streamed; mid-stream failure becomes a continuation with the partial answer kept |
| Driver loop | `packages/core/src/session/runner/llm.ts:236-345` | `retry` is created per step (`:236`); `Outcome.Retry`/`Continue` → `retry.wait` → **`while (true)` loop reloads context** (`:242`, `prepareContext` at `:222` with the comment "each step and retry must read the settled agents, models and skills") |

That last line is the key finding: **a model switch made during a retry is picked up by the next attempt
automatically**, with the full conversation, because every iteration re-reads the session record.
`Session.switchModel` (`packages/core/src/session/session.ts:106`) only publishes a durable `ModelSelected` event
and has no idle requirement, so a server-side component can call it mid-turn.

### 3.4 Quota and rate-limit classification

`packages/ai/src/provider-error.ts:206-265` classifies by HTTP status, provider codes, then text:

- `402`, quota-ish codes (`insufficient_quota`, `freeusagelimiterror`, `budgetlimiterror`, …), or a 429 whose text
  matches `QUOTA_TEXT` (`insufficient quota|quota exceeded|usage limit|limit exhausted|…`) → **`QuotaExceeded`**
  (not retryable).
- Any other 429, or rate-limit codes/text → **`RateLimit`** (retryable), carrying `retryAfterMs` when the provider
  sent one.

Then `packages/core/src/session/to-session-error.ts` maps these to `provider.quota` / `provider.free-limit` /
`provider.budget-limit` / `provider.go-limit` / `provider.rate-limit`, keeping `status`, `retryAfterMs` and the
raw body.

**Honest caveat:** Gemini's free-tier 429 body is
`{"error":{"code":429,"message":"You exceeded your current quota…","status":"RESOURCE_EXHAUSTED", details:[QuotaFailure…]}}`.
`QUOTA_TEXT` is written as `quota[-_ ]?exceeded` (quota *then* exceeded), which Google's reversed wording does
not match, so a Google free-tier exhaustion most likely classifies as **`RateLimit`**, not `QuotaExceeded` — and
today `RateLimit` means "retry the same model up to 10 times", which for a per-day cap just wastes ~84 seconds
and then fails. That is the exact bug Part B fixes, and it also means **fallback must trigger on rate limits, not
only on quota errors**, with a threshold so a per-minute blip does not switch models (§4.2).

---

## 4. Fallback behaviour: the plan

### 4.1 Mechanism (provider-agnostic, no model names in the logic)

New shared component in core, not in the TUI:

- `packages/core/src/plugin/model-fallback.ts` — an internal plugin (registered in
  `packages/core/src/plugin/internal.ts` next to `PlanPlugin`) that hooks `ctx.session.hook("retry", …)`.
  On a quota/rate-limit event it: picks the next candidate from the session's chain, calls
  `ctx.session.switchModel({sessionID, model})`, publishes a durable `session.synthetic` notice, records the
  fallback state, and sets `event.decision = {retry: true, delay: 0}` so the same task continues immediately.
  If there is no candidate (or the mode is `never`), it leaves the decision alone and today's behaviour stands.
- `packages/core/src/model-fallback.ts` — pure policy: mode resolution, candidate ordering, reset window,
  exhaustion bookkeeping. No Effect, no TUI, no hardcoded providers; it consumes a `fallback` config list of
  `provider/model` refs and asks the existing model catalog which of them are enabled.
- Config: a new `fallback` block in the config schema (`{ mode: "ask" | "always" | "never", models: string[],
  resetAfterMinutes?: number }`), additive and optional.
- Return to primary: a per-session record `{primary, current, reason, until}` written on switch, and a check at
  the start of each step (`context`/`model.request` hook or the same fallback plugin) — if `until` has passed and
  the session is still on the backup, switch back with a notice. Lazy, not a timer, so nothing keeps running
  while a session is idle; the trade-off is that the return happens at the next message, not at the reset second.
  A `orbit model back` / `/model primary`-style one-command manual return reads the same record.
- Errors: extend the existing friendly-error path so `provider.auth` (wrong/missing key) and
  `provider.transport` (network down) say what to do, with the AI Studio / OpenRouter URLs.

Nothing here needs an upstream-protocol change: it uses the documented plugin hook, `switchModel`, `session.synthetic`
and the config schema. The plugin hook already receives a typed error, and the runner already re-reads the model
per attempt. Both were verified in source (§3.3).

### 4.2 When it fires (the part I want your call on)

Proposal, in order:

1. `QuotaExceeded` (definitive account cap) → switch immediately.
2. `RateLimit` with `retryAfterMs` ≥ 60 s → switch immediately (an hour or two of waiting is not a retry).
3. `RateLimit` with no or short `retryAfterMs` → let the existing retry run for the first 2 attempts, then switch
   (per-minute blips heal; a genuine per-day cap does not).
4. `Authentication` → do not switch silently; a wrong key is a user fix, not a fallback (fallback here would hide
   a typo behind a worse model).

### 4.3 What the user sees, and what happens to the in-flight task

- A line in the conversation, published as `session.synthetic` so it appears in the TUI and in
  `--format json` headless runs alike:
  `Gemini limit reached (free tier, resets in ~2 h). Switching to OpenRouter Free Models Router and continuing.`
- The footer model name updates by itself (`ModelSelected` is already published by `switchModel`).
- The in-flight task continues: same transcript, same tool state, next attempt on the backup model, at most a
  couple of seconds lost. If output had already streamed, the partial answer is kept and the run continues (the
  existing `Outcome.Continue` path), so nothing is silently deleted.
- In `ask` mode the first occurrence asks (TUI dialog: *Switch to X / Not now / Always switch*), remembers the
  answer in config, and never asks again. Headless runs cannot answer a dialog, so `orbit run` treats `ask` as
  `always` and prints the notice — the alternative is a failed run at 3 a.m., which seems worse. Flagged as D2.
- Switched back: on the next message after the reset window,
  `Gemini is available again. Switching back from OpenRouter.` Plus a manual command at any time.

### 4.4 Defaults I propose

- Primary: `google/gemini-3.8-flash` (in the bundled catalog: 1,048,576 context, 65,536 output, tools, reasoning
  effort, $0.75/$3.75 per Mtok — the newest flash family entry).
- Backup: `openrouter/openrouter/free` — OpenRouter's own free-model router, 200,000 context, tool support, so it
  degrades to "whatever free model is up" instead of one fixed model that may itself be capped. Named alternates
  if the router is unavailable: `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` (1 M context),
  `openrouter/thinkingmachines/inkling:free` (1 M).
- Mode: `ask` once, remembered, per your instruction.

---

## 5. Risks, and anything that needs your decision

| # | Risk | Size | Mitigation |
| --- | --- | --- | --- |
| R1 | Google free-tier 429 classifies as `RateLimit`, so a naive "fallback on quota only" rule never fires; and a naive "fallback on any 429" flips models on every per-minute blip | M | Threshold rule in §4.2; tested with both `RateLimit` shapes |
| R2 | Switching mid-turn is a supported-looking path but no upstream test exercises it; regressions would be silent | M | The cassette test asserts a full completed run after the switch; document the behaviour in `docs/upstream-patches.md` |
| R3 | The retry budget (10 per step) is shared across models; a backup that also fails could burn it and leave no room | L | Fallback consumes 1 attempt per switch; chain length capped (3), and the last candidate falls back to "fail with the plain-English error" |
| R4 | Free OpenRouter models can reject tool calls or stream differently, so a fallback could produce a broken turn | M–H | Keep the tool-call shape identical; surface the partial failure instead of looping; document that free backups are best-effort |
| R5 | Reset windows are guesses: no provider tells us the daily cap reset time | M | `retryAfterMs` when present, otherwise a configurable default (e.g. 60 min) — stated in the notice as "~" |
| R6 | The TUI has no masked input, so a pasted key is visible on screen | L | Onboarding prompts in the CLI (masked) before the TUI opens; TUI dialog gets a masked variant if you want it (D3) |
| R7 | `Model.small()` picks a helper model per provider; after a switch the title/compaction model may change | L | Accept; it already re-resolves per provider |
| R8 | A fallback plugin that registers a `retry` hook competes with any user plugin doing the same | L | Do not register the plugin's hook when `fallback.mode === "never"`; document ordering |
| R9 | Eval scoring is `bash -lc`-dependent, so the baseline is unreliable on Windows | L | D6 |
| R10 | Onboarding copy implies free tiers are permanent; Google/OpenRouter can change terms | L | Copy says "free tier, subject to the provider's limits" |

**Upstream internals that Part B would touch** — none of these is a protocol change, but three are core files, so
you should say yes or no:

1. `packages/schema/src/config.ts` — add the optional `fallback` block (additive; older configs unaffected).
2. `packages/core/src/plugin/internal.ts` — two lines to register the new internal plugin.
3. `packages/core/src/plugin/model-fallback.ts`, `packages/core/src/model-fallback.ts` — new files.
4. `packages/core/src/session/to-session-error.ts` or a new formatter — friendly error text. Prefer a new file so
   the mapping table stays untouched.
5. `orbit auth login` / first-run wiring in `packages/cli/src` (onboarding prompt, `--json` friendly), and one
   TUI dialog for `ask` mode + the switch notice. TUI work is display only; all decisions stay in core.

Alternative if you want **zero** core edits: ship the plugin through the ordinary user-plugin path
(`.opencode/plugin/orbit-fallback.ts`) and drive the config from a preset file. Downside: it is not on by default
for anyone, it cannot add the `fallback` config key to the schema, and "ask once and remember" still needs UI, so
I do not recommend it. That is D1.

---

## 6. Decisions needed before Part B

- **D1 — Where the logic lives.** Built-in core plugin (my recommendation: 2-line registration + 2 new files) vs.
  user-plugin-only (zero core edits, off by default).
- **D2 — `ask` mode in headless runs.** Treat as `always` and print the notice (my recommendation) vs. fail the
  run with the question.
- **D3 — Onboarding surface.** CLI-only first-run prompt (masked, works on every terminal, also fixes R6) vs. also
  add a masked field/dialog to the TUI. My recommendation: CLI first, TUI during Phase 2 polish.
- **D4 — Default pair.** `google/gemini-3.8-flash` + `openrouter/openrouter/free`, as in §4.4? Or a specific
  Gemini Flash-tier model you prefer.
- **D5 — Return-to-primary.** Lazy at the next message (my recommendation) vs. a background timer that switches
  while idle.
- **D6 — Eval scoring on Windows.** Leave `bash -lc` and document "use WSL/Codespaces" vs. make the check runner
  platform-aware in Part B (small, additive).
- **D7 — Do you want `orbit model back` as a CLI command, a TUI slash command, or both?** (I would do both; the
  server-side call is one shared function either way.)

Nothing in Part B starts until you answer these or say "go with your recommendations".
