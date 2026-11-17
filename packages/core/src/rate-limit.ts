/**
 * Per-model rate budgets, as config declares them.
 *
 * The model-calling layer already knows how to wait for a rolling minute; this is where it is told
 * what each model allows. Keeping it a service means a config reload retunes the limiter of a
 * running process, and the free-tier preset ships as data rather than as a special case.
 */
export * as RateLimit from "./rate-limit.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { State } from "./state.js"

/** One rolling-minute budget. Absent field means that meter is not enforced. */
export type Budget = {
  readonly requestsPerMinute?: number
  readonly inputTokensPerMinute?: number
}

export type Model = {
  readonly providerID: string
  readonly id: string
}

/** `"provider/model"`, the same shape config keys a budget with. */
export const keyOf = (model: Model) => `${model.providerID}/${model.id}`

/** A budget for every model without one of its own. */
export const ANY = "*"

/**
 * Free-tier budgets worth knowing, in the same shape as config.
 *
 * Measured against the free tier of `google/gemini-3.5-flash-lite`: 15 requests and 250,000 input
 * tokens per rolling minute, both enforced at once. `google/gemini-3.8-flash` allows 5 requests per
 * minute but its token allowance is unknown, so only the request meter is set rather than guessing
 * one that would either stall real work or overspend the quota.
 */
export const FREE: Readonly<Record<string, Budget>> = {
  "google/gemini-3.5-flash-lite": { requestsPerMinute: 15, inputTokensPerMinute: 250_000 },
  "google/gemini-3.8-flash": { requestsPerMinute: 5 },
}

/** Env overrides, for a benchmark that wants one budget for whatever model it runs. */
export const ENV_RPM = "ORBIT_RATE_LIMIT_RPM"
export const ENV_TPM = "ORBIT_RATE_LIMIT_TPM"

/** Reads `ENV_RPM`/`ENV_TPM`; negative or unparsable values are ignored rather than throwing. */
export const fromEnv = (env: Readonly<Record<string, string | undefined>>): Budget | undefined => {
  const number = (value: string | undefined) => {
    if (value === undefined || value.trim() === "") return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }
  const requestsPerMinute = number(env[ENV_RPM])
  const inputTokensPerMinute = number(env[ENV_TPM])
  return requestsPerMinute === undefined && inputTokensPerMinute === undefined
    ? undefined
    : { requestsPerMinute, inputTokensPerMinute }
}

export type Editor = {
  /** Adds or replaces the budget of one `"<provider>/<model>"` key, or `ANY`. */
  readonly set: (model: string, budget: Budget) => void
}

export interface Interface extends State.Transformable<Editor> {
  /** The budget for this model, or undefined when it has none. Synchronous by request-path design. */
  readonly lookup: (model: Model) => Budget | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RateLimit") {}

/** A limiter whose config starts at `initial`; empty means "no budget until config says otherwise". */
export const layer = (initial: Readonly<Record<string, Budget>> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = State.create<Map<string, Budget>, Editor>({
        name: "rate-limit",
        initial: () => new Map(Object.entries(initial)),
        editor: (budgets) => ({ set: (model, budget) => void budgets.set(model, budget) }),
      })
      return Service.of({
        transform: state.transform,
        reload: state.reload,
        lookup: (model) => {
          const budgets = state.get()
          return budgets.get(keyOf(model)) ?? budgets.get(ANY)
        },
      })
    }),
  )

export const node = makeGlobalNode({ service: Service, layer: layer(), deps: [] })
