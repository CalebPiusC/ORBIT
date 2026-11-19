import { describe, expect, test } from "bun:test"
import { agentCommand } from "./agent"

const repo = "/work/ORBIT"
const workdir = "/tmp/orbit-eval-01-abc123"

const command = () => agentCommand({ bun: "/usr/bin/bun", repo, workdir, prompt: "fix the test" })

/** The value that follows a flag, or undefined when the flag is absent. */
function valueAfter(argv: string[], flag: string) {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

describe("eval agent command", () => {
  // The bug this exists for: the agent was launched with the CLI's directory and nothing else, so it
  // listed sdks/ and packages/ and edited the checkout the evals are supposed to leave untouched.
  test("tells the agent to work in the fixture copy", () => {
    expect(valueAfter(command(), "--directory")).toBe(workdir)
  })

  test("the fixture copy is not the checkout", () => {
    const directory = valueAfter(command(), "--directory")
    expect(directory).toBeDefined()
    expect(directory).not.toBe(repo)
    expect(directory?.startsWith(repo)).toBe(false)
  })

  // The CLI still has to start in packages/cli; dropping this reintroduces the JSX resolution failure.
  test("still starts the CLI in packages/cli", () => {
    expect(valueAfter(command(), "--cwd")).toBe("/work/ORBIT/packages/cli")
  })

  test("keeps the flags the runner relies on", () => {
    const argv = command()
    expect(argv).toContain("run")
    expect(valueAfter(argv, "--format")).toBe("json")
    expect(argv).toContain("--auto")
    expect(valueAfter(argv, "--agent")).toBe("build")
    // The message is the positional argument, not a flag, and must survive intact.
    expect(argv[argv.indexOf("run", argv.indexOf("src/index.ts")) + 1]).toBe("fix the test")
  })

  test("passes the model only when one was chosen", () => {
    expect(valueAfter(command(), "--model")).toBeUndefined()
    expect(valueAfter(agentCommand({ bun: "bun", repo, workdir, prompt: "p", model: "google/gemini-3.5-flash-lite" }), "--model")).toBe(
      "google/gemini-3.5-flash-lite",
    )
  })

})
