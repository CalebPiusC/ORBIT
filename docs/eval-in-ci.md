# Running the evals in CI

`evals/run.ts` needs a provider key and a machine that can reach the provider. If a Codespace cannot
reach it, GitHub Actions can run the same command from a GitHub-owned runner: workflow
[`eval.yml`](../.github/workflows/eval.yml), manual dispatch only.

Nothing here runs on a push or a pull request. A full pass spends real free-tier quota, so a run only
happens when someone chooses to spend it.

## One-time setup

1. Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name it `GEMINI_API_KEY`, paste the key from Google AI Studio, save.

That is the only setup. The workflow reads the secret into environment variables for the eval step —
`GEMINI_API_KEY`, and the same value under `GOOGLE_GENERATIVE_AI_API_KEY`, the name the provider layer
falls back to — and never writes it anywhere else. Each step in the job gets it only if that step asks
for it.

## Running a pass

1. Repository → **Actions** → **eval** (left sidebar) → **Run workflow**.
2. Pick the branch (`arena/11e9240c-orbit` for this line of work).
3. Adjust the inputs if needed, then **Run workflow**.

| Input | Default | Meaning |
| --- | --- | --- |
| `model` | `google/gemini-3.5-flash-lite` | Model every task runs on |
| `rpm` | `15` | Requests per minute the agent may spend; also spaces task starts |
| `budget` | `250000` | Input tokens per minute the agent may spend |

The defaults are the baseline command:

```bash
bun evals/run.ts --model google/gemini-3.5-flash-lite --pace 15 --rpm 15 --budget 250000
```

`rpm` and `budget` are handed to the agent as `ORBIT_RATE_LIMIT_RPM` / `ORBIT_RATE_LIMIT_TPM`, so it
waits for room inside a rolling minute instead of collecting 429s mid-task. Changing them changes the
condition the agent works under, so compare runs that used the same values — `summary.json` records
which values it ran with.

## What the job does

1. Checks out the selected branch, installs Bun from `package.json`, and runs
   `bun install --frozen-lockfile`.
2. Two checks that cost no quota: the CLI answers `--version`, and `bun evals/run.ts --dry-run` parses
   every task. A broken install or an unreadable task file fails here, not forty minutes in.
3. Fails immediately, with instructions, if the `GEMINI_API_KEY` secret is missing. The value is never
   printed, not even in that message.
4. Runs the eval command above with the chosen inputs, capturing the output to a file instead of
   streaming it.
5. Scans that output and `evals/results/` for the key before anything is shown or uploaded (see below).
6. Prints the scoreboard to the job log, then uploads `evals/results/` as an artifact named
   `eval-<run id>-<rpm>rpm-<budget>tpm`, kept 14 days.
7. Fails the job if the runner itself exited non-zero. A task that merely fails its check is not a job
   failure — the score is the output, and it belongs in `summary.json`.

The job is capped at **90 minutes** and asks for `contents: read` only. Two dispatched runs queue
rather than overlap, because two at once would spend the same quota twice.

## Reading the result

The last line of the log is the score, for example:

```
3/4 tasks passed. 1 task invalid (quota), not scored.
```

`INVALID (quota)` means the provider, not the agent, ended that task; it is deliberately excluded from
the score. The artifact holds the evidence:

```
evals/results/summary.json          score, model, pace, rate limit
evals/results/<task>/report.json    pass/fail, check exit code, elapsed ms
evals/results/<task>/transcript.log everything the agent printed
```

## The key, concretely

- Google's key travels in the `x-goog-api-key` **header**, never in the request URL, so a URL echoed in
  an error cannot carry it.
- The workflow still assumes the worst. Output is captured, then checked with a fixed-string search
  (`grep -F`) whose result is a yes/no only — the search never prints what it found.
- If the key does appear, the job prints the log with the key replaced by `[redacted]`, uploads
  nothing, and fails. If it does not appear, the normal log is printed and the artifact is uploaded.
- GitHub also masks registered secrets in logs; that is a second layer, not the reason this is safe.

These three checks run as they are written, but only in the job: with a fake key and fixture files they
behave as described (clean output passes; a key in the log or in a result file fails the job with a
redacted log). The end-to-end job itself has not run yet — the first dispatch is yours. If it fails,
the failure will be in step 2 or 3, both of which cost nothing.

One dependency to know about if it does fail there: `bun install` fetches `ghostty-web` from a GitHub
tarball, and a runner that cannot verify `api.github.com` stops at **Install dependencies** with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Nothing the evals need comes from that package, but the install step
runs before anything else, so that is where such a failure shows up.

## Quota and time

The free tier is 15 requests and 250,000 input tokens per minute, and 500 requests per day. Measured on
this suite, one task costs roughly 13 requests and 76,000 tokens on a Lite model (the numbers and their
method are in [`evals/README.md`](../evals/README.md)). A four-task pass therefore fits a day's
requests but not a single minute's tokens, which is exactly why the limiter waits rather than retrying.

If a run is still going after an hour, cancel it: at that point it is waiting on quota, not working,
and the tasks it already finished are in the artifact.
