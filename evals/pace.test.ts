import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { durationMs, parsePace, quotaStop, retryDelayMs, scoreLine, verdict } from "./pace"

// The body Google actually returned on the free tier, which is what a stopped eval prints.
const body = readFileSync(
  path.resolve(import.meta.dir, "../packages/core/test/fixtures/errors/google-429-free-tier-rpm.json"),
  "utf8",
)
const stopped = `error: provider request failed\n${body}\n`

describe("eval pacing", () => {
  test("turns requests per minute into a gap between task starts", () => {
    expect(parsePace("5")).toEqual({ perMinute: 5, intervalMs: 12_000 })
    expect(parsePace("2")).toEqual({ perMinute: 2, intervalMs: 30_000 })
    expect(parsePace(undefined)).toBeUndefined()
  })

  test("rejects a pace that is not a positive number", () => {
    expect(() => parsePace("0")).toThrow(/positive number/)
    expect(() => parsePace("fast")).toThrow(/positive number/)
  })

  test("reads the provider's own numbers", () => {
    expect(durationMs("2s")).toBe(2000)
    expect(durationMs("300ms")).toBe(300)
    expect(durationMs("1.5m")).toBe(90_000)
    expect(durationMs("soon")).toBeUndefined()
  })

  test("waits the retry delay out of a real throttle", () => {
    expect(retryDelayMs(stopped)).toBe(2000)
    expect(retryDelayMs('{"error":{"details":[{"retryDelay":"1.5s"}]}}')).toBe(1500)
    expect(retryDelayMs("rate limited, retry-after: 7")).toBe(7000)
    expect(retryDelayMs("nothing useful here")).toBeUndefined()
  })

  test("calls a failed run with Google's wording a quota stop", () => {
    expect(quotaStop({ exitCode: 1, transcript: stopped })).toBe(true)
    expect(quotaStop({ exitCode: 1, transcript: "error: 429 Too Many Requests" })).toBe(true)
    // A run that finished is scored, however often it was rate limited on the way.
    expect(quotaStop({ exitCode: 0, transcript: stopped })).toBe(false)
    // A real failure stays a failure.
    expect(quotaStop({ exitCode: 1, transcript: "error: test suite failed" })).toBe(false)
  })

  test("never reports a quota stop as a failure", () => {
    expect(verdict({ passed: true, quotaStopped: true })).toBe("pass")
    expect(verdict({ passed: false, quotaStopped: true })).toBe("invalid")
    expect(verdict({ passed: false, quotaStopped: false })).toBe("fail")
  })

  test("says how many tasks were invalid, and scores the rest", () => {
    expect(scoreLine({ pass: 2, fail: 1, invalid: 0 })).toBe("2/3 tasks passed. Results in evals/results/.")
    expect(scoreLine({ pass: 0, fail: 0, invalid: 3 })).toBe(
      "0/0 tasks passed. 3 tasks invalid (quota), not scored. Transcripts are in evals/results/.",
    )
    expect(scoreLine({ pass: 2, fail: 1, invalid: 1, harness: 1 })).toBe(
      "2/3 tasks passed. Not scored: 1 invalid (harness). Transcripts are in evals/results/.",
    )
    expect(scoreLine({ pass: 2, fail: 0, invalid: 3, harness: 1 })).toBe(
      "2/2 tasks passed. Not scored: 2 invalid (quota), 1 invalid (harness). Transcripts are in evals/results/.",
    )
  })

  // A task the agent never ran is not a quota stop and must not be counted as one: the two read
  // differently when someone asks whether the scoreboard was throttled or broken.
  test("names an agent error apart from a quota stop", () => {
    expect(scoreLine({ pass: 4, fail: 0, invalid: 2, agent: 2 })).toBe(
      "4/4 tasks passed. Not scored: 2 invalid (agent). Transcripts are in evals/results/.",
    )
    expect(scoreLine({ pass: 4, fail: 1, invalid: 2, agent: 1, harness: 1 })).toBe(
      "4/5 tasks passed. Not scored: 1 invalid (agent), 1 invalid (harness). Transcripts are in evals/results/.",
    )
    expect(scoreLine({ pass: 5, fail: 1, invalid: 1, agent: 1 })).toBe(
      "5/6 tasks passed. Not scored: 1 invalid (agent). Transcripts are in evals/results/.",
    )
  })
})
