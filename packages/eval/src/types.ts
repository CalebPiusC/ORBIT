/**
 * Shared types for the ORBIT evaluation harness.
 *
 * The evaluation package drives the inherited OpenCode agent engine over
 * deterministic coding-task fixtures. A fixture declares an initial workspace,
 * a prompt, a scripted trajectory for the deterministic backend, and a hidden
 * correctness check. The harness captures events, tool calls, diffs and metrics
 * and renders a completion report.
 */
import type { Effect } from "effect"

/** A single tool call the deterministic backend asks the agent to make. */
export type ToolCallSpec = {
  readonly name: string
  readonly input: Record<string, unknown>
}

/**
 * A scripted turn for the deterministic backend. A turn is either a batch of
 * tool calls (the engine executes them, then calls the model again with the
 * results) or a final text response that ends the trajectory.
 */
export type ScriptedTurn =
  | { readonly toolCalls: readonly ToolCallSpec[] }
  | { readonly text: string }

/** The workspace snapshot handed to a fixture's correctness check. */
export type CheckContext = {
  /** Absolute path to the fixture workspace. */
  readonly directory: string
  /** Initial file contents (path -> content), for diffing. */
  readonly initial: Readonly<Record<string, string>>
}

/** The outcome of a hidden correctness check. */
export type CheckResult = {
  readonly pass: boolean
  readonly details: string
}

/** A deterministic coding-task fixture. */
export type Fixture = {
  readonly id: string
  readonly title: string
  readonly description: string
  /** Files written into the workspace before the run (path -> content). */
  readonly files: Readonly<Record<string, string>>
  /** The prompt handed to the agent. */
  readonly prompt: string
  /** Scripted trajectory for the deterministic backend. */
  readonly script: readonly ScriptedTurn[]
  /** Hidden correctness check run after the agent finishes. */
  readonly check: (ctx: CheckContext) => Effect.Effect<CheckResult>
  /** Per-fixture session timeout in milliseconds. Defaults to 30_000. */
  readonly timeoutMs?: number
}

/** A captured tool call. */
export type CapturedToolCall = {
  readonly name: string
  readonly input: unknown
  readonly output?: unknown
  readonly error?: string
}

/** A captured bus event. */
export type CapturedEvent = {
  readonly type: string
  readonly data: unknown
}

/** A diff of a single file between initial and final state. */
export type FileDiff = {
  readonly path: string
  readonly before: string
  readonly after: string
  readonly changed: boolean
}

/** Metrics captured from a run. */
export type Metrics = {
  readonly steps: number
  readonly toolCalls: number
  readonly durationMs: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly errors: number
}

/**
 * High-level trajectory classification for a deterministic evaluation:
 * - "valid": valid scripted completion
 * - "incomplete-script": unused turns, script exhaustion, or missing scripted final response
 * - "unexpected-interaction": unexpected model calls or tool-call sequence mismatch
 * - "tool-failure": one or more tool executions failed during the session
 */
export type ScriptOutcome =
  | "valid"
  | "incomplete-script"
  | "unexpected-interaction"
  | "tool-failure"

/** Script accounting recorded by the deterministic backend. */
export type ScriptAccounting = {
  readonly scriptLength: number
  readonly turnsConsumed: number
  readonly unusedTurns: number
  readonly scriptExhausted: boolean
  readonly finalResponseScripted: boolean
  readonly unexpectedCalls: number
  readonly toolSequenceMismatch: boolean
  readonly failedToolCalls: number
  readonly details?: string
  readonly outcome: ScriptOutcome
}

/** The full result of running one fixture. */
export type EvalResult = {
  readonly fixtureId: string
  readonly backend: "deterministic" | "live"
  readonly passed: boolean
  readonly check: CheckResult
  readonly metrics: Metrics
  readonly toolCalls: readonly CapturedToolCall[]
  readonly diffs: readonly FileDiff[]
  readonly events: readonly CapturedEvent[]
  readonly report: string
  readonly error?: string
  readonly scriptAccounting?: ScriptAccounting
  readonly timedOut?: boolean
}
