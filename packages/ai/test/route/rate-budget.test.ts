import { describe, expect, test } from "bun:test"
import { Effect, Ref } from "effect"
import * as RateBudget from "../../src/route/rate-budget.js"
import * as RateLimit from "../../src/route/rate-limit.js"

const limits = { requestsPerMinute: 15, inputTokensPerMinute: 250_000 }
const FREE = { providerID: "google", id: "gemini-3.5-flash-lite" }

/** A limiter on a fake clock: `sleep` advances time instead of blocking the test. */
const harness = (budget: RateBudget.Limits | undefined, start = 0) =>
  Effect.gen(function* () {
    const now = yield* Ref.make(start)
    const waits = yield* Ref.make<number[]>([])
    const layer = RateLimit.layer(() => budget, {
      now: Ref.get(now),
      sleep: (millis) =>
        Effect.gen(function* () {
          yield* Ref.update(waits, (all) => [...all, millis])
          yield* Ref.update(now, (value) => value + millis)
        }),
    })
    const service = yield* RateLimit.Service.pipe(Effect.provide(layer))
    return { service, now, waits }
  })

describe("rate budget arithmetic", () => {
  test("estimates tokens from the bytes actually sent", () => {
    // The measured trivial request: 22,242 characters of body, 4,976 tokens at Google.
    expect(RateBudget.estimate(22_242)).toBe(4_943)
    expect(RateBudget.estimate(0)).toBe(0)
    expect(RateBudget.estimate(-5)).toBe(0)
  })

  test("has nothing to wait for when the window is empty", () => {
    expect(RateBudget.waitFor({ entries: [], now: 0, tokens: 5_000, limits })).toBe(0)
  })

  test("waits for the oldest request to leave a full minute", () => {
    const entries = [
      ...Array.from({ length: 14 }, (_, index) => ({ at: index * 1000, requests: 1, tokens: 1_000 })),
      { at: 20_000, requests: 1, tokens: 1_000 },
    ]
    // 15 requests are already in the window, so the sixteenth waits for the first to age out.
    expect(RateBudget.waitFor({ entries, now: 30_000, tokens: 1_000, limits })).toBe(30_000)
  })

  test("waits on the token meter even when requests are available", () => {
    const entries = [{ at: 10_000, requests: 1, tokens: 248_000 }]
    expect(RateBudget.waitFor({ entries, now: 20_000, tokens: 5_000, limits })).toBe(50_000)
  })

  test("honours whichever limit binds first", () => {
    const entries = [
      { at: 0, requests: 1, tokens: 240_000 },
      ...Array.from({ length: 14 }, (_, index) => ({ at: 60_000 - 30_000 + index, requests: 1, tokens: 1 })),
    ]
    // The token-heavy request at 0 is the one that has to expire.
    expect(RateBudget.waitFor({ entries, now: 30_000, tokens: 5_000, limits })).toBe(30_000)
  })

  test("never delays a request bigger than the whole allowance", () => {
    expect(RateBudget.waitFor({ entries: [], now: 0, tokens: 400_000, limits })).toBe(0)
  })

  test("ignores entries older than the window", () => {
    const entries = [{ at: 0, requests: 1, tokens: 250_000 }]
    expect(RateBudget.waitFor({ entries, now: 60_001, tokens: 5_000, limits })).toBe(0)
  })

  test("corrects an estimate with the provider's own count", () => {
    const entries = RateBudget.record([], 1_000, 6_000)
    expect(RateBudget.settle(entries, 4_100)).toEqual([{ at: 1_000, requests: 1, tokens: 4_100 }])
    expect(RateBudget.settle([], 4_100)).toEqual([])
  })
})

describe("rate limiter", () => {
  test("records what it sends and reports the window", async () => {
    const run = await Effect.runPromise(
      Effect.gen(function* () {
        const { service } = yield* harness(limits)
        yield* service.reserve({ ...FREE, tokens: 5_000 })
        yield* service.reserve({ ...FREE, tokens: 5_000 })
        return yield* service.spend(FREE)
      }),
    )
    expect(run).toEqual({ requests: 2, tokens: 10_000 })
  })

  test("waits instead of failing on the sixteenth request in a minute", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { service, waits, now } = yield* harness(limits)
        for (let index = 0; index < 15; index++) yield* service.reserve({ ...FREE, tokens: 100 })
        expect(yield* Ref.get(waits)).toEqual([])
        yield* service.reserve({ ...FREE, tokens: 100 })
        return { waits: yield* Ref.get(waits), now: yield* Ref.get(now) }
      }),
    )
    // The first request was sent at t=0, so the sixteenth waits until t=60s and is then sent.
    expect(result.waits).toEqual([60_000])
    expect(result.now).toBe(60_000)
  })

  test("waits on the token meter and not on an idle request meter", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { service, waits } = yield* harness(limits)
        yield* service.reserve({ ...FREE, tokens: 120_000 })
        yield* service.reserve({ ...FREE, tokens: 120_000 })
        expect(yield* Ref.get(waits)).toEqual([])
        yield* service.reserve({ ...FREE, tokens: 20_000 })
        return yield* Ref.get(waits)
      }),
    )
    // 240,000 + 20,000 is over the 250,000 token meter, so it waits for the first request's minute.
    expect(result).toEqual([60_000])
  })

  test("settles with the real count so the rest of the minute is accurate", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { service, waits } = yield* harness(limits)
        yield* service.reserve({ ...FREE, tokens: 200_000 })
        // The provider says it was really only 40,000, which frees the window.
        yield* service.settle({ ...FREE, estimated: 200_000, actual: 40_000 })
        yield* service.reserve({ ...FREE, tokens: 200_000 })
        return { waits: yield* Ref.get(waits), spend: yield* service.spend(FREE) }
      }),
    )
    expect(result.waits).toEqual([])
    expect(result.spend).toEqual({ requests: 2, tokens: 240_000 })
  })

  test("does nothing for a model with no limits", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { service, waits } = yield* harness(undefined)
        for (let index = 0; index < 100; index++) yield* service.reserve({ ...FREE, tokens: 50_000 })
        return { waits: yield* Ref.get(waits), spend: yield* service.spend(FREE) }
      }),
    )
    expect(result.waits).toEqual([])
    expect(result.spend).toEqual({ requests: 0, tokens: 0 })
  })

  test("keys the window by model, so two models have two budgets", async () => {
    const other = { providerID: "google", id: "gemini-3.1-flash-lite" }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { service, waits } = yield* harness(limits)
        for (let index = 0; index < 15; index++) yield* service.reserve({ ...FREE, tokens: 10 })
        yield* service.reserve({ ...other, tokens: 10 })
        return yield* Ref.get(waits)
      }),
    )
    expect(result).toEqual([])
  })
})
