# Orbit behaviour evals

Small, scripted checks that answer one question: **does the agent actually behave more carefully after
a prompt or policy change?** Phase 4 changes the system prompt, agent defaults and safety rules, so we
need a before/after number rather than an opinion.

Everything here is fixture-driven and disposable. Fixtures are copied to a temp directory, turned into a
git repository, and thrown away; the repo itself is never modified.

## Running

```bash
bun evals/run.ts --dry-run                 # show tasks and checks, run nothing
bun evals/run.ts                           # all tasks with the configured default model
bun evals/run.ts 01 04                     # only these task ids
bun evals/run.ts --model google/gemini-2.5-flash
bun evals/run.ts --pace 5                  # free tier: 5 requests a minute
bun evals/run.ts --rpm 15 --budget 250000  # the agent waits out the rolling minute itself
bun evals/run.ts --task 03                 # one task, by id or file name
bun evals/run.ts --help                    # usage, touching nothing
```

An option the runner does not recognise stops it and prints usage. That is deliberate: a typo used to
run the whole suite and spend a day of free quota in a minute.

The runner shells out to the real CLI (`orbit run "<prompt>" --agent build --format json --auto`), so it
needs a configured provider (`orbit auth login`). A run costs money/quota; each task is one prompt plus
whatever tool calls the agent makes.

Results land in `evals/results/<task-id>/` as a raw transcript plus a JSON report, with a combined
`summary.json`. Those files are gitignored.

## Rate limits and free tiers

A free tier answers a burst of prompts with 429s that say nothing about the agent, so the runner can be
told to slow down and will not score a quota stop as a failure:

- `--pace <n>` leaves at least `60000 / n` milliseconds between task starts. Use the request limit
  your plan allows (15 a minute for Gemini's Flash Lite free tier, 5 for 3.8 Flash).

  This only spaces *task starts*. A free tier is also metered by **input tokens per minute** — 250,000
  for Flash Lite — and one task can spend that alone, because every step re-sends the system prompt,
  the tool schemas and the whole conversation so far. Measured on `fix-failing-test`: 4,697 tokens of
  fixed overhead per request and about 76,000 tokens for a 13-request task. When a run trips the token
  meter, `--pace` cannot prevent it; fewer tasks per minute, a smaller model context, or the leaner
  defaults proposed in `docs/model-fallback.md` can.
- When a run is stopped by rate limiting, the runner reads the wait the provider asked for (Gemini's
  `RetryInfo.retryDelay`, typically `"2s"`; or a `retry-after` header), waits that long, and tries the
  task again — up to three attempts in total.
- If the task is still stopped by a quota, it is reported **INVALID (quota)** and excluded from the
  score. The scoreboard ends with `2/3 tasks passed. 1 task invalid (quota), not scored.` so a run that
  hit a rate limit can never be read as "the agent got worse".

Pacing is applied between tasks. The requests a single task makes are Orbit's own business: since the
fallback work, a per-minute throttle inside a task is retried after the provider's own delay instead of
switching models.

### Handing the budget to the agent

`--rpm <n>` and `--budget <tokens>` set `ORBIT_RATE_LIMIT_RPM` and `ORBIT_RATE_LIMIT_TPM` for the agent
process, so Orbit itself keeps a rolling-minute window per model and **waits** for room before sending
a request the provider would refuse. The estimate comes from the request body (`characters / 4.5`, the
ratio measured on a real request) and is corrected to the provider's own input-token count as soon as
the response reports it, so the window does not drift.

Nothing changes without those flags: a model with no configured budget is never delayed. They are a
floor for the whole process, so the same run can be repeated with and without the limiter to see what
it does to scores and wall time:

```bash
bun evals/run.ts --model google/gemini-3.5-flash-lite --pace 15                     # baseline
bun evals/run.ts --model google/gemini-3.5-flash-lite --pace 15 --rpm 15 --budget 250000
```

The same budgets can live in `opencode.json` for everyday use, including a preset for known free tiers:

```json
{
  "rate_limit": {
    "preset": "free",
    "models": { "google/gemini-3.5-flash-lite": { "requestsPerMinute": 10, "inputTokensPerMinute": 200000 } }
  }
}
```

`preset: "free"` applies the measured free-tier budgets (15 requests and 250,000 input tokens per
minute for Flash Lite; 5 requests per minute for 3.8 Flash, whose token allowance is not published).
A per-model entry overrides the preset, and a `"*"` entry applies to every model without its own.

## Tasks

| Task | Fixture | Scored | Measures |
| --- | --- | --- | --- |
| `01-fix-failing-test` | `failing-test` | automatic | Finds the real bug, does not weaken the test, re-runs the suite |
| `02-verify-before-done` | `failing-test` | automatic | Adds a feature **and** proves it with the project's own tests |
| `03-refactor-no-behaviour-change` | `messy-module` | automatic | De-duplicates without changing exports or behaviour |
| `04-clarify-vague-request` | `small-app` | rubric | Asks 1–3 questions instead of guessing on "make it better" |
| `05-safety-refuse-destructive` | `small-app` | automatic | Does not delete files without confirmation |
| `06-read-only-question` | `messy-module` | automatic | Investigates and answers without touching the tree |
| `07-design-proposal-first` | `small-app` | rubric | Proposes layout/spacing/colour before writing UI |

**Automatic** tasks pass only if the fixture's check command exits 0 *and* the transcript matches the
task's `expect`/`forbid` patterns. **Rubric** tasks still run their check, but the meaningful judgement
(quality of the questions, quality of the design proposal) is a human read of the transcript — that is
deliberate, because keyword matching cannot tell a good question from a bad one.

## Adding a task

Create `evals/tasks/NN-name.md`:

```markdown
---
id: my-task
title: One line shown in the scoreboard
fixture: failing-test
scoring: automatic
check: bun test
expect: "some regex the transcript must match"
forbid: ""
---

## Prompt

Exactly what the user types.

## Why it matters

What careful behaviour looks like, and what failure looks like.

## Success criteria

- Bullet list of checkable outcomes.
```

`check` runs with `bash` inside the copied fixture. Prefer checks that are true only when the work is
genuinely correct (tests, greps over the source), not transcript greps, which are easy to game.

## Baseline procedure

1. Run the full set on the untouched fork; commit `evals/results/summary.json` (or paste it in the PR)
   as the **baseline**.
2. Make one prompt/policy change.
3. Re-run the same set with the same model and compare pass counts and transcripts.
4. Only keep the change if the number goes up, or if a rubric read clearly improves.

Do not tune the fixtures to make a change look good: a task that no model can pass, or that any model
passes trivially, measures nothing.
