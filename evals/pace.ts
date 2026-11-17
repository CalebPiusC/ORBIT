/**
 * Request pacing and quota detection for the eval runner.
 *
 * A free tier answers a burst of prompts with 429s that say nothing about the agent under test, so the
 * runner has to be able to (a) space its own prompts out and (b) tell a quota stop apart from a real
 * failure. Both are pure functions here so they can be tested without a provider key.
 */

/** How fast the runner is allowed to talk to the provider. */
export type Pace = {
  /** Requests per minute the caller can afford. */
  perMinute: number
  /** Milliseconds to wait between task starts. */
  intervalMs: number
}

/** Parse the value given to `--pace`, or throw with a sentence the user can act on. */
export function parsePace(value: string | undefined): Pace | undefined {
  if (value === undefined) return undefined
  const perMinute = Number(value)
  if (!Number.isFinite(perMinute) || perMinute <= 0) {
    throw new Error(`--pace needs a positive number of requests per minute, not "${value}".`)
  }
  return { perMinute, intervalMs: Math.max(0, Math.ceil(60_000 / perMinute)) }
}

const DURATION = /^([0-9]*\.?[0-9]+)(ms|s|m|h)$/

/** "2s" → 2000, "300ms" → 300, "1.5m" → 90000. Undefined for anything else. */
export function durationMs(text: string): number | undefined {
  const match = DURATION.exec(text.trim())
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "ms" | "s" | "m" | "h"]
  return Math.round(amount * unit)
}

/**
 * The wait the provider asked for, in milliseconds.
 *
 * Gemini puts it in the error body as `RetryInfo.retryDelay`; other providers use a `retry-after`
 * header, which Orbit prints with the error.
 */
export function retryDelayMs(transcript: string): number | undefined {
  const body = /"retryDelay"\s*:\s*"([^"]+)"/.exec(transcript)
  if (body) {
    const parsed = durationMs(body[1])
    if (parsed !== undefined) return parsed
  }
  const header = /retry-after["'\s:]+\s*([0-9]+)/i.exec(transcript)
  if (header) return Number(header[1]) * 1000
  return undefined
}

const LIMIT =
  /RESOURCE_EXHAUSTED|exceeded your current quota|GenerateRequestsPer|rate.?limit(ed)?\b|too many requests|\b429\b|free-?tier|insufficient_quota/i

/**
 * Whether a run was stopped by rate limiting rather than by the model's own work.
 *
 * A run that finished (exit 0) is never a quota stop: whatever the transcript says along the way, the
 * task reached its end and its check can be trusted.
 */
export function quotaStop(input: { exitCode: number; transcript: string }): boolean {
  if (input.exitCode === 0) return false
  return LIMIT.test(input.transcript)
}

/** What one task's attempts add up to. */
export type Verdict = "pass" | "fail" | "invalid"

export function verdict(input: { passed: boolean; quotaStopped: boolean }): Verdict {
  if (input.passed) return "pass"
  return input.quotaStopped ? "invalid" : "fail"
}

/** The sentence printed after the scoreboard: invalid tasks are counted, never scored. */
export function scoreLine(counts: { pass: number; fail: number; invalid: number }): string {
  const scored = counts.pass + counts.fail
  const head = `${counts.pass}/${scored} ${scored === 1 ? "task" : "tasks"} passed.`
  if (counts.invalid === 0) return `${head} Results in evals/results/.`
  return `${head} ${counts.invalid} ${counts.invalid === 1 ? "task" : "tasks"} invalid (quota), not scored. Transcripts are in evals/results/.`
}
