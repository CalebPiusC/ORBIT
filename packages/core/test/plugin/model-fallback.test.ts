import { describe, expect } from "bun:test"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Session } from "@opencode/schema/session"
import type { SessionError } from "@opencode/schema/session-error"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Service as ModelCatalog } from "@opencode/core/model"
import { ModelFallbackPlugin } from "@opencode/core/plugin/model-fallback"
import { Provider } from "@opencode/core/provider"
import { Duration, Effect, Layer } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_fallback_test")
const agent = Agent.ID.make("build")
const gemini = Model.Ref.make({ providerID: Provider.ID.make("google"), id: Model.ID.make("gemini-3.8-flash") })
const router = Model.Ref.make({
  providerID: Provider.ID.make("openrouter"),
  id: Model.ID.make("openrouter/free"),
})

const info = (ref: Model.Ref, name: string): Model.Info =>
  ({
    ...Model.Info.default(ref.providerID, ref.id),
    name,
  }) as Model.Info

const available = [info(gemini, "Gemini 3.8 Flash"), info(router, "Free Models Router")]

// Both sentences are real Google free-tier wording: the 429 that opens either one looks identical
// until the quota metric name is read.
const perMinute: SessionError.Error = {
  type: "provider.rate-limit",
  message:
    "You exceeded your current quota, please check your plan and billing details. Quota exceeded for quota metric 'Generate Content API requests per minute'.",
  status: 429,
  retryAfterMs: 23_000,
}
const perDay: SessionError.Error = {
  type: "provider.rate-limit",
  message:
    "You exceeded your current quota, please check your plan and billing details. Quota exceeded for quota metric 'Generate Content API requests per day'.",
  status: 429,
}

const retryEvent = (input: { error: SessionError.Error; attempt: number; model?: Model.Ref }) =>
  ({
    sessionID,
    agent,
    model: input.model ?? gemini,
    error: input.error,
    attempt: input.attempt,
    decision: { retry: false },
  }) as SessionHooks["retry"]

const promptEvent = () => ({ sessionID, messageID: "msg_test", delivery: "immediate", prompt: {} }) as never

/** Hosts the plugin against stub services and captures what it does to the session. */
const harness = (input: {
  readonly fallback?: unknown
  readonly models?: ReadonlyArray<Model.Info>
  readonly sessionModel?: Model.Ref
}) =>
  Effect.gen(function* () {
    const switches: Model.Ref[] = []
    const notices: string[] = []
    const metadata: unknown[] = []
    const hooks: Record<string, (event: never) => Effect.Effect<void>> = {}
    const context = host({
      session: {
        hook: ((name: string, callback: (event: never) => Effect.Effect<void>) => {
          hooks[name] = callback
          return Effect.void
        }) as never,
        switchModel: ((value: { model: Model.Ref }) => {
          switches.push(value.model)
          return Effect.void
        }) as never,
        get: (() => Effect.succeed({ model: input.sessionModel })) as never,
      } as never,
    })
    const bus = Layer.succeed(Bus.Service, {
      publish: ((definition: { type: string }, value: { text: string; metadata?: unknown }) => {
        if (definition.type !== "session.synthetic") return Effect.die("unexpected event")
        notices.push(value.text)
        metadata.push(value.metadata)
        return Effect.void
      }) as never,
    } as never)
    const config = Layer.succeed(Config.Service, {
      entries: () =>
        Effect.succeed([{ type: "document" as const, info: { fallback: input.fallback } }] as never),
    } as never)
    const models = Layer.succeed(ModelCatalog, {
      available: () => Effect.succeed(input.models ?? available),
    } as never)
    yield* ModelFallbackPlugin.Plugin
      .effect(context)
      .pipe(Effect.provide(Layer.mergeAll(bus, config, models)))
    return { hooks, switches, notices, metadata }
  })

describe("ModelFallbackPlugin", () => {
  it.effect("retries one stray rate limit on the same model", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      const event = retryEvent({ error: perMinute, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      expect(run.notices).toEqual([])
      expect(event.decision).toEqual({ retry: false })
    }),
  )

  it.effect("switches after the threshold and continues the same task", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      yield* run.hooks.retry(retryEvent({ error: perMinute, attempt: 2 }) as never)
      const event = retryEvent({ error: perMinute, attempt: 3 })
      yield* run.hooks.retry(event as never)
      expect(run.switches.map((ref) => ref.id)).toEqual([Model.ID.make("openrouter/free")] as never)
      expect(event.decision).toEqual({ retry: true, delay: 0 })
      expect(run.notices).toEqual([
        "Gemini 3.8 Flash is rate limited. Switched to Free Models Router and continuing this task.",
      ])
    }),
  )

  it.effect("switches on the first attempt when Google reports the daily cap", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      const event = retryEvent({ error: perDay, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches.length).toBe(1)
      expect(event.decision).toEqual({ retry: true, delay: 0 })
      expect(run.notices[0]).toBe(
        "Gemini 3.8 Flash reached its usage limit (resets in about 1 hour). Switched to Free Models Router and continuing this task.",
      )
    }),
  )

  it.effect("does nothing when fallback is turned off", () =>
    Effect.gen(function* () {
      const run = yield* harness({ fallback: { mode: "never" } })
      const event = retryEvent({ error: perDay, attempt: 5 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      expect(event.decision).toEqual({ retry: false })
    }),
  )

  it.effect("stops switching when no configured backup is enabled", () =>
    Effect.gen(function* () {
      const run = yield* harness({ models: [info(gemini, "Gemini 3.8 Flash")] })
      const event = retryEvent({ error: perDay, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      expect(event.decision).toEqual({ retry: false })
    }),
  )

  it.effect("returns to the primary on the next message once the wait is over", () =>
    Effect.gen(function* () {
      const run = yield* harness({ fallback: { resetAfter: Duration.zero }, sessionModel: router })
      yield* run.hooks.retry(retryEvent({ error: perDay, attempt: 2 }) as never)
      expect(run.switches.length).toBe(1)
      yield* run.hooks.prompt(promptEvent())
      expect(run.switches.map((ref) => ref.id)).toEqual([
        Model.ID.make("openrouter/free"),
        Model.ID.make("gemini-3.8-flash"),
      ] as never)
      expect(run.notices.at(-1)).toBe(
        "Gemini 3.8 Flash is available again. Switched back to it from Free Models Router.",
      )
    }),
  )

  it.effect("stays on the backup until the wait is over", () =>
    Effect.gen(function* () {
      const run = yield* harness({ fallback: { resetAfter: Duration.hours(2) }, sessionModel: router })
      yield* run.hooks.retry(retryEvent({ error: perDay, attempt: 2 }) as never)
      yield* run.hooks.prompt(promptEvent())
      expect(run.switches.length).toBe(1)
    }),
  )

  it.effect("leaves a model the user picked alone", () =>
    Effect.gen(function* () {
      const other = Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-luna") })
      const run = yield* harness({ fallback: { resetAfter: Duration.zero }, sessionModel: other })
      yield* run.hooks.retry(retryEvent({ error: perDay, attempt: 2 }) as never)
      yield* run.hooks.prompt(promptEvent())
      expect(run.switches.length).toBe(1)
    }),
  )
})
