/**
 * Per-minute budget arithmetic for one model.
 *
 * A free tier is metered twice — requests per minute and input tokens per minute — and both are
 * rolling windows, so a burst is refused even when the average looks fine. This file is the pure part:
 * given what has already been spent and what comes next, how long should the caller wait first.
 */

/** What a model allows in one rolling minute. Absent means unlimited. */
export interface Limits {
  readonly requestsPerMinute?: number
  readonly inputTokensPerMinute?: number
}

/** One metered call: when it started, how many requests it was, what it cost. */
export interface Entry {
  readonly at: number
  readonly requests: number
  readonly tokens: number
}

export interface Spend {
  readonly requests: number
  readonly tokens: number
}

export const WINDOW_MS = 60_000

/**
 * Characters per token, calibrated against real request bodies: a trivial Gemini request measured
 * 22,242 characters and 4,976 tokens (4.47). Rounding down would under-count and let the budget be
 * overspent, so the estimate is deliberately a little pessimistic.
 */
export const CHARS_PER_TOKEN = 4.5

export const estimate = (chars: number) => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN)

/** Entries still inside the window ending at `now`. */
export const active = (entries: ReadonlyArray<Entry>, now: number, windowMs = WINDOW_MS): ReadonlyArray<Entry> =>
  entries.filter((entry) => now - entry.at < windowMs)

export const spendOf = (entries: ReadonlyArray<Entry>): Spend =>
  entries.reduce<Spend>(
    (total, entry) => ({ requests: total.requests + entry.requests, tokens: total.tokens + entry.tokens }),
    { requests: 0, tokens: 0 },
  )

const fits = (spend: Spend, limits: Limits, next: { readonly requests: number; readonly tokens: number }) =>
  (limits.requestsPerMinute === undefined || spend.requests + next.requests <= limits.requestsPerMinute) &&
  (limits.inputTokensPerMinute === undefined || spend.tokens + next.tokens <= limits.inputTokensPerMinute)

/**
 * Milliseconds to wait before sending one request worth `tokens`.
 *
 * Zero when the next request fits. Otherwise the oldest entries are retired one by one — each frees
 * itself exactly one window after it started — until what remains plus the new request fits; the wait
 * is then when that last retirement happens. A request larger than the whole allowance fits nowhere,
 * so it is never delayed (waiting could not help) and is expected to fail upstream.
 */
export const waitFor = (input: {
  readonly entries: ReadonlyArray<Entry>
  readonly now: number
  readonly tokens: number
  readonly limits: Limits
  readonly windowMs?: number
}): number => {
  const windowMs = input.windowMs ?? WINDOW_MS
  const next = { requests: 1, tokens: input.tokens }
  const live = [...active(input.entries, input.now, windowMs)].sort((a, b) => a.at - b.at)
  if (fits(spendOf(live), input.limits, next)) return 0
  for (let retired = 0; retired < live.length; retired++) {
    const remaining = spendOf(live.slice(retired + 1))
    if (!fits(remaining, input.limits, next)) continue
    return Math.max(0, live[retired]!.at + windowMs - input.now)
  }
  return 0
}

/** Record a sent request. */
export const record = (entries: ReadonlyArray<Entry>, at: number, tokens: number): Entry[] => [
  ...entries,
  { at, requests: 1, tokens: Math.max(0, Math.round(tokens)) },
]

/**
 * Replace the estimate of the most recent entry with what the provider actually reported.
 *
 * Providers return usage after the fact, so the window is first charged the estimate and then
 * corrected; that keeps a long session from drifting high or low for the rest of the minute.
 */
export const settle = (entries: ReadonlyArray<Entry>, actual: number): Entry[] => {
  if (entries.length === 0) return [...entries]
  const last = entries[entries.length - 1]!
  return [...entries.slice(0, -1), { ...last, tokens: Math.max(0, Math.round(actual)) }]
}

/** The one-line description a caller logs when it waits. */
export const describe = (input: {
  readonly limit: "requests" | "tokens"
  readonly spend: Spend
  readonly limits: Limits
  readonly waitMs: number
}): string => {
  const value = input.limit === "requests" ? input.spend.requests : input.spend.tokens
  const cap = input.limit === "requests" ? input.limits.requestsPerMinute : input.limits.inputTokensPerMinute
  return `rate limit ${value}/${cap} ${input.limit === "requests" ? "requests" : "input tokens"} this minute, waiting ${(input.waitMs / 1000).toFixed(1)}s`
}
