/**
 * Deterministic evaluation backend. Uses TestLLM with a scripted responder
 * derived from the fixture's `script` field. Title-generation side-calls are
 * answered with a static title so they do not consume a script turn.
 *
 * Script accounting tracks every model turn and tool sequence:
 * - Unused scripted turns -> "incomplete-script"
 * - Script exhaustion before completion -> non-retryable failure + "incomplete-script"
 * - Completion without an explicit final text turn -> "incomplete-script"
 * - Unexpected model calls or tool-sequence mismatches -> "unexpected-interaction"
 * - Failed tool executions -> "tool-failure"
 *
 * Incomplete scripts never manufacture a synthetic final response.
 */
import { isDeepStrictEqual } from "node:util"
import { Effect } from "effect"
import { TestLLM, type Responder } from "@opencode/ai/testing"
import {
  AIError,
  InvalidRequestError,
  LLMEvent,
  type Message,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
} from "@opencode/ai"
import type { BackendSession, EvalBackend } from "./types.js"
import type { CapturedToolCall, ScriptAccounting, ScriptOutcome, ScriptedTurn, ToolCallSpec } from "../types.js"

/** Extracts concatenated text content from an LLM Message. */
const textOf = (message: Message): string =>
  message.content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("")

/** Detects OpenCode's session title-generation side-call. */
const isTitleRequest = (messages: readonly Message[]): boolean => {
  if (messages.length !== 1 || messages[0]?.role !== "user") return false
  const text = textOf(messages[0]).trim()
  return (
    (text.startsWith("Here is the first message of the conversation:") ||
      text.startsWith("Here is the conversation so far:")) &&
    text.endsWith("Reply with only the title.")
  )
}

/** Compares scripted tool input against observed tool input, ignoring undefined optional keys. */
const inputsMatch = (expected: Record<string, unknown>, actual: unknown): boolean => {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false
  const record = actual as Record<string, unknown>
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined) continue
    if (!(key in record) || !isDeepStrictEqual(record[key], value)) return false
  }
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && !(key in expected)) return false
  }
  return true
}

/** Non-retryable LLM error used to abort the session immediately on script faults. */
const scriptError = (message: string) =>
  TestLLM.failAfter(new AIError({ reason: new InvalidRequestError({ message }) }))

type Tracker = {
  turnsConsumed: number
  finalResponseScripted: boolean
  scriptExhausted: boolean
  unexpectedCalls: number
  toolSequenceMismatch: boolean
  observedToolFailures: number
  reasons: string[]
}

/** Checks that prior assistant tool calls and tool results match the consumed script prefix. */
const verifyPriorHistory = (
  script: readonly ScriptedTurn[],
  assistantMessages: readonly Message[],
  allMessages: readonly Message[],
): { readonly mismatch?: string; readonly errorResults: number } => {
  const toolResults = new Map<string, ToolResultPart>()
  let errorResults = 0
  for (const msg of allMessages) {
    for (const part of msg.content) {
      if (part.type === "tool-result") {
        toolResults.set(part.id, part)
        if (part.result.type === "error") errorResults++
      }
    }
  }

  for (let i = 0; i < assistantMessages.length; i++) {
    const expectedTurn = script[i]
    const actualAssistant = assistantMessages[i]
    if (!expectedTurn || !actualAssistant) continue
    const callParts = actualAssistant.content.filter((part): part is ToolCallPart => part.type === "tool-call")

    if ("toolCalls" in expectedTurn) {
      if (callParts.length !== expectedTurn.toolCalls.length) {
        return {
          mismatch: `turn ${i}: expected ${expectedTurn.toolCalls.length} tool call(s), observed ${callParts.length}`,
          errorResults,
        }
      }
      for (let j = 0; j < expectedTurn.toolCalls.length; j++) {
        const expected = expectedTurn.toolCalls[j]
        const actual = callParts[j]
        if (actual.name !== expected.name) {
          return {
            mismatch: `turn ${i} call ${j}: expected tool "${expected.name}", observed "${actual.name}"`,
            errorResults,
          }
        }
        const result = toolResults.get(actual.id)
        if (!result) {
          return {
            mismatch: `turn ${i} call ${j}: missing tool result for "${expected.name}" (${actual.id})`,
            errorResults,
          }
        }
        if (result.name !== expected.name) {
          return {
            mismatch: `turn ${i} call ${j}: expected tool result for "${expected.name}", observed "${result.name}"`,
            errorResults,
          }
        }
        if (result.result.type !== "error" && !inputsMatch(expected.input, actual.input)) {
          return {
            mismatch: `turn ${i} call ${j}: tool "${expected.name}" input differed from script`,
            errorResults,
          }
        }
      }
    } else if (callParts.length > 0) {
      return {
        mismatch: `turn ${i}: expected text response, observed ${callParts.length} tool call(s)`,
        errorResults,
      }
    }
  }

  return { errorResults }
}

/** Converts a fixture's scripted turns into a tracked TestLLM Responder. */
const toResponder = (script: readonly ScriptedTurn[], tracker: Tracker): Responder => (request) => {
  if (isTitleRequest(request.messages)) {
    return TestLLM.text("Fixture", "title")
  }

  const assistantMessages = request.messages.filter((m) => m.role === "assistant")
  const step = assistantMessages.length

  // A call arriving after a scripted final text response is an unexpected model interaction.
  if (tracker.finalResponseScripted) {
    tracker.unexpectedCalls++
    const message = "unexpected model call after scripted final response"
    tracker.reasons.push(message)
    return scriptError(message)
  }

  // Out-of-sequence assistant count indicates a subagent, retry, compaction, or stray generation.
  if (step !== tracker.turnsConsumed) {
    tracker.unexpectedCalls++
    const message = `unexpected model call at assistant step ${step} (expected ${tracker.turnsConsumed})`
    tracker.reasons.push(message)
    return scriptError(message)
  }

  // Verify tool-call and tool-result history from prior turns before serving the next turn.
  const history = verifyPriorHistory(script, assistantMessages, request.messages)
  tracker.observedToolFailures = Math.max(tracker.observedToolFailures, history.errorResults)
  if (history.mismatch !== undefined) {
    tracker.toolSequenceMismatch = true
    tracker.reasons.push(history.mismatch)
    return scriptError(`Tool sequence mismatch: ${history.mismatch}`)
  }

  // Script ran out of turns before producing a final response: fail loudly instead of manufacturing "Done".
  if (step >= script.length) {
    tracker.scriptExhausted = true
    const message = `script exhausted after ${tracker.turnsConsumed} turn(s) before session completed`
    tracker.reasons.push(message)
    return scriptError(message)
  }

  const turn = script[step]
  tracker.turnsConsumed++

  if ("toolCalls" in turn) {
    tracker.finalResponseScripted = false
    return TestLLM.toolCalls(
      ...turn.toolCalls.map((tc, i) =>
        LLMEvent.toolCall({ id: `call-${step}-${i}`, name: tc.name, input: tc.input }),
      ),
    )
  }

  tracker.finalResponseScripted = true
  return TestLLM.text(turn.text, `text-${step}`)
}

/** Finalizes script accounting against captured session tool calls. */
export const finalizeAccounting = (
  script: readonly ScriptedTurn[],
  tracker: Readonly<Tracker>,
  capturedToolCalls: readonly CapturedToolCall[],
): ScriptAccounting => {
  const reasons = [...tracker.reasons]
  let toolSequenceMismatch = tracker.toolSequenceMismatch

  // Expected tool calls across the turns that were actually served.
  const expectedCalls: ToolCallSpec[] = script
    .slice(0, tracker.turnsConsumed)
    .flatMap((turn) => ("toolCalls" in turn ? turn.toolCalls : []))

  if (!toolSequenceMismatch) {
    if (capturedToolCalls.length !== expectedCalls.length) {
      toolSequenceMismatch = true
      reasons.push(
        `expected ${expectedCalls.length} tool call(s) from consumed turns, captured ${capturedToolCalls.length}`,
      )
    } else {
      for (let i = 0; i < expectedCalls.length; i++) {
        const expected = expectedCalls[i]
        const actual = capturedToolCalls[i]
        if (actual.name !== expected.name) {
          toolSequenceMismatch = true
          reasons.push(`tool call ${i}: expected "${expected.name}", captured "${actual.name}"`)
          break
        }
        if (actual.error === undefined && !inputsMatch(expected.input, actual.input)) {
          toolSequenceMismatch = true
          reasons.push(`tool call ${i} ("${expected.name}"): captured input differed from script`)
          break
        }
      }
    }
  }

  const capturedErrors = capturedToolCalls.filter((c) => c.error !== undefined)
  const failedToolCalls = Math.max(tracker.observedToolFailures, capturedErrors.length)
  if (failedToolCalls > 0) {
    const summary = capturedErrors.map((c) => `${c.name}: ${c.error}`).join("; ")
    reasons.push(summary ? `tool execution failed (${summary})` : `${failedToolCalls} tool execution(s) failed`)
  }

  const unusedTurns = Math.max(0, script.length - tracker.turnsConsumed)
  if (unusedTurns > 0) {
    reasons.push(`script has ${unusedTurns} unused turn(s) (consumed ${tracker.turnsConsumed} of ${script.length})`)
  }
  if (!tracker.finalResponseScripted && !tracker.scriptExhausted) {
    reasons.push("session completed without an explicitly scripted final response")
  }

  let outcome: ScriptOutcome
  if (tracker.unexpectedCalls > 0 || toolSequenceMismatch) {
    outcome = "unexpected-interaction"
  } else if (failedToolCalls > 0) {
    outcome = "tool-failure"
  } else if (tracker.scriptExhausted || !tracker.finalResponseScripted || unusedTurns > 0) {
    outcome = "incomplete-script"
  } else {
    outcome = "valid"
  }

  return {
    scriptLength: script.length,
    turnsConsumed: tracker.turnsConsumed,
    unusedTurns,
    scriptExhausted: tracker.scriptExhausted,
    finalResponseScripted: tracker.finalResponseScripted,
    unexpectedCalls: tracker.unexpectedCalls,
    toolSequenceMismatch,
    failedToolCalls,
    ...(reasons.length > 0 ? { details: reasons.join("; ") } : {}),
    outcome,
  }
}

/** Creates a deterministic EvalBackend that serves and accounts for the fixture's script. */
export const deterministicBackend = (): EvalBackend => ({
  name: "deterministic",
  llmLayer: TestLLM.testLayer(),
  setup: (fixture) =>
    Effect.gen(function* () {
      const tracker: Tracker = {
        turnsConsumed: 0,
        finalResponseScripted: false,
        scriptExhausted: false,
        unexpectedCalls: 0,
        toolSequenceMismatch: false,
        observedToolFailures: 0,
        reasons: [],
      }
      // TestLLM.Test is provided by llmLayer (TestLLM.testLayer()), merged into
      // appLayer in buildAppLayer. The cast bridges the variance gap between
      // EvalBackend's closed Layer<never> contract and the concrete TestLLM tag.
      const test = yield* TestLLM.Test
      yield* test.serve(toResponder(fixture.script, tracker))
      return {
        accounting: (capturedToolCalls) =>
          Effect.sync(() => finalizeAccounting(fixture.script, tracker, capturedToolCalls)),
      } satisfies BackendSession
    }) as Effect.Effect<BackendSession>,
})
