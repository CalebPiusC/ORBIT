export * as ModelFallbackPlugin from "./model-fallback.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Session } from "@opencode/schema/session"
import { Clock, Effect } from "effect"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { ModelFallback } from "../model-fallback.js"
import { SessionEvent } from "../session/event.js"
import { SessionErrorMessage } from "../session/error-message.js"
import { Service as ModelCatalog } from "../model.js"

/**
 * Keeps a Session on a working model.
 *
 * When the current model reports a rate limit it has retried past the threshold, or an exhausted
 * allowance, the next configured model is selected and the same task continues. The Session runner
 * reloads the Session model before every attempt, so the switch needs no restart and loses no context.
 *
 * Nothing here names a provider: candidates come from `fallback.models` and are filtered by the
 * catalog's own availability, so any provider can be a primary or a backup.
 */
export const Plugin = define({
  id: "orbit.model-fallback",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const catalog = yield* ModelCatalog
    const bus = yield* Bus.Service

    interface State {
      /** The model to restore when its limit lifts. */
      origin: Model.Ref
      /** The model in use now. */
      to: Model.Ref
      /** When `origin` is worth trying again. */
      until: number
      /** The wait applied last time, so a primary that is still capped waits longer. */
      waitedMs: number
      /** Models used since the last user message, so a chain never repeats itself. */
      readonly tried: ReadonlyArray<Model.Ref>
      /** Switches since the last user message, bounded by `fallback.maxSwitches`. */
      switches: number
      /** Escalated wait for an origin that is still capped when we return to it. */
      penalty: number
      returnedAt?: number
    }

    const sessions = new Map<Session.ID, State>()
    /** Sessions already told how to fix a key or network failure in this turn. */
    const advised = new Set<Session.ID>()
    const HOUR = 60 * 60 * 1000
    const DAY = 24 * HOUR

    const loadSettings = Effect.fn("ModelFallbackPlugin.settings")(function* () {
      return ModelFallback.settings({ fallback: Config.latest(yield* config.entries(), "fallback") })
    })

    const label = (ref: Model.Ref, available: ReadonlyArray<Model.Info>) =>
      available.find((info) => ModelFallback.sameModel(ModelFallback.refOf(info), ref))?.name ??
      `${ref.providerID}/${ref.id}`

    // Published as an event rather than admitted as input: the retry hook runs inside the turn, and
    // queueing input there would wait for that same turn to end.
    //
    // `description` is what a session notice renders on screen, so the sentence goes there too;
    // `text` is the part the next model request reads.
    const notify = (input: { sessionID: Session.ID; text: string; metadata: Record<string, unknown> }) =>
      bus
        .publish(SessionEvent.Synthetic, {
          sessionID: input.sessionID,
          text: input.text,
          description: input.text,
          metadata: input.metadata,
        })
        // A notice is never worth failing the request it describes.
        .pipe(Effect.orElseSucceed(() => undefined))

    const onRetry = Effect.fn("ModelFallbackPlugin.retry")(function* (event: SessionHooks["retry"]) {
      const settings = yield* loadSettings()
      if (!ModelFallback.isLimit(event.error)) {
        // A key or network failure is something the user can fix; say so once per turn.
        const advice = SessionErrorMessage.friendly(event.error)
        if (advice !== undefined && !advised.has(event.sessionID)) {
          advised.add(event.sessionID)
          yield* notify({ sessionID: event.sessionID, text: advice, metadata: { fallback: { advice: event.error.type } } })
        }
        return
      }
      if (settings.mode === "never") return
      const state = sessions.get(event.sessionID)
      if (
        !ModelFallback.shouldSwitch({
          error: event.error,
          attempt: event.attempt,
          settings,
          switches: state?.switches ?? 0,
        })
      )
        return
      const available = yield* catalog.available()
      const next = ModelFallback.candidate({
        settings,
        current: event.model,
        tried: state?.tried ?? [],
        available,
      })
      if (!next) {
        const available = yield* catalog.available()
        yield* notify({
          sessionID: event.sessionID,
          text: `${label(event.model, available)} ${
            ModelFallback.isCap(event.error) ? "reached its usage limit" : "is rate limited"
          }. ${SessionErrorMessage.NO_BACKUP}`,
          metadata: { fallback: { exhausted: true, model: event.model } },
        })
        return
      }
      const now = yield* Clock.currentTimeMillis
      const hint = ModelFallback.resetAt({ error: event.error, now, settings }) - now
      // Returning to a model that is still capped doubles the wait instead of ping-ponging.
      const returning =
        state !== undefined &&
        ModelFallback.sameModel(state.origin, event.model) &&
        state.returnedAt !== undefined &&
        now - state.returnedAt < HOUR
      const penalty = returning ? Math.min(Math.max(state.penalty, state.waitedMs) * 2, DAY) : 0
      const waitedMs = Math.max(hint, penalty)
      yield* ctx.session.switchModel({ sessionID: event.sessionID, model: next })
      sessions.set(event.sessionID, {
        origin: returning ? state.origin : event.model,
        to: next,
        until: now + waitedMs,
        waitedMs,
        tried: [...(state?.tried ?? []), event.model],
        switches: (state?.switches ?? 0) + 1,
        penalty,
        returnedAt: state?.returnedAt,
      })
      yield* notify({
        sessionID: event.sessionID,
        text: ModelFallback.switched({
          from: label(event.model, available),
          to: label(next, available),
          resetsInMs: waitedMs,
          reason: ModelFallback.isCap(event.error) ? "cap" : "limit",
        }),
        metadata: {
          fallback: {
            from: event.model,
            to: next,
            until: now + waitedMs,
            reason: ModelFallback.isCap(event.error) ? "cap" : "limit",
          },
        },
      })
      // Continue the same step on the new model without waiting out a retry delay.
      event.decision = { retry: true, delay: 0 }
    })

    const onPrompt = Effect.fn("ModelFallbackPlugin.prompt")(function* (event: SessionHooks["prompt"]) {
      advised.delete(event.sessionID)
      const state = sessions.get(event.sessionID)
      if (!state) return
      // A new user message starts a fresh switch budget.
      state.switches = 0
      const now = yield* Clock.currentTimeMillis
      if (now < state.until) return
      const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orElseSucceed(() => undefined))
      const current = session?.model
      if (!current || !ModelFallback.sameModel(current, state.to)) {
        // The user picked a model themselves; respect it and forget the fallback.
        sessions.delete(event.sessionID)
        return
      }
      const available = yield* catalog.available()
      yield* ctx.session.switchModel({ sessionID: event.sessionID, model: state.origin })
      state.penalty = Math.max(state.penalty, state.waitedMs)
      state.returnedAt = now
      // Nothing to restore until the origin runs out again.
      state.until = Number.POSITIVE_INFINITY
      yield* notify({
        sessionID: event.sessionID,
        text: ModelFallback.returned({ from: label(state.origin, available), to: label(state.to, available) }),
        metadata: { fallback: { from: state.to, to: state.origin, returned: true } },
      })
    })

    // A fallback that cannot run must never break the request it was meant to rescue.
    const guard = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
      effect.pipe(Effect.catchCause((cause) => Effect.logWarning("model fallback skipped", cause).pipe(Effect.asVoid)))

    yield* ctx.session.hook("retry", (event) => guard(onRetry(event)))
    yield* ctx.session.hook("prompt", (event) => guard(onPrompt(event)))
  }),
})
