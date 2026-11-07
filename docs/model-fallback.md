# Model fallback

When a model runs out of rate limit or quota in the middle of a task, Orbit moves the same task to
another model instead of failing the turn. Nothing is restarted: the conversation, the tool results
and the step that was running all stay, and the next attempt runs on the backup model.

The logic lives in the shared core (`packages/core/src/model-fallback.ts` and
`packages/core/src/plugin/model-fallback.ts`), not in the terminal UI, so a future graphical frontend
gets exactly the same behaviour through the same server.

## What you see

```
Gemini 3.8 Flash reached its usage limit (resets in about 1 hour). Switched to Free Models Router and continuing this task.
```

The model name in the footer changes with it. After the wait is over, the next message you send
switches back:

```
Gemini 3.8 Flash is available again. Switched back to it from Free Models Router.
```

When a limit hits and no backup is usable:

```
Gemini 3.8 Flash reached its usage limit. No backup model is set up. Add one with "orbit auth login openrouter" (free models), or pick another model with /model.
```

A rejected key or a dead connection gets a plain sentence too, once per turn, instead of a wall of
provider JSON.

## Configuration

Every field is optional. Put this in `opencode.json` (the same file as `model`):

```jsonc
{
  "model": "google/gemini-3.8-flash",
  "fallback": {
    "mode": "ask",              // "ask" | "always" | "never"
    "models": ["openrouter/openrouter/free"],
    "threshold": 3,             // failed attempts on one model before a rate limit switches
    "throttleAfter": "1 minute", // wait for a per-minute limit the provider does not put a number on
    "resetAfter": "1 hour",     // wait when the provider does not say when its limit lifts
    "maxSwitches": 3            // ceiling per turn, so a chain of bad backups cannot loop
  }
}
```

- **`mode`** — `ask` switches after the first confirmed need and remembers the answer for the rest of
  the session (a terminal dialog is presentation; the decision is already made in core, and headless
  runs treat `ask` as `always` so an unattended run never stops to ask). `always` is the same without
  remembering. `never` leaves the current behaviour: retry, then fail.
- **`models`** — tried in order. Anything the catalog has enabled can be a backup; there is no
  provider allowlist. The default is OpenRouter's free router, which itself picks whatever free model
  is available.
- **`threshold`** — a single 429 always retries on the same model first. Only repeated failures on one
  model switch. A quota that names a per-day cap switches immediately, because retrying a capped
  account only delays the switch. A per-minute quota is not a cap: it clears by itself, so Orbit
  waits it out instead of abandoning a model that will be fine in a few seconds.
- **`throttleAfter`** — how long to wait for a per-minute limit when the response carries no number.
  Gemini's free tier says `"retryDelay": "2s"` in the error body; Orbit reads it and waits exactly
  that long, then retries the same model. Providers that answer with a bare 429 get this wait.
- **`resetAfter`** — providers rarely say when a daily cap lifts. This is the fallback wait. A
  provider hint wins when present. If the primary is still capped when Orbit returns to it, the wait
  doubles, up to 24 hours.

## The free tier, in numbers

Google's rate-limit page on **2026-11-07**, per project and per model:

| Model | Requests / minute | Requests / day | What it means |
| --- | --- | --- | --- |
| Flash Lite (`gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`) | 15 | 500 | the default a first run picks |
| `gemini-3.8-flash` | 5 | 20 | the stronger tier; 20 requests is one long agent turn |
| Gemma 4 | 30 | — (16,000 tokens/minute) | plenty of requests, too little context for an agent |

That is why a free key starts on a Lite model and why 3.8 Flash is an upgrade you make deliberately
(`/model`), not a default. The catalog Orbit reads carries no free-tier metadata — the limits are
Google-side and can change without a release here — so nothing is enforced unless you say so. What the
code does by default is react to the 429 they produce: wait for a per-minute window, switch only on a
cap, and say plainly when there is nobody to switch to.

If you would rather not collect those 429s, give the client the numbers above and it waits for room
instead of sending a request the provider will refuse:

```json
{ "rate_limit": { "preset": "free" } }
```

`preset: "free"` carries 15 requests and 250,000 input tokens per minute for Flash Lite and 5 requests
per minute for 3.8 Flash; `rate_limit.models` overrides either per `"<provider>/<model>"`, and
`"*"` covers every other model. The evals hand the same budgets to the agent with
`--rpm 15 --budget 250000`. Both meters are rolling windows over one minute, the spend is estimated
from the request body before it is sent and corrected with the provider's own input-token count
afterwards, and a model with no budget is never delayed.

Which Lite ids exist is the catalog's business, not this file's: a first run asks the catalog and takes
the Lite model it lists, so a release that arrives after this one is picked up without a code change.
The three ids above are the ones the shipped catalog (`packages/core/src/models-dev/snapshot.txt`)
actually contains, and a test fails if that stops being true.

The 429 in the test fixtures is the 5-per-minute one from this table, captured verbatim.

## Switching back by hand

```
orbit model back                      # most recent session in this folder → the configured default model
orbit model back --session ses_123    # a specific session
orbit model back --to openrouter/openrouter/free
```

The same call is available to the UI through `session.switchModel`, so a frontend only needs to send
the model it wants.

## What has been tested, and what has not

The 429 every test uses is the one Gemini actually returned on the free tier (`quotaId`
`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, `quotaValue` 5, `RetryInfo.retryDelay` `"2s"`),
kept verbatim in `packages/core/test/fixtures/errors/google-429-free-tier-rpm.json`. It is replayed
through the real session runner, so classification, the wait and the notice are exercised on the real
bytes rather than an approximation.

Not proven here: the same flow against a live free-tier key, and the exact Lite model a first run will
choose. The sandbox cannot reach the model catalog (models.dev) and has no provider key, so the
chooser is covered against a stub catalog instead — including a Lite model newer than this release. So
a real 429 was never observed end to end. To check it on your machine:

```bash
bun evals/run.ts --pace 15 --model google/gemini-3.5-flash-lite   # the free-key default
bun evals/run.ts --pace 5  --model google/gemini-3.8-flash        # the 20-a-day tier
```

The pace should match the model's own allowance. A task stopped by quota is reported `INVALID (quota)`
and left out of the score; a task that merely hit a per-minute window should retry after the provider's
own delay and finish on the same model.
