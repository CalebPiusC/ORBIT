import { describe, expect, test } from "bun:test"
import { tallyTasks } from "./repeat"
import type { Verdict } from "./pace"

describe("several runs of one task", () => {
  test("passes when every run passed", () => {
    expect(tallyTasks(["pass", "pass", "pass"])).toEqual({ status: "pass", passes: 3, runs: 3, label: "3/3" })
  })

  // The case the whole feature exists for: a task that passes two of three is the flakiness a single
  // run hides, so it is scored as a failure with the count to prove it.
  test("fails when one run failed, and says how many passed", () => {
    expect(tallyTasks(["pass", "fail", "pass"])).toEqual({ status: "fail", passes: 2, runs: 3, label: "2/3" })
  })

  test("fails when every run failed", () => {
    expect(tallyTasks(["fail", "fail"])).toEqual({ status: "fail", passes: 0, runs: 2, label: "0/2" })
  })

  // An INVALID run measured nothing — quota, or the agent writing outside its fixture — so averaging
  // it in would score a task on a run that never ran.
  test("is unscored when any run was invalid, even if the others passed", () => {
    expect(tallyTasks(["pass", "invalid", "pass"])).toEqual({ status: "invalid", passes: 2, runs: 3, label: "2/3" })
    expect(tallyTasks(["invalid"]).status).toBe("invalid")
  })

  test("treats no runs as unscored rather than as a pass", () => {
    expect(tallyTasks([])).toEqual({ status: "invalid", passes: 0, runs: 0, label: "0/0" })
  })

  test("keeps a single run exactly as it was", () => {
    expect(tallyTasks(["pass" as Verdict])).toEqual({ status: "pass", passes: 1, runs: 1, label: "1/1" })
    expect(tallyTasks(["fail" as Verdict])).toEqual({ status: "fail", passes: 0, runs: 1, label: "0/1" })
  })
})
