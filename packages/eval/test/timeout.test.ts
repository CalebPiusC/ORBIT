import { describe, expect } from "bun:test"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import { Deferred, Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { TestLLM } from "@opencode/ai/testing"
import { deterministicBackend } from "../src/backend/deterministic.js"
import type { BackendSession, EvalBackend } from "../src/backend/types.js"
import { DEFAULT_SESSION_TIMEOUT_MS, runFixture } from "../src/harness.js"
import { renderJson } from "../src/report.js"
import type { Fixture } from "../src/types.js"
import { it } from "./lib/effect.js"

/** Lists eval temp directories currently present in `os.tmpdir()`. */
const listEvalTempDirs = async (): Promise<string[]> => {
  const entries = await fs.readdir(os.tmpdir())
  return entries.filter((name) => name.startsWith("opencode-eval-"))
}

/**
 * Checks `/proc` on Linux for any live non-zombie process whose command line
 * contains `marker`. Returns matching PIDs.
 */
const findProcessesWithMarker = async (marker: string): Promise<number[]> => {
  if (process.platform !== "linux") return []
  let entries: string[]
  try {
    entries = await fs.readdir("/proc")
  } catch {
    return []
  }
  const matches: number[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === process.pid) continue
    try {
      const [cmdlineBuf, statText] = await Promise.all([
        fs.readFile(`/proc/${pid}/cmdline`),
        fs.readFile(`/proc/${pid}/stat`, "utf-8"),
      ])
      // Exclude zombie processes ('Z' state after comm field "(...) ").
      const stateAfterComm = statText.slice(statText.lastIndexOf(")") + 2)[0]
      if (stateAfterComm === "Z") continue
      const cmdline = cmdlineBuf.toString("utf-8").replaceAll("\0", " ")
      if (cmdline.includes(marker)) {
        matches.push(pid)
      }
    } catch {
      // Process exited between readdir and readFile.
    }
  }
  return matches
}

/** Creates a backend whose model stream hangs indefinitely once reached. */
const hangingBackend = (entered?: Deferred.Deferred<void>): EvalBackend => ({
  name: "deterministic",
  llmLayer: TestLLM.testLayer(),
  setup: () =>
    Effect.gen(function* () {
      const test = yield* TestLLM.Test
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
        if (entered) {
          Deferred.doneUnsafe(entered, Effect.void)
        }
        return TestLLM.hangAfter()
      })
      return {
        accounting: () => Effect.succeed(undefined),
      } satisfies BackendSession
    }) as unknown as Effect.Effect<BackendSession>,
})

describe("bounded session timeouts and cleanup", () => {
  it.effect("enforces DEFAULT_SESSION_TIMEOUT_MS when fixture.timeoutMs is omitted", () =>
    Effect.gen(function* () {
      expect(DEFAULT_SESSION_TIMEOUT_MS).toBe(30_000)

      const entered = yield* Deferred.make<void>()
      const fixture: Fixture = {
        id: "timeout-default",
        title: "Default session timeout",
        description: "Uses default 30s timeout",
        files: {},
        prompt: "Hang forever.",
        script: [],
        check: () => Effect.succeed({ pass: true, details: "should not pass" }),
      }

      const fiber = yield* runFixture(fixture, hangingBackend(entered)).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Effect.yieldNow

      // Advance just shy of the default 30s timeout: session must still be waiting.
      yield* TestClock.adjust(Duration.millis(DEFAULT_SESSION_TIMEOUT_MS - 1_000))
      yield* Effect.yieldNow
      expect(fiber.pollUnsafe()).toBeUndefined()

      // Advance past the 30s boundary: session must time out and report FAIL.
      yield* TestClock.adjust(Duration.millis(1_000))
      const result = yield* Fiber.join(fiber)

      expect(result.passed).toBe(false)
      expect(result.timedOut).toBe(true)
      expect(result.check.pass).toBe(false)
      expect(result.check.details).toBe(`session timed out after ${DEFAULT_SESSION_TIMEOUT_MS}ms`)
      expect(result.error).toBe(`session timed out after ${DEFAULT_SESSION_TIMEOUT_MS}ms`)
    }),
  )

  it.live("allows per-fixture timeoutMs override, reports timeout details, and cleans up temp dirs", () =>
    Effect.gen(function* () {
      const beforeDirs = new Set(yield* Effect.promise(listEvalTempDirs))
      const started = Date.now()

      const fixture: Fixture = {
        id: "timeout-override-llm",
        title: "Per-fixture timeout override on hanging model",
        description: "Overrides timeoutMs to 200ms",
        files: { "seed.txt": "initial" },
        prompt: "Hang forever.",
        timeoutMs: 200,
        script: [],
        check: () => Effect.succeed({ pass: true, details: "should not run" }),
      }

      const result = yield* runFixture(fixture, hangingBackend())
      const elapsed = Date.now() - started

      expect(elapsed).toBeLessThan(5_000)
      expect(result.passed).toBe(false)
      expect(result.timedOut).toBe(true)
      expect(result.check.pass).toBe(false)
      expect(result.check.details).toBe("session timed out after 200ms")
      expect(result.error).toBe("session timed out after 200ms")
      expect(result.report).toContain("- Result: FAIL")
      expect(result.report).toContain("- Timed out: yes")
      expect(result.report).toContain("session timed out after 200ms")

      const json = JSON.parse(renderJson(result)) as { passed: boolean; timedOut: boolean; error: string }
      expect(json.passed).toBe(false)
      expect(json.timedOut).toBe(true)
      expect(json.error).toBe("session timed out after 200ms")

      const afterDirs = yield* Effect.promise(listEvalTempDirs)
      const leakedDirs = afterDirs.filter((d) => !beforeDirs.has(d))
      expect(leakedDirs).toEqual([])
    }),
  )

  it.live("terminates foreground and background shell work and cleans up resources on timeout", () =>
    Effect.gen(function* () {
      const beforeDirs = new Set(yield* Effect.promise(listEvalTempDirs))
      const bgMarker = `eval-bg-timeout-${crypto.randomUUID()}`
      const fgMarker = `eval-fg-timeout-${crypto.randomUUID()}`

      const fixture: Fixture = {
        id: "timeout-shell-cleanup",
        title: "Shell foreground and background cleanup on timeout",
        description: "Starts background and foreground processes that outlive timeoutMs",
        files: {},
        prompt: "Run background and foreground tasks.",
        timeoutMs: 500,
        script: [
          {
            toolCalls: [
              {
                name: "shell",
                input: {
                  command: `bun -e "await Bun.sleep(30000)" -- ${bgMarker}`,
                  background: true,
                },
              },
            ],
          },
          {
            toolCalls: [
              {
                name: "shell",
                input: {
                  command: `bun -e "await Bun.sleep(30000)" -- ${fgMarker}`,
                },
              },
            ],
          },
          { text: "Done" },
        ],
        check: () => Effect.succeed({ pass: true, details: "should not pass" }),
      }

      const result = yield* runFixture(fixture, deterministicBackend())

      expect(result.passed).toBe(false)
      expect(result.timedOut).toBe(true)
      expect(result.error).toBe("session timed out after 500ms")

      // Temp directories (both workspace and global state) must be removed.
      const afterDirs = yield* Effect.promise(listEvalTempDirs)
      const leakedDirs = afterDirs.filter((d) => !beforeDirs.has(d))
      expect(leakedDirs).toEqual([])

      // Brief grace poll (up to 500ms) for OS process table reap after SIGTERM/SIGKILL,
      // then assert neither foreground nor background child process remains alive.
      let survivingBg = yield* Effect.promise(() => findProcessesWithMarker(bgMarker))
      let survivingFg = yield* Effect.promise(() => findProcessesWithMarker(fgMarker))
      for (let i = 0; i < 10 && (survivingBg.length > 0 || survivingFg.length > 0); i++) {
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)))
        survivingBg = yield* Effect.promise(() => findProcessesWithMarker(bgMarker))
        survivingFg = yield* Effect.promise(() => findProcessesWithMarker(fgMarker))
      }
      expect(survivingBg).toEqual([])
      expect(survivingFg).toEqual([])
    }),
  )
})
