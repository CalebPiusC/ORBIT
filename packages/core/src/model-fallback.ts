export * as ModelFallback from "./model-fallback.js"

import { Model } from "@opencode/schema/model"
import type { ConfigFallback } from "@opencode/schema/config/fallback"
import type { SessionError } from "@opencode/schema/session-error"
import { Duration } from "effect"

/** What Orbit does when the current model stops accepting requests. */
export type Mode = "ask" | "always" | "never"

export interface Settings {
  readonly mode: Mode
  readonly models: ReadonlyArray<Model.Ref>
  readonly threshold: number
  readonly resetAfterMs: number
  readonly maxSwitches: number
}

/**
 * Backup models used when `fallback.models` is not configured. Provider agnostic in behaviour: any
 * model that is enabled in the catalog works here, the built-in list only seeds the default.
 */
export const DEFAULT_MODELS = ["openrouter/openrouter/free"] as const

export const defaults = {
  mode: "ask" as Mode,
  threshold: 3,
  resetAfter: 60 * 60 * 1000,
  maxSwitches: 3,
}

/** Session error types that mean "this model will not work right now", as opposed to "the request is wrong". */
const LIMIT_TYPES = new Set([
  "provider.rate-limit",
  "provider.quota",
  "provider.free-limit",
  "provider.budget-limit",
  "provider.go-limit",
  "provider.chatgpt-limit",
])

/** Limits with no meaningful wait: the account is out until the provider resets it. */
const CAP_TYPES = new Set([
  "provider.quota",
  "provider.free-limit",
  "provider.budget-limit",
  "provider.go-limit",
  "provider.chatgpt-limit",
])

export const isLimit = (error: SessionError.Error) => LIMIT_TYPES.has(error.type)

/**
 * Whether the provider reported an exhausted allowance rather than a momentary throttle.
 *
 * Google answers both with HTTP 429 and the same "You exceeded your current quota" opening, so the
 * message text alone cannot decide. A per-minute throttle names a "per minute" metric and usually
 * carries a short `retryAfterMs`, while the daily free-tier cap names a "per day" quota. Only the
 * second is worth abandoning the model for; the first is what the retry schedule exists for.
 */
export const isCap = (error: SessionError.Error) => {
  if (CAP_TYPES.has(error.type)) return true
  const text = `${error.message}\n${error.response?.body ?? ""}`
  if (!/quota|limit|exceeded/i.test(text)) return false
  return /per\s*[-_ ]?day|daily\b|perDay/i.test(text)
}

export interface SettingsInput {
  readonly fallback?: ConfigFallback.Info | undefined
}

export const settings = (input: SettingsInput = {}): Settings => {
  const fallback = input.fallback
  const models = (fallback?.models ?? []).map((selection) =>
    Model.Ref.make({
      providerID: selection.providerID,
      id: selection.model,
      ...(selection.variant === undefined ? {} : { variant: selection.variant }),
    }),
  )
  const resetAfter = fallback?.resetAfter
  return {
    mode: fallback?.mode ?? defaults.mode,
    models: models.length > 0 ? models : DEFAULT_MODELS.map((ref) => Model.Ref.parse(ref)),
    threshold: Math.max(1, fallback?.threshold ?? defaults.threshold),
    resetAfterMs: resetAfter === undefined ? defaults.resetAfter : Math.max(0, Duration.toMillis(resetAfter)),
    maxSwitches: Math.max(1, fallback?.maxSwitches ?? defaults.maxSwitches),
  }
}

export interface Decision {
  readonly error: SessionError.Error
  /** 1-based failure count on the current model; the retry policy reports attempt 2 for the first retry. */
  readonly attempt: number
  readonly settings: Settings
  readonly switches: number
}

/**
 * Rate limits must fail `threshold` times before the model is abandoned, so one stray 429 retries on
 * the same model instead of changing it. An exhausted allowance switches immediately: retrying a
 * capped account only delays the switch.
 */
export const shouldSwitch = (input: Decision) => {
  if (input.settings.mode === "never") return false
  if (input.switches >= input.settings.maxSwitches) return false
  if (!isLimit(input.error)) return false
  if (isCap(input.error)) return true
  return input.attempt >= input.settings.threshold
}

export const refOf = (info: Model.Info) => Model.Ref.make({ providerID: info.providerID, id: info.id })

export const sameModel = (left: Model.Ref, right: Model.Ref) =>
  left.providerID === right.providerID && left.id === right.id && (left.variant ?? "") === (right.variant ?? "")

export interface Candidate {
  readonly settings: Settings
  readonly current: Model.Ref
  /** Models already used this turn, so a chain never repeats itself. */
  readonly tried: ReadonlyArray<Model.Ref>
  readonly available: ReadonlyArray<Model.Info>
}

/** The first configured backup that is enabled, is not the current model, and has not been tried. */
export const candidate = (input: Candidate): Model.Ref | undefined => {
  for (const ref of input.settings.models) {
    if (sameModel(ref, input.current)) continue
    if (input.tried.some((tried) => sameModel(tried, ref))) continue
    const info = input.available.find((model) => sameModel(refOf(model), ref))
    if (!info) continue
    if (!info.capabilities.input.some((item) => item.startsWith("text"))) continue
    if (!info.capabilities.output.some((item) => item.startsWith("text"))) continue
    return ref
  }
  return undefined
}

/** When to consider the abandoned model usable again. Providers rarely say; the fallback is a wait. */
export const resetAt = (input: { error: SessionError.Error; now: number; settings: Settings }) =>
  input.now + (input.error.retryAfterMs ?? input.settings.resetAfterMs)

export const humanize = (durationMs: number) => {
  const minutes = Math.max(0, Math.round(durationMs / 60_000))
  if (minutes < 1) return "less than a minute"
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"}`
  const days = Math.round(hours / 24)
  return `about ${days} day${days === 1 ? "" : "s"}`
}

export const switched = (input: {
  readonly from: string
  readonly to: string
  readonly resetsInMs: number
  readonly reason: "limit" | "cap"
}) =>
  input.reason === "cap"
    ? `${input.from} reached its usage limit (resets in ${humanize(input.resetsInMs)}). Switched to ${input.to} and continuing this task.`
    : `${input.from} is rate limited. Switched to ${input.to} and continuing this task.`

export const returned = (input: { readonly from: string; readonly to: string }) =>
  `${input.from} is available again. Switched back to it from ${input.to}.`
