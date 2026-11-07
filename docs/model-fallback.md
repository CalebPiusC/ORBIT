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

## Switching back by hand

```
orbit model back                      # most recent session in this folder → the configured default model
orbit model back --session ses_123    # a specific session
orbit model back --to openrouter/openrouter/free
```

The same call is available to the UI through `session.switchModel`, so a frontend only needs to send
the model it wants.
