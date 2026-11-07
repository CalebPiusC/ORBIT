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
```

The runner shells out to the real CLI (`orbit run "<prompt>" --agent build --format json --auto`), so it
needs a configured provider (`orbit auth login`). A run costs money/quota; each task is one prompt plus
whatever tool calls the agent makes.

Results land in `evals/results/<task-id>/` as a raw transcript plus a JSON report, with a combined
`summary.json`. Those files are gitignored.

## Rate limits and free tiers

A free tier answers a burst of prompts with 429s that say nothing about the agent, so the runner can be
told to slow down and will not score a quota stop as a failure:

- `--pace <n>` leaves at least `60000 / n` milliseconds between task starts. Use the number your plan
  allows (`--pace 5` for Gemini's free tier, which is five requests a minute per project per model).
- When a run is stopped by rate limiting, the runner reads the wait the provider asked for (Gemini's
  `RetryInfo.retryDelay`, typically `"2s"`; or a `retry-after` header), waits that long, and tries the
  task again — up to three attempts in total.
- If the task is still stopped by a quota, it is reported **INVALID (quota)** and excluded from the
  score. The scoreboard ends with `2/3 tasks passed. 1 task invalid (quota), not scored.` so a run that
  hit a rate limit can never be read as "the agent got worse".

Pacing is applied between tasks. The requests a single task makes are Orbit's own business: since the
fallback work, a per-minute throttle inside a task is retried after the provider's own delay instead of
switching models.

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
