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

  test("reads the agent budget separately from the runner's own pace", () => {
    const args = parseArgs(["--rpm", "15", "--budget", "250000", "--pace", "5"])
    expect(args.rpm).toBe(15)
    expect(args.budget).toBe(250_000)
    expect(args.pace?.perMinute).toBe(5)
  })

  test("leaves the agent budget unset unless asked", () => {
    const args = parseArgs(["01"])
    expect(args.rpm).toBeUndefined()
    expect(args.budget).toBeUndefined()
  })

  test("refuses a budget that is not a positive whole number", () => {
    expect(parseArgs(["--rpm", "0"]).error).toBe('--rpm needs a positive whole number, not "0".')
    expect(parseArgs(["--budget", "1.5"]).error).toBe('--budget needs a positive whole number, not "1.5".')
    expect(parseArgs(["--budget", "lots"]).error).toBe('--budget needs a positive whole number, not "lots".')
    expect(parseArgs(["--rpm"]).error).toBe("--rpm needs a value.")
  })

  test("reports the first problem once", () => {
    expect(parseArgs(["--nope", "--also-nope"]).error).toBe("Unknown option --nope.")
  })
})
