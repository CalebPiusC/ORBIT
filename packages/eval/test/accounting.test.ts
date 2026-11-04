import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Stream } from "effect"
import { LLMEvent, Message, ToolCallPart, ToolResultPart } from "@opencode/ai"
import { LanguageModel, LLMClient } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { deterministicBackend, finalizeAccounting } from "../src/backend/deterministic.js"
import type { BackendSession, EvalBackend } from "../src/backend/types.js"
import { runFixture } from "../src/harness.js"
import type { Fixture } from "../src/types.js"
import { it } from "./lib/effect.js"

const readFile = (directory: string, rel: string) =>
  Effect.tryPromise(() => fs.readFile(path.join(directory, rel), "utf-8")).pipe(
    Effect.match({ onFailure: () => "", onSuccess: (content) => content }),
  )

const write = (rel: string, content: string) => ({
  toolCalls: [{ name: "write", input: { path: rel, content } }],
})

const done = (text = "Done") => ({ text })

const testModel = LanguageModel.make({ id: "eval", provider: "test", route: OpenAIChat.route })

describe("deterministic script accounting", () => {
  const backend = deterministicBackend()

  it.live("classifies a complete matching trajectory as valid", () =>
    Effect.gen(function* () {
      const fixture: Fixture = {
        id: "acct-valid",
        title: "Valid scripted completion",
        description: "Consumes all turns and ends with explicit text",
        files: {},
        prompt: "Write 7 to answer.txt.",
        script: [write("answer.txt", "7"), done("All set")],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return { pass: content.trim() === "7", details: `answer.txt="${content.trim()}"` }
          }),
      }

      const result = yield* runFixture(fixture, backend)
      expect(result.passed).toBe(true)
      expect(result.scriptAccounting).toEqual({
        scriptLength: 2,
        turnsConsumed: 2,
        unusedTurns: 0,
        scriptExhausted: false,
        finalResponseScripted: true,
        unexpectedCalls: 0,
        toolSequenceMismatch: false,
        failedToolCalls: 0,
        outcome: "valid",
      })
      expect(result.report).toContain("- Script: valid (2/2 turns)")
    }),
  )

  it.live("detects unused trailing and post-text turns as incomplete-script", () =>
    Effect.gen(function* () {
      const trailingUnused: Fixture = {
        id: "acct-unused-trailing",
        title: "Unused trailing turns",
        description: "Script has extra unconsumed turns after completion",
        files: {},
        prompt: "Write 7 to answer.txt.",
        script: [write("answer.txt", "7"), done(), done(), done()],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return { pass: content.trim() === "7", details: "answer.txt is 7" }
          }),
      }

      const res1 = yield* runFixture(trailingUnused, backend)
      expect(res1.check.pass).toBe(true)
      expect(res1.passed).toBe(false)
      expect(res1.scriptAccounting?.outcome).toBe("incomplete-script")
      expect(res1.scriptAccounting?.turnsConsumed).toBe(2)
      expect(res1.scriptAccounting?.unusedTurns).toBe(2)
      expect(res1.error).toContain("unused turn")

      const earlyStop: Fixture = {
        id: "acct-unused-early-stop",
        title: "Early text before tool turn",
        description: "Text turn ends session before subsequent tool turn can run",
        files: {},
        prompt: "Do nothing.",
        script: [done("Stopping immediately"), write("never.txt", "1")],
        check: () => Effect.succeed({ pass: true, details: "permissive check" }),
      }

      const res2 = yield* runFixture(earlyStop, backend)
      expect(res2.passed).toBe(false)
      expect(res2.scriptAccounting?.outcome).toBe("incomplete-script")
      expect(res2.scriptAccounting?.turnsConsumed).toBe(1)
      expect(res2.scriptAccounting?.unusedTurns).toBe(1)
    }),
  )

  it.live("fails when script runs out of responses instead of manufacturing success", () =>
    Effect.gen(function* () {
      const exhausted: Fixture = {
        id: "acct-exhausted",
        title: "Script exhausted after tool call",
        description: "Writes correct file but omits final text turn",
        files: {},
        prompt: "Write 7 to answer.txt.",
        script: [write("answer.txt", "7")],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return { pass: content.trim() === "7", details: `answer.txt="${content.trim()}"` }
          }),
      }

      const res1 = yield* runFixture(exhausted, backend)
      // Workspace file is "7", so check.pass is true — only script accounting prevents false pass.
      expect(res1.check.pass).toBe(true)
      expect(res1.passed).toBe(false)
      expect(res1.scriptAccounting?.scriptExhausted).toBe(true)
      expect(res1.scriptAccounting?.finalResponseScripted).toBe(false)
      expect(res1.scriptAccounting?.outcome).toBe("incomplete-script")

      const emptyScript: Fixture = {
        id: "acct-empty",
        title: "Empty script",
        description: "Zero scripted turns",
        files: {},
        prompt: "Say hello.",
        script: [],
        check: () => Effect.succeed({ pass: true, details: "permissive check" }),
      }

      const res2 = yield* runFixture(emptyScript, backend)
      expect(res2.passed).toBe(false)
      expect(res2.scriptAccounting?.turnsConsumed).toBe(0)
      expect(res2.scriptAccounting?.scriptExhausted).toBe(true)
      expect(res2.scriptAccounting?.outcome).toBe("incomplete-script")
    }),
  )

  it.live("detects completion without an explicitly scripted final text response", () =>
    Effect.gen(function* () {
      const noFinalText: Fixture = {
        id: "acct-no-final-text",
        title: "Empty tool-calls turn stops session without text",
        description: "Turn has toolCalls: [] so session stops with no final text turn",
        files: {},
        prompt: "Do nothing.",
        script: [{ toolCalls: [] }],
        check: () => Effect.succeed({ pass: true, details: "permissive check" }),
      }

      const result = yield* runFixture(noFinalText, backend)
      expect(result.passed).toBe(false)
      expect(result.scriptAccounting?.turnsConsumed).toBe(1)
      expect(result.scriptAccounting?.scriptExhausted).toBe(false)
      expect(result.scriptAccounting?.finalResponseScripted).toBe(false)
      expect(result.scriptAccounting?.outcome).toBe("incomplete-script")
      expect(result.scriptAccounting?.details).toContain("without an explicitly scripted final response")
    }),
  )

  it.live("detects unexpected model calls during execution", () =>
    Effect.gen(function* () {
      // Spawning a subagent triggers an out-of-sequence child model call at assistant step 0
      // while the parent script is already at turn 1.
      const subagentFixture: Fixture = {
        id: "acct-unexpected-subagent",
        title: "Unexpected subagent model call",
        description: "Subagent triggers unscripted model interaction",
        files: {},
        prompt: "Delegate work.",
        script: [
          {
            toolCalls: [
              {
                name: "subagent",
                input: {
                  agent: "general",
                  description: "child task",
                  prompt: "Say hi",
                },
              },
            ],
          },
          done(),
        ],
        check: () => Effect.succeed({ pass: true, details: "permissive check" }),
      }

      const result = yield* runFixture(subagentFixture, backend)
      expect(result.passed).toBe(false)
      expect(result.scriptAccounting?.unexpectedCalls).toBeGreaterThan(0)
      expect(result.scriptAccounting?.outcome).toBe("unexpected-interaction")
    }),
  )

  it.effect("detects unexpected post-completion calls and request-level history mismatches in responder", () =>
    Effect.gen(function* () {
      const fixture: Fixture = {
        id: "acct-responder-direct",
        title: "Direct responder accounting",
        description: "Exercises post-completion call and history mismatch in deterministicBackend",
        files: {},
        prompt: "Say done.",
        script: [done("Finished")],
        check: () => Effect.succeed({ pass: true, details: "ok" }),
      }

      // 1. Post-completion model call after scripted final response (plus title side-call ignored).
      const postCompletionAccounting = yield* Effect.gen(function* () {
        const session = yield* backend.setup(fixture)
        const llm = yield* LLMClient.Service

        // Title side-call must not advance script or count as unexpected.
        yield* llm
          .stream({
            model: testModel,
            system: [],
            messages: [
              Message.user(
                "Here is the first message of the conversation:\n\n<message>\nSay done.\n</message>\n\nReply with only the title.",
              ),
            ],
            tools: [],
          })
          .pipe(Stream.runDrain)

        // First real call consumes the scripted final text turn.
        yield* llm
          .stream({
            model: testModel,
            system: [],
            messages: [Message.user("Say done.")],
            tools: [],
          })
          .pipe(Stream.runDrain)

        // Second call arrives after finalResponseScripted === true -> fails as unexpected call.
        const secondAttempt = yield* Effect.result(
          llm
            .stream({
              model: testModel,
              system: [],
              messages: [Message.user("Say done."), Message.assistant("Finished"), Message.user("One more?")],
              tools: [],
            })
            .pipe(Stream.runDrain),
        )
        expect(secondAttempt._tag).toBe("Failure")

        return yield* session.accounting([])
      }).pipe(Effect.provide(TestLLM.testLayer()))

      expect(postCompletionAccounting?.turnsConsumed).toBe(1)
      expect(postCompletionAccounting?.unexpectedCalls).toBe(1)
      expect(postCompletionAccounting?.outcome).toBe("unexpected-interaction")
      expect(postCompletionAccounting?.details).toContain("after scripted final response")

      // 2. Request-level prior tool-call history mismatch on step 1.
      const toolHistoryFixture: Fixture = {
        ...fixture,
        script: [write("answer.txt", "7"), done()],
      }
      const mismatchAccounting = yield* Effect.gen(function* () {
        const session = yield* backend.setup(toolHistoryFixture)
        const llm = yield* LLMClient.Service

        // Step 0 serves write("answer.txt", "7").
        yield* llm
          .stream({
            model: testModel,
            system: [],
            messages: [Message.user("Write 7.")],
            tools: [],
          })
          .pipe(Stream.runDrain)

        // Step 1 reports back a DIFFERENT tool name ("shell") in assistant history.
        const step1 = yield* Effect.result(
          llm
            .stream({
              model: testModel,
              system: [],
              messages: [
                Message.user("Write 7."),
                Message.assistant([
                  ToolCallPart.make({ id: "call-0-0", name: "shell", input: { command: "echo 7" } }),
                ]),
                Message.tool(
                  ToolResultPart.make({ id: "call-0-0", name: "shell", result: "7", resultType: "text" }),
                ),
              ],
              tools: [],
            })
            .pipe(Stream.runDrain),
        )
        expect(step1._tag).toBe("Failure")

        return yield* session.accounting([{ name: "shell", input: { command: "echo 7" } }])
      }).pipe(Effect.provide(TestLLM.testLayer()))

      expect(mismatchAccounting?.toolSequenceMismatch).toBe(true)
      expect(mismatchAccounting?.outcome).toBe("unexpected-interaction")
    }),
  )

  it.live("detects tool-call sequence mismatches in both live runs and accounting reconciliation", () =>
    Effect.gen(function* () {
      // Backend that serves a different tool sequence than what `fixture.script` declares,
      // while reconciling captured tool calls against `fixture.script`.
      const mismatchedBackend: EvalBackend = {
        name: "deterministic",
        llmLayer: TestLLM.testLayer(),
        setup: (fixture) =>
          Effect.gen(function* () {
            const test = yield* TestLLM.Test
            let step = 0
            yield* test.serve((request) => {
              const firstText =
                request.messages.length === 1 && request.messages[0]?.role === "user"
                  ? request.messages[0].content
                      .flatMap((p) => (p.type === "text" ? [p.text] : []))
                      .join("")
                  : ""
              if (firstText.endsWith("Reply with only the title.")) {
                return TestLLM.text("Fixture", "title")
              }
              const current = step++
              if (current === 0) {
                return TestLLM.toolCalls(
                  LLMEvent.toolCall({
                    id: "tampered-0",
                    name: "write",
                    input: { path: "answer.txt", content: "7" },
                  }),
                  LLMEvent.toolCall({
                    id: "tampered-1",
                    name: "write",
                    input: { path: "extra.txt", content: "unexpected" },
                  }),
                )
              }
              return TestLLM.text("Done", "text-1")
            })
            return {
              accounting: (capturedToolCalls) =>
                Effect.sync(() =>
                  finalizeAccounting(
                    fixture.script,
                    {
                      turnsConsumed: step,
                      finalResponseScripted: true,
                      scriptExhausted: false,
                      unexpectedCalls: 0,
                      toolSequenceMismatch: false,
                      observedToolFailures: 0,
                      reasons: [],
                    },
                    capturedToolCalls,
                  ),
                ),
            } satisfies BackendSession
          }) as unknown as Effect.Effect<BackendSession>,
      }

      const fixture: Fixture = {
        id: "acct-tool-mismatch",
        title: "Tool sequence mismatch",
        description: "Executed tool calls differ from scripted sequence",
        files: {},
        prompt: "Write 7 to answer.txt.",
        script: [write("answer.txt", "7"), done()],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return { pass: content.trim() === "7", details: "answer.txt is 7" }
          }),
      }

      const result = yield* runFixture(fixture, mismatchedBackend)
      expect(result.check.pass).toBe(true)
      expect(result.passed).toBe(false)
      expect(result.scriptAccounting?.toolSequenceMismatch).toBe(true)
      expect(result.scriptAccounting?.outcome).toBe("unexpected-interaction")

      const nameMismatch = finalizeAccounting(
        [write("answer.txt", "7"), done()],
        {
          turnsConsumed: 2,
          finalResponseScripted: true,
          scriptExhausted: false,
          unexpectedCalls: 0,
          toolSequenceMismatch: false,
          observedToolFailures: 0,
          reasons: [],
        },
        [{ name: "shell", input: { command: "echo 7 > answer.txt" } }],
      )
      expect(nameMismatch.toolSequenceMismatch).toBe(true)
      expect(nameMismatch.outcome).toBe("unexpected-interaction")

      const inputMismatch = finalizeAccounting(
        [write("answer.txt", "7"), done()],
        {
          turnsConsumed: 2,
          finalResponseScripted: true,
          scriptExhausted: false,
          unexpectedCalls: 0,
          toolSequenceMismatch: false,
          observedToolFailures: 0,
          reasons: [],
        },
        [{ name: "write", input: { path: "other.txt", content: "7" } }],
      )
      expect(inputMismatch.toolSequenceMismatch).toBe(true)
      expect(inputMismatch.outcome).toBe("unexpected-interaction")
    }),
  )

  it.live("distinguishes tool execution failure even when the fixture check passes", () =>
    Effect.gen(function* () {
      const fixture: Fixture = {
        id: "acct-tool-failure-permissive-check",
        title: "Tool execution failure with permissive check",
        description: "Tool fails, check passes, accounting still marks FAIL as tool-failure",
        files: {},
        prompt: "Edit nonexistent.txt.",
        script: [
          {
            toolCalls: [
              { name: "edit", input: { path: "nonexistent.txt", oldString: "a", newString: "b" } },
            ],
          },
          done(),
        ],
        check: () => Effect.succeed({ pass: true, details: "permissive check passed" }),
      }

      const result = yield* runFixture(fixture, backend)
      expect(result.check.pass).toBe(true)
      expect(result.passed).toBe(false)
      expect(result.scriptAccounting?.failedToolCalls).toBe(1)
      expect(result.scriptAccounting?.outcome).toBe("tool-failure")
      expect(result.error).toContain("script tool-failure")
    }),
  )
})
