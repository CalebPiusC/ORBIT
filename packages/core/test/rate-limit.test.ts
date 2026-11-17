import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Config } from "@opencode/schema/config"
import path from "path"
import { RateLimit } from "../src/rate-limit.js"

const snapshot: Record<string, { models?: Record<string, unknown> }> = await Bun.file(
  path.join(import.meta.dir, "../src/models-dev/snapshot.txt"),
).json()

describe("rate limit budgets", () => {
  test("names only models the snapshot ships", () => {
    const unknown = Object.keys(RateLimit.FREE).filter((key) => {
      const [provider, model] = key.split("/")
      if (provider === undefined || model === undefined) return true
      return !(snapshot[provider]?.models ?? {})[model]
    })
    expect(unknown).toEqual([])
  })

  test("keys a model the way config does", () => {
    expect(RateLimit.keyOf({ providerID: "google", id: "gemini-3.5-flash-lite" })).toBe(
      "google/gemini-3.5-flash-lite",
    )
  })

  test("reads a whole-process budget from the environment", () => {
    expect(RateLimit.fromEnv({})).toBeUndefined()
    expect(RateLimit.fromEnv({ [RateLimit.ENV_RPM]: "15" })).toEqual({ requestsPerMinute: 15 })
    expect(RateLimit.fromEnv({ [RateLimit.ENV_RPM]: "15", [RateLimit.ENV_TPM]: "250000" })).toEqual({
      requestsPerMinute: 15,
      inputTokensPerMinute: 250_000,
    })
    // Junk is ignored rather than turned into a zero budget that would stall every request.
    expect(RateLimit.fromEnv({ [RateLimit.ENV_RPM]: "lots" })).toBeUndefined()
    expect(RateLimit.fromEnv({ [RateLimit.ENV_RPM]: "-1" })).toBeUndefined()
    expect(RateLimit.fromEnv({ [RateLimit.ENV_RPM]: " " })).toBeUndefined()
  })
})

describe("rate limit service", () => {
  test("looks up a named model before the wildcard", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
        const rateLimit = yield* RateLimit.Service
        yield* rateLimit.transform((editor) => {
          editor.set(RateLimit.ANY, { requestsPerMinute: 3 })
          editor.set("google/gemini-3.5-flash-lite", { requestsPerMinute: 15, inputTokensPerMinute: 250_000 })
        })
        return {
          named: rateLimit.lookup({ providerID: "google", id: "gemini-3.5-flash-lite" }),
          other: rateLimit.lookup({ providerID: "openai", id: "gpt-4o-mini" }),
        }
        }).pipe(Effect.provide(RateLimit.layer())),
      ),
    )
    expect(result.named).toEqual({ requestsPerMinute: 15, inputTokensPerMinute: 250_000 })
    expect(result.other).toEqual({ requestsPerMinute: 3 })
  })

  test("has no budget for anything until one is configured", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rateLimit = yield* RateLimit.Service
        return rateLimit.lookup({ providerID: "google", id: "gemini-3.5-flash-lite" })
      }).pipe(Effect.provide(RateLimit.layer())),
    )
    expect(result).toBeUndefined()
  })

  test("drops a transform when its scope closes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const rateLimit = yield* RateLimit.Service
        const before = rateLimit.lookup({ providerID: "google", id: "gemini-3.5-flash-lite" })
        const scoped = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* rateLimit.transform((editor) => editor.set("google/gemini-3.5-flash-lite", { requestsPerMinute: 15 }))
            return rateLimit.lookup({ providerID: "google", id: "gemini-3.5-flash-lite" })
          }),
        )
        return { before, scoped, after: rateLimit.lookup({ providerID: "google", id: "gemini-3.5-flash-lite" }) }
      }).pipe(Effect.provide(RateLimit.layer())),
    )
    expect(result.before).toBeUndefined()
    expect(result.scoped).toEqual({ requestsPerMinute: 15 })
    expect(result.after).toBeUndefined()
  })
})

describe("rate limit config", () => {
  test("decodes the free preset and per-model budgets", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({
      rate_limit: {
        preset: "free",
        models: { "google/gemini-3.5-flash-lite": { requestsPerMinute: 10, inputTokensPerMinute: 200_000 } },
      },
    })
    expect(config.rate_limit?.preset).toBe("free")
    expect(config.rate_limit?.models?.["google/gemini-3.5-flash-lite"]).toMatchObject({
      requestsPerMinute: 10,
      inputTokensPerMinute: 200_000,
    })
  })

  test("rejects an unknown preset and a negative budget", () => {
    expect(() => Schema.decodeUnknownSync(Config.Info)({ rate_limit: { preset: "paid" } })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Config.Info)({ rate_limit: { models: { "google/x": { requestsPerMinute: -1 } } } }),
    ).toThrow()
  })
})
