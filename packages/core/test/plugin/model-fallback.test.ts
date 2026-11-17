import { describe, expect } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
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

// The exact 429 Google's free tier returned for gemini-3.8-flash: five requests per minute, two
// seconds of RetryInfo, and the same opening sentence a real cap uses.
const body = readFileSync(path.resolve(import.meta.dir, "../fixtures/errors/google-429-free-tier-rpm.json"), "utf8")
const perMinute: SessionError.Error = {
  type: "provider.rate-limit",
  message: "You exceeded your current quota, please check your plan and billing details.",
  status: 429,
  response: { body },
}
// The same sentence naming a per-day quota and no retry hint: the shape that must switch at once.
const perDay: SessionError.Error = (() => {
  const parsed = JSON.parse(body)
  parsed.error.details = parsed.error.details.filter(
    (detail: { "@type": string }) => !detail["@type"].endsWith("RetryInfo"),
  )
  parsed.error.details[0].violations[0].quotaId = "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
  return {
    type: "provider.rate-limit",
    message: "You exceeded your current quota, please check your plan and billing details.",
    status: 429,
    response: { body: JSON.stringify(parsed) },
  }
})()
// A throttle with no advice at all: nothing to honour, so the decision is left alone.
const bare: SessionError.Error = { type: "provider.rate-limit", message: "Too many requests", status: 429 }

const retryEvent = (input: { error: SessionError.Error; attempt: number; model?: Model.Ref }) =>
  ({
    sessionID,
    agent,
    model: input.model ?? gemini,
    error: input.error,
    attempt: input.attempt,
    // What the retry schedule proposes before the plugin sees it.
    decision: { retry: true, delay: 2000 },
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
    const shown: string[] = []
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
      publish: ((
        definition: { type: string },
        value: { text: string; description?: string; metadata?: unknown },
      ) => {
        if (definition.type !== "session.synthetic") return Effect.die("unexpected event")
        notices.push(value.text)
        // A session notice renders `description`, so the sentence must be there or the user sees a label.
        shown.push(value.description ?? "")
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
    return { hooks, switches, notices, shown, metadata }
  })

describe("ModelFallbackPlugin", () => {
  it.effect("honours the provider's own retry delay instead of switching", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      const event = retryEvent({ error: perMinute, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      expect(run.notices).toEqual([])
      expect(event.decision).toEqual({ retry: true, delay: 2000 })
    }),
  )

  it.effect("leaves the decision alone when the provider gives no delay", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      const event = retryEvent({ error: bare, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      expect(event.decision).toEqual({ retry: true, delay: 2000 })
    }),
  )

  it.effect("switches after the threshold and continues the same task", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      yield* run.hooks.retry(retryEvent({ error: perMinute, attempt: 2 }) as never)
      const event = retryEvent({ error: perMinute, attempt: 3 })
      yield* run.hooks.retry(event as never)
      expect(run.switches.map((ref) => ref.id)).toEqual([Model.ID.make("openrouter/free")] as never)
      // A switch continues immediately; waiting out the retry delay would only slow the turn.
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
      // Off means off: the schedule's own proposal stands.
      expect(event.decision).toEqual({ retry: true, delay: 2000 })
    }),
  )

  it.effect("stops switching when no configured backup is enabled", () =>
    Effect.gen(function* () {
      const run = yield* harness({ models: [info(gemini, "Gemini 3.8 Flash")] })
      const event = retryEvent({ error: perDay, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      expect(event.decision).toEqual({ retry: true, delay: 2000 })
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

  it.effect("explains a rejected key in plain english, once", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      const auth: SessionError.Error = { type: "provider.auth", message: "API key not valid. Please pass a valid API key." }
      yield* run.hooks.retry(retryEvent({ error: auth, attempt: 2 }) as never)
      yield* run.hooks.retry(retryEvent({ error: auth, attempt: 3 }) as never)
      expect(run.switches).toEqual([])
      expect(run.notices).toEqual([
        'The provider rejected that API key. Paste a new one with "orbit auth login google" (free key: https://aistudio.google.com/apikey) or "orbit auth login openrouter" (free key: https://openrouter.ai/keys).',
      ])
    }),
  )

  it.effect("says a lost connection is not the user's fault", () =>
    Effect.gen(function* () {
      const run = yield* harness({})
      const transport: SessionError.Error = { type: "provider.transport", message: "fetch failed" }
      yield* run.hooks.retry(retryEvent({ error: transport, attempt: 2 }) as never)
      expect(run.notices).toEqual([
        "Orbit could not reach the model provider. Check your internet connection, then try again — nothing was lost.",
      ])
    }),
  )

  it.effect("tells the user how to add a backup when there is none", () =>
    Effect.gen(function* () {
      const run = yield* harness({ models: [info(gemini, "Gemini 3.8 Flash")] })
      const event = retryEvent({ error: perDay, attempt: 2 })
      yield* run.hooks.retry(event as never)
      expect(run.switches).toEqual([])
      const advice =
        'Gemini 3.8 Flash reached its usage limit. No backup model is set up. Add one with "orbit auth login openrouter" (free models), or pick another model with /model.'
      expect(run.notices).toEqual([advice])
      // The same sentence is what the terminal renders for the notice.
      expect(run.shown).toEqual([advice])
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
