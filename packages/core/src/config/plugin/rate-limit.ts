export * as ConfigRateLimitPlugin from "./rate-limit.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { RateLimit } from "../../rate-limit.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.rate-limit",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const rateLimit = yield* RateLimit.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, rateLimit.reload())
    yield* rateLimit.transform((editor) => {
      // Env first, so config can still name a model more precisely than "whatever this process runs".
      const env = RateLimit.fromEnv(process.env)
      if (env) editor.set(RateLimit.ANY, env)
      const configured = Config.latest(loaded.entries, "rate_limit")
      if (configured?.preset === "free") {
        for (const [model, budget] of Object.entries(RateLimit.FREE)) editor.set(model, budget)
      }
      for (const [model, budget] of Object.entries(configured?.models ?? {})) editor.set(model, budget)
    })
  }),
})
