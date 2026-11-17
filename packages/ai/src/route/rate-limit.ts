/**
 * The live side of a per-model budget: remembers what this process spent in the last minute and waits
 * instead of sending a request the provider would refuse with a 429.
 *
 * Waiting is the whole point. A free tier answers an over-budget request with a 429 and a two-second
 * `retryDelay`, which turns into a failed task; sleeping for the same two seconds turns it into a
 * request that succeeds.
 */
import { Clock, Context, Effect, Layer, Ref } from "effect"
import * as RateBudget from "./rate-budget.js"

export type ModelRef = {
  readonly providerID: string
  readonly id: string
}

export interface Interface {
  /** Wait until this request fits the budget, then record it. Returns how long it waited. */
  readonly reserve: (input: ModelRef & { readonly tokens: number }) => Effect.Effect<number>
  /** Charge the last reservation what the provider actually reported. */
  readonly settle: (input: ModelRef & { readonly estimated: number; readonly actual: number | undefined }) => Effect.Effect<void>
  /** What this model has spent in the current window. */
  readonly spend: (input: ModelRef) => Effect.Effect<RateBudget.Spend>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/RateLimit") {}

const keyOf = (model: ModelRef) => `${model.providerID}/${model.id}`

/** Never waits and never records: the behaviour of every model without configured limits. */
export const none: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of({
    reserve: () => Effect.succeed(0),
    settle: () => Effect.void,
    spend: () => Effect.succeed({ requests: 0, tokens: 0 }),
  }),
)

export type Options = {
  readonly windowMs?: number
  /** Overridable for tests; defaults to the real clock and a real sleep. */
  readonly now?: Effect.Effect<number>
  readonly sleep?: (millis: number) => Effect.Effect<void>
  /** Called once per wait, for a log line. */
  readonly onWait?: (input: {
    readonly providerID: string
    readonly id: string
    readonly limit: "requests" | "tokens"
    readonly spend: RateBudget.Spend
    readonly limits: RateBudget.Limits
    readonly waitMs: number
  }) => Effect.Effect<void>
}

/**
 * A limiter for the models `limitsFor` knows about.
 *
 * The lookup runs on every request, so a caller can change its answer at runtime (config reload, a
 * different model in the same session) without rebuilding the layer.
 */
export const layer = (
  limitsFor: (model: ModelRef) => RateBudget.Limits | undefined,
  options: Options = {},
): Layer.Layer<Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* Ref.make(new Map<string, ReadonlyArray<RateBudget.Entry>>())
      const now = options.now ?? Clock.currentTimeMillis
      const sleep = options.sleep ?? ((millis: number) => Effect.sleep(millis))
      const windowMs = options.windowMs ?? RateBudget.WINDOW_MS

      const reserve: Interface["reserve"] = Effect.fn("RateLimit.reserve")(function* (input) {
        const limits = limitsFor(input)
        if (limits === undefined) return 0
        const key = keyOf(input)
        const at = yield* now
        const entries = (yield* Ref.get(state)).get(key) ?? []
        const live = RateBudget.active(entries, at, windowMs)
        const before = RateBudget.spendOf(live)
        const waitMs = RateBudget.waitFor({ entries: live, now: at, tokens: input.tokens, limits, windowMs })
        if (waitMs > 0) {
          const which: "requests" | "tokens" =
            limits.requestsPerMinute !== undefined && before.requests + 1 > limits.requestsPerMinute
              ? "requests"
              : "tokens"
          if (options.onWait) yield* options.onWait({ ...input, limit: which, spend: before, limits, waitMs })
          yield* sleep(waitMs)
        }
        const sentAt = waitMs > 0 ? yield* now : at
        yield* Ref.update(state, (all) =>
          new Map(all).set(key, RateBudget.record(RateBudget.active(live, sentAt, windowMs), sentAt, input.tokens)),
        )
        return waitMs
      })

      const settle: Interface["settle"] = Effect.fn("RateLimit.settle")(function* (input) {
        const actual = input.actual
        if (actual === undefined) return
        const key = keyOf(input)
        yield* Ref.update(state, (all) => {
          const entries = all.get(key)
          if (entries === undefined) return all
          return new Map(all).set(key, RateBudget.settle(entries, actual))
        })
      })

      const spend: Interface["spend"] = Effect.fn("RateLimit.spend")(function* (input) {
        const at = yield* now
        const entries = (yield* Ref.get(state)).get(keyOf(input)) ?? []
        return RateBudget.spendOf(RateBudget.active(entries, at, windowMs))
      })

      return Service.of({ reserve, settle, spend })
    }),
  )

export * as RateBudget from "./rate-budget.js"
export * as RateLimit from "./rate-limit.js"
