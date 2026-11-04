/**
 * Backend interface for the evaluation harness. A backend supplies the LLM
 * client layer and a setup effect returning a per-run session handle. The
 * deterministic backend uses a scripted TestLLM and exposes script accounting;
 * live backends omit script accounting.
 */
import type { Effect, Layer } from "effect"
import type { CapturedToolCall, Fixture, ScriptAccounting } from "../types.js"

/** Per-run handle returned by `EvalBackend.setup`. */
export type BackendSession = {
  /** Finalizes and returns script accounting for the completed session, if applicable. */
  readonly accounting: (capturedToolCalls: readonly CapturedToolCall[]) => Effect.Effect<ScriptAccounting | undefined>
}

export type EvalBackend = {
  readonly name: "deterministic" | "live"
  /** LLM client layer to provide. Omit to use the live default. */
  readonly llmLayer: Layer.Layer<never, never, never> | undefined
  /** Setup effect run before the session starts (e.g. serve scripted responses). */
  readonly setup: (fixture: Fixture) => Effect.Effect<BackendSession>
}
