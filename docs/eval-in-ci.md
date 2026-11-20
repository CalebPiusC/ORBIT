# Running the evals in CI

`evals/run.ts` needs a provider key and a machine that can reach the provider. GitHub Actions can run
the same command from a GitHub-owned runner, which is the way to do it when the network you are on
blocks the provider (or blocks Codespaces).

Nothing here runs on a push or a pull request. A full pass spends real free-tier quota, so a run only
happens when someone chooses to spend it, from the **Actions** tab.

---

## One-time setup on the fork

Both steps are in the repository's own settings, on `github.com`, and both can be done from a phone
browser. The repository is a fork, and a fork starts with Actions switched off, so the first step is not
optional.

### 1. Turn Actions on

1. Open the repository on GitHub.
2. Tap **Actions** in the top bar.
3. A fork shows a banner: *Workflows aren't being run on this forked repository.* Tap
   **I understand my workflows, go ahead and enable them**.

If the banner is not there, check **Settings → Actions → General → Actions permissions** and choose
**Allow all actions and reusable workflows**, then **Save**.

Until this is done, the `eval` workflow will not appear in the sidebar at all.

### 2. Add the key

1. **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**.
2. Name: `GEMINI_API_KEY`. Value: the key from Google AI Studio. Save.

That is the only secret a normal run needs. The value is never shown again by GitHub, never printed by
the job, and never written to a file.

### Why the workflow lives on `dev`

GitHub only shows the **Run workflow** button for workflows that exist on the **default branch**. A
workflow file that exists only on a working branch is invisible in the Actions tab and cannot be
dispatched at all — not from the UI, and not from the API while it has never run.

So `.github/workflows/eval.yml` sits on `dev` (this branch), and the *branch under test* is an input.
The code that runs is the checkout of the branch you pick, not the copy of the workflow on `dev`.

---

## Running a pass from a phone

1. **Actions** tab.
2. Tap **eval** in the left sidebar (you may need the ☰ menu on a phone).
3. Tap **Run workflow** (right side; on a phone it may be below the workflow list).
4. Fill in the form:

   | Field | What to put |
   | --- | --- |
   | **Use workflow from** | `dev` (that is where the workflow file lives) |
   | **Branch to evaluate** | `arena/11e9240c-orbit` — or whichever branch you are testing |
   | **The one model every task runs on** | leave the default, `google/gemini-3.5-flash-lite` |
   | **Requests per minute** | leave `15` |
   | **Input tokens per minute** | leave `250000` |
   | **Allow the backup model** | leave **off** for a baseline |

5. Tap **Run workflow**, then open the run that appears at the top of the list.

The job takes roughly 20–40 minutes at these settings. It is capped at 90 minutes.

---

## The inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `branch` | `arena/11e9240c-orbit` | The branch checked out and evaluated |
| `model` | `google/gemini-3.5-flash-lite` | The one model every task runs on |
| `rpm` | `15` | Requests per minute the agent may spend; also spaces task starts |
| `budget` | `250000` | Input tokens per minute the agent may spend |
| `use_backup` | off | Allows the backup model on a provider limit (see below) |

The defaults are the baseline command:

```bash
bun evals/run.ts --model google/gemini-3.5-flash-lite --pace 15 --rpm 15 --budget 250000
```

`rpm` and `budget` are handed to the agent as `ORBIT_RATE_LIMIT_RPM` / `ORBIT_RATE_LIMIT_TPM`, so it
waits for room inside a rolling minute instead of collecting 429s mid-task. Changing them changes the
condition the agent works under, so compare runs that used the same values — `summary.json` records
which values it ran with.

---

## One model, unless you ask otherwise

A baseline is only a baseline if every task ran on the same model, so the workflow pins the policy
before anything else runs:

- **`use_backup` off (default).** `fallback.mode` is `never`. A provider limit stops that task and it is
  scored `INVALID (quota)`; the agent never rotates to another model. The default run's environment
  contains `GEMINI_API_KEY` only — the `OPENROUTER_API_KEY` secret is not read at all.
- **`use_backup` on.** `fallback.mode` is `always` with exactly one named backup,
  `openrouter/openrouter/free`, and the `OPENROUTER_API_KEY` secret is read for that step. The job fails
  immediately, with instructions, if the secret is missing.

The pinned config is written to a scratch directory on the runner and pointed at with
`OPENCODE_CONFIG_DIR`, so nothing in the checkout can change it part-way through a run. A run with
`use_backup` on is **not** comparable to a run with it off; note which one you used when you compare
scores.

---

## What the job does

1. Checks out the branch you chose, installs Bun from `package.json`, and runs
   `bun install --frozen-lockfile`.
2. Two checks that cost no quota: the CLI answers `--version`, and `bun evals/run.ts --dry-run` parses
   every task. A broken install or an unreadable task file fails here, not forty minutes in.
3. Writes the pinned fallback policy described above.
4. Fails immediately, with instructions, if the `GEMINI_API_KEY` secret is missing. The value is never
   printed, not even in that message.
5. Runs the eval command with the chosen inputs, capturing the output to a file instead of streaming it.
6. Scans that output and every saved transcript under `evals/results/` for any key this run touched —
   `GEMINI_API_KEY` always, `OPENROUTER_API_KEY` only when the backup was enabled — before anything is
   shown or uploaded.
7. Prints the scoreboard to the job log, then uploads `evals/results/` as an artifact named
   `eval-<run id>-<rpm>rpm-<budget>tpm`, kept 14 days.
8. Fails the job if the runner itself exited non-zero. A task that merely fails its check is not a job
   failure — the score is the output, and it belongs in `summary.json`.

The job asks for `contents: read` only. Two dispatched runs queue rather than overlap, because two at
once would spend the same quota twice.

---

## Reading the result

The score is the last line of the job log, so a phone can read it without downloading anything:

```
3/4 tasks passed. 1 task invalid (quota), not scored.
```

`INVALID (quota)` means the provider, not the agent, ended that task; it is deliberately excluded from
the score. `INVALID (agent)` means the run never reached the agent at all — the CLI exited non-zero, or
printed an error and no reply — and is excluded for the same reason: it measured nothing. `INVALID
(harness)` means the agent wrote outside its fixture copy. The artifact holds the evidence:

```
evals/results/summary.json          score, commit, model, pace, rate limit, repeat
evals/results/<task>/report.json    pass/fail, reason, check exit code, the reply, elapsed ms
evals/results/<task>/transcript.log everything the agent printed
```

Downloading an artifact from a phone is awkward — the GitHub mobile app cannot do it. Read the score in
the log on the phone and open the artifact later on a desktop browser from the same run page.

---

## The keys, concretely

- Google's key travels in the `x-goog-api-key` **header**, never in the request URL, so a URL echoed in
  an error cannot carry it.
- Each step gets a secret only through its own `env:`, and only the steps that need one. The step that
  checks the key exists echoes a yes/no, nothing else.
- The scan in step 6 uses a fixed-string search (`grep -F`) whose result is a yes/no only — the search
  never prints what it found.
- If a key does appear, the job prints the log with **every** key this run touched replaced by
  `[redacted]`, uploads nothing, and fails. That includes the backup key, not just Gemini's.
- GitHub also masks registered secrets in logs; that is a second layer, not the reason this is safe.

---

## Quota and time

The free tier is 15 requests and 250,000 input tokens per minute, and 500 requests per day. Measured on
this suite, one task costs roughly 13 requests and 76,000 tokens on a Lite model (the numbers and their
method are in [`evals/README.md`](../evals/README.md)). A four-task pass therefore fits a day's requests
but not a single minute's tokens, which is exactly why the limiter waits rather than retrying.

If a run is still going after an hour, cancel it: at that point it is waiting on quota, not working, and
the tasks it already finished are in the artifact.

## If it fails in the first minute

Both early failures cost nothing to retry.

- **The `eval` workflow is not in the sidebar.** Actions are still off for the fork; do the first setup
  step again. A workflow that has never run and is not on the default branch cannot be dispatched.
- **`Install dependencies` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.** `bun install` fetches
  `ghostty-web` from a GitHub tarball, and that runner cannot verify `api.github.com`. Nothing the evals
  need comes from that package, but the install step runs first, so that is where it shows up.
- **`Check the tasks parse` fails.** The branch you chose has a task file or an argument the runner does
  not understand; run that command locally to see which.
