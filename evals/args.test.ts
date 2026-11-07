import { describe, expect, test } from "bun:test"
import { parseArgs } from "./args"

describe("eval arguments", () => {
  test("reads the options the runner documents", () => {
    const args = parseArgs(["--model", "google/gemini-3.5-flash-lite", "--pace", "15", "--task", "01", "--dry-run"])
    expect(args).toMatchObject({ dryRun: true, help: false, error: undefined })
    expect(args.model).toBe("google/gemini-3.5-flash-lite")
    expect(args.pace).toEqual({ perMinute: 15, intervalMs: 4000 })
    expect(args.tasks).toEqual(["01"])
  })

  test("accepts a bare prefix as well as --task", () => {
    expect(parseArgs(["fix-failing-test"]).tasks).toEqual(["fix-failing-test"])
    const both = parseArgs(["--task", "03", "04"])
    expect(both.tasks).toEqual(["03", "04"])
    expect(both.error).toBeUndefined()
  })

  test("stops on an unknown flag instead of running the suite", () => {
    const args = parseArgs(["--dryrun"])
    expect(args.error).toBe("Unknown option --dryrun.")
  })

  test("prints usage for --help and takes no action", () => {
    expect(parseArgs(["--help"])).toMatchObject({ help: true, error: undefined, dryRun: false })
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  test("refuses options that are missing their value", () => {
    expect(parseArgs(["--task"]).error).toBe("--task needs a value.")
    expect(parseArgs(["--model"]).error).toBe("--model needs a value.")
    expect(parseArgs(["--pace"]).error).toBe("--pace needs a value.")
    expect(parseArgs(["--pace", "0"]).error).toMatch(/positive number/)
  })

  test("accepts --flag=value", () => {
    const args = parseArgs(["--task=04", "--model=x/y"])
    expect(args.tasks).toEqual(["04"])
    expect(args.model).toBe("x/y")
  })

  test("reports the first problem once", () => {
    expect(parseArgs(["--nope", "--also-nope"]).error).toBe("Unknown option --nope.")
  })
})
