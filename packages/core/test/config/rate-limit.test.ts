import { afterEach, describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigRateLimitPlugin } from "@opencode/core/config/plugin/rate-limit"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { RateLimit } from "@opencode/core/rate-limit"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigRateLimit } from "@opencode/schema/config/rate-limit"
import { Effect } from "effect"
import { it } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const flashLite = { providerID: "google", id: "gemini-3.5-flash-lite" }
const flash = { providerID: "google", id: "gemini-3.8-flash" }
const other = { providerID: "openai", id: "gpt-4o-mini" }

const document = (info: Info) => new Document({ type: "document", info })

afterEach(() => {
  delete process.env[RateLimit.ENV_RPM]
  delete process.env[RateLimit.ENV_TPM]
})

describe("ConfigRateLimitPlugin.Plugin", () => {
  it.live("applies the free preset and lets a model entry override it", () =>
    Effect.gen(function* () {
      const rateLimit = yield* RateLimit.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* config.setEntries([
        document(
          new Info({
            rate_limit: new ConfigRateLimit.Info({
              preset: "free",
              models: { "google/gemini-3.5-flash-lite": new ConfigRateLimit.Budget({ requestsPerMinute: 10 }) },
            }),
          }),
        ),
      ])
      yield* ConfigRateLimitPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      // The preset covers the models it knows, and the entry above replaces one of them.
      expect(rateLimit.lookup(flashLite)).toEqual({ requestsPerMinute: 10 })
      expect(rateLimit.lookup(flash)).toEqual({ requestsPerMinute: 5 })
      // A model the preset says nothing about stays unlimited.
      expect(rateLimit.lookup(other)).toBeUndefined()
    }).pipe(Effect.provide(AppNodeBuilder.build(RateLimit.node, []))).pipe(Effect.provide(PluginTestLayer)),
  )

  it.live("takes a whole-process budget from the environment", () =>
    Effect.gen(function* () {
      process.env[RateLimit.ENV_RPM] = "7"
      process.env[RateLimit.ENV_TPM] = "90000"
      const rateLimit = yield* RateLimit.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* config.setEntries([
        document(
          new Info({
            rate_limit: new ConfigRateLimit.Info({
              models: { "google/gemini-3.8-flash": new ConfigRateLimit.Budget({ requestsPerMinute: 2 }) },
            }),
          }),
        ),
      ])
      yield* ConfigRateLimitPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

      // The environment is the floor for the whole process; config still names a model more precisely.
      expect(rateLimit.lookup(other)).toEqual({ requestsPerMinute: 7, inputTokensPerMinute: 90_000 })
      expect(rateLimit.lookup(flash)).toEqual({ requestsPerMinute: 2 })
    }).pipe(Effect.provide(AppNodeBuilder.build(RateLimit.node, []))).pipe(Effect.provide(PluginTestLayer)),
  )

  it.live("retunes the limiter when config changes", () =>
    Effect.gen(function* () {
      const rateLimit = yield* RateLimit.Service
      const config = yield* Config.Test
      const bus = yield* Bus.Service
      const plugins = yield* Plugin.Service
      yield* config.setEntries([
        document(new Info({ rate_limit: new ConfigRateLimit.Info({ preset: "free" }) })),
      ])
      yield* ConfigRateLimitPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))
      expect(rateLimit.lookup(flashLite)).toEqual({ requestsPerMinute: 15, inputTokensPerMinute: 250_000 })

      yield* config.setEntries([document(new Info({ rate_limit: new ConfigRateLimit.Info({}) }))])
      yield* bus.publish(Event.Updated, {})
      for (let attempt = 0; attempt < 200; attempt++) {
        if (rateLimit.lookup(flashLite) === undefined) return
        yield* Effect.sleep("10 millis")
      }
      yield* Effect.die(new Error("Timed out waiting for rate limit config reload"))
    }).pipe(Effect.provide(AppNodeBuilder.build(RateLimit.node, []))).pipe(Effect.provide(PluginTestLayer)),
  )
})
