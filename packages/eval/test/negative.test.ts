import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { deterministicBackend } from "../src/backend/deterministic.js"
import { fixtures } from "../src/fixtures/index.js"
import { runFixture } from "../src/harness.js"
import type { CheckResult, Fixture } from "../src/types.js"
import { it } from "./lib/effect.js"

const readFile = (directory: string, rel: string) =>
  Effect.tryPromise(() => fs.readFile(path.join(directory, rel), "utf-8")).pipe(
    Effect.match({ onFailure: () => "", onSuccess: (content) => content }),
  )

const write = (rel: string, content: string) => ({
  toolCalls: [{ name: "write", input: { path: rel, content } }],
})

const done = (text = "Done") => ({ text })

describe("negative evaluation regressions", () => {
  const backend = deterministicBackend()

  it.live("keeps the production fixture set strictly at the ten baseline tasks", () =>
    Effect.gen(function* () {
      expect(fixtures).toHaveLength(10)
      expect(fixtures.every((f) => !f.id.startsWith("neg-"))).toBe(true)
    }),
  )

  it.live("rejects incorrect output while distinguishing valid scripted completion", () =>
    Effect.gen(function* () {
      const fixture: Fixture = {
        id: "neg-wrong-answer",
        title: "Negative: wrong answer",
        description: "Script writes 5 but check expects 7",
        files: {},
        prompt: "Add 3 and 4. Write the result to answer.txt.",
        script: [write("answer.txt", "5"), done()],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return {
              pass: content.trim() === "7",
              details: `expected "7", got "${content.trim()}"`,
            }
          }),
      }

      const result = yield* runFixture(fixture, backend)
      expect(result.passed).toBe(false)
      expect(result.check.pass).toBe(false)
      expect(result.check.details).toContain('expected "7", got "5"')
      expect(result.scriptAccounting?.outcome).toBe("valid")
      expect(result.report).toContain("- Result: FAIL")
    }),
  )

  it.live("rejects missing expected files", () =>
    Effect.gen(function* () {
      const fixture: Fixture = {
        id: "neg-missing-file",
        title: "Negative: missing file",
        description: "Script writes wrong.txt instead of answer.txt",
        files: {},
        prompt: "Write the result to answer.txt.",
        script: [write("wrong.txt", "7"), done()],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return {
              pass: content.trim() === "7",
              details: `answer.txt is "${content.trim()}", expected "7"`,
            }
          }),
      }

      const result = yield* runFixture(fixture, backend)
      expect(result.passed).toBe(false)
      expect(result.check.pass).toBe(false)
      expect(result.diffs.map((d) => d.path)).toEqual(["wrong.txt"])
      expect(result.scriptAccounting?.outcome).toBe("valid")
    }),
  )

  it.live("rejects failed tool calls and records tool errors", () =>
    Effect.gen(function* () {
      const editMissing: Fixture = {
        id: "neg-failed-tool-edit",
        title: "Negative: failed edit tool call",
        description: "Script edits a file that does not exist",
        files: {},
        prompt: "Edit missing.txt.",
        script: [
          {
            toolCalls: [
              { name: "edit", input: { path: "missing.txt", oldString: "before", newString: "after" } },
            ],
          },
          done(),
        ],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "missing.txt")
            return {
              pass: content.includes("after"),
              details: `missing.txt content: "${content}"`,
            }
          }),
      }

      const result = yield* runFixture(editMissing, backend)
      expect(result.passed).toBe(false)
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0]?.error).toBeDefined()
      expect(result.scriptAccounting?.failedToolCalls).toBe(1)
      expect(result.scriptAccounting?.outcome).toBe("tool-failure")

      const externalWrite: Fixture = {
        id: "neg-failed-tool-external",
        title: "Negative: external write failure",
        description: "Script writes outside the workspace",
        files: {},
        prompt: "Write to answer.txt.",
        script: [
          { toolCalls: [{ name: "write", input: { path: "/nonexistent-dir-xyz/answer.txt", content: "7" } }] },
          done(),
        ],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "answer.txt")
            return { pass: content.trim() === "7", details: `got "${content.trim()}"` }
          }),
      }

      const externalResult = yield* runFixture(externalWrite, backend)
      expect(externalResult.passed).toBe(false)
      expect(externalResult.toolCalls[0]?.error).toBeDefined()
      expect(externalResult.scriptAccounting?.outcome).toBe("tool-failure")
    }),
  )

  it.live("rejects unexpected extra files created in the workspace", () =>
    Effect.gen(function* () {
      const fixture: Fixture = {
        id: "neg-unexpected-file",
        title: "Negative: unexpected extra file",
        description: "Script writes answer.txt and an unexpected extra file",
        files: {},
        prompt: "Write 7 to answer.txt.",
        script: [write("answer.txt", "7"), write("malicious.txt", "pwned"), done()],
        check: (ctx) =>
          Effect.gen(function* () {
            const answer = yield* readFile(ctx.directory, "answer.txt")
            const malicious = yield* readFile(ctx.directory, "malicious.txt")
            return {
              pass: answer.trim() === "7" && malicious === "",
              details: malicious
                ? `unexpected file created: malicious.txt = "${malicious}"`
                : "answer.txt is correct and no unexpected files",
            }
          }),
      }

      const result = yield* runFixture(fixture, backend)
      expect(result.passed).toBe(false)
      expect(result.check.pass).toBe(false)
      expect(result.check.details).toContain("unexpected file created: malicious.txt")
      expect(result.diffs.map((d) => d.path)).toEqual(["answer.txt", "malicious.txt"])
    }),
  )

  it.live("rejects unexpected modifications to initial workspace files", () =>
    Effect.gen(function* () {
      const initialContent = JSON.stringify({ mode: "original" }, null, 2)
      const modifiedContent = JSON.stringify({ mode: "hijacked" }, null, 2)
      const fixture: Fixture = {
        id: "neg-unexpected-modification",
        title: "Negative: unexpected modification",
        description: "Initial file is overwritten unexpectedly",
        files: { "config.json": initialContent },
        prompt: "Leave config.json in original mode.",
        script: [write("config.json", modifiedContent), done()],
        check: (ctx) =>
          Effect.gen(function* () {
            const content = yield* readFile(ctx.directory, "config.json")
            const parsed = JSON.parse(content) as { mode?: string }
            return {
              pass: parsed.mode === "original",
              details: `config.json mode is "${parsed.mode}", expected "original"`,
            }
          }),
      }

      const result = yield* runFixture(fixture, backend)
      expect(result.passed).toBe(false)
      expect(result.check.pass).toBe(false)
      expect(result.diffs).toHaveLength(1)
      expect(result.diffs[0]).toEqual({
        path: "config.json",
        before: initialContent,
        after: modifiedContent,
        changed: true,
      })
    }),
  )

  it.live("catches Effect defects, typed failures and synchronous throws in check functions", () =>
    Effect.gen(function* () {
      const defectFixture: Fixture = {
        id: "neg-check-defect",
        title: "Negative: check defects",
        description: "Check function dies with a defect",
        files: {},
        prompt: "Do nothing.",
        script: [done()],
        check: () => Effect.die(new Error("check deliberately failed")),
      }

      const defectResult = yield* runFixture(defectFixture, backend)
      expect(defectResult.passed).toBe(false)
      expect(defectResult.check.pass).toBe(false)
      expect(defectResult.check.details).toContain("check failed:")
      expect(defectResult.check.details).toContain("check deliberately failed")

      const throwFixture: Fixture = {
        id: "neg-check-throws",
        title: "Negative: check throws synchronously",
        description: "Check function throws before returning an Effect",
        files: {},
        prompt: "Do nothing.",
        script: [done()],
        check: () => {
          throw new Error("synchronous check explosion")
        },
      }

      const throwResult = yield* runFixture(throwFixture, backend)
      expect(throwResult.passed).toBe(false)
      expect(throwResult.check.pass).toBe(false)
      expect(throwResult.check.details).toContain("check threw: synchronous check explosion")

      const failFixture: Fixture = {
        id: "neg-check-typed-fail",
        title: "Negative: check fails with Effect.fail",
        description: "Check returns a failed Effect",
        files: {},
        prompt: "Do nothing.",
        script: [done()],
        check: () => Effect.fail(new Error("typed check failure")) as unknown as Effect.Effect<CheckResult>,
      }

      const failResult = yield* runFixture(failFixture, backend)
      expect(failResult.passed).toBe(false)
      expect(failResult.check.pass).toBe(false)
      expect(failResult.check.details).toContain("typed check failure")
    }),
  )
})
