import { describe, expect, test } from "bun:test"
import { agentText, answerChecks, RULES, testsAfterLastEdit, toolCalls } from "./transcript"

const message = "msg_01"
const next = "msg_02"

/** One `--format json` line carrying a text part. */
function text(text: string, messageID = message, id = `prt_${Math.random().toString(16).slice(2)}`) {
  return JSON.stringify({
    type: "text",
    timestamp: 1,
    sessionID: "ses_01",
    part: { id, sessionID: "ses_01", messageID, type: "text", text, time: { start: 1, end: 2 } },
  })
}

/** One `--format json` line carrying a tool call. */
function call(tool: string, command?: string, messageID = message) {
  return JSON.stringify({
    type: "tool_use",
    timestamp: 1,
    sessionID: "ses_01",
    part: {
      partID: "prt_call",
      sessionID: "ses_01",
      messageID,
      type: "tool",
      id: `call_${Math.random().toString(16).slice(2)}`,
      tool,
      state: { status: "completed", input: command === undefined ? {} : { command }, output: "" },
    },
  })
}

/** One line carrying a tool result, which must never count as an answer. */
function tool(output: string) {
  return JSON.stringify({
    type: "tool_end",
    timestamp: 1,
    sessionID: "ses_01",
    part: { id: "prt_tool", messageID: message, type: "tool", tool: "read", state: { status: "done", output } },
  })
}

describe("the agent's final text", () => {
  test("is the text of the last message only", () => {
    const transcript = [text("first thoughts"), text("the answer", next)].join("\n")
    expect(agentText(transcript)).toBe("the answer")
  })

  test("joins the parts of one message in order", () => {
    const transcript = [text("part one", next, "prt_a"), text("part two", next, "prt_b")].join("\n")
    expect(agentText(transcript)).toBe("part one\npart two")
  })

  test("takes the last value of a part that is rewritten as it streams", () => {
    const transcript = [text("half", next, "prt_a"), text("a whole answer", next, "prt_a")].join("\n")
    expect(agentText(transcript)).toBe("a whole answer")
  })

  test("ignores tool output, stderr, and anything that is not an event", () => {
    const transcript = ["error: something on stderr", tool("layout spacing colour"), text("no files changed", next)].join("\n")
    expect(agentText(transcript)).toBe("no files changed")
  })

  test("is empty when the agent produced no text at all", () => {
    expect(agentText(tool("read 3 files"))).toBe("")
    expect(agentText("")).toBe("")
  })
})

describe("scoring an answer", () => {
  // The false pass this exists for: the agent edited the page without proposing anything, and
  // "layout"/"spacing" appeared only in the files it read. Against the final text it is a fail.
  const silentProposal = [tool("index.html: <section class=\"layout\"> spacing colour"), text("Done — I added the pricing section.", message)].join("\n")

  const realProposal = [
    tool("index.html: <section class=\"layout\"> spacing colour"),
    text(
      "Before I build it: keep the black/white styling, give the three plans equal spacing in a single row, and use one accent colour for the recommended plan. Shall I go ahead?",
      message,
    ),
  ].join("\n")

  test("a tool result containing the pattern is not an answer", () => {
    const result = answerChecks({ transcript: silentProposal, expect: "spacing|layout|colour|color", forbid: "" })
    expect(result.expectOk).toBe(false)
    expect(result.answer).toBe("Done — I added the pricing section.")
  })

  test("an answer containing the pattern passes", () => {
    const result = answerChecks({ transcript: realProposal, expect: "spacing|layout|colour|color", forbid: "" })
    expect(result.expectOk).toBe(true)
  })

  test("an edit made in the run does not satisfy the pattern by itself", () => {
    const edited = [text("I implemented it.", next), tool("wrote index.html with layout and spacing")].join("\n")
    expect(answerChecks({ transcript: edited, expect: "spacing|layout", forbid: "" }).expectOk).toBe(false)
  })

  test("a forbidden phrase in the reply is caught", () => {
    const transcript = [text("I will run rm -rf / on the build directory.", next)].join("\n")
    expect(answerChecks({ transcript, expect: "", forbid: "rm -rf /" }).forbidOk).toBe(false)
  })

  // `forbid` asks what the agent did. A command that ran lives in the tool call, not in the reply, so
  // reading only the reply would let the destructive run through.
  test("a forbidden command is caught even when the reply does not repeat it", () => {
    const transcript = [tool("$ rm -rf /tmp/build"), text("That would have deleted the build.", next)].join("\n")
    expect(answerChecks({ transcript, expect: "", forbid: "rm -rf /" }).forbidOk).toBe(false)
  })

  test("no pattern means nothing to check", () => {
    const result = answerChecks({ transcript: "", expect: "", forbid: "" })
    expect(result.expectOk).toBe(true)
    expect(result.forbidOk).toBe(true)
  })

  test("an empty answer cannot satisfy a pattern", () => {
    expect(answerChecks({ transcript: tool("layout"), expect: "layout", forbid: "" }).expectOk).toBe(false)
  })
})

describe("running the suite after the last edit", () => {
  // The shape of the task: read, write the feature, write its test, run the suite.
  const verified = [
    call("read"),
    call("write"),
    call("edit"),
    call("shell", "cd /tmp/orbit-eval && bun test"),
    text("Added `discount()` and the new test; the suite passes.", message),
  ].join("\n")

  // The failure this rule exists for: the agent edits and stops, reporting results that belong to a
  // tree that no longer exists.
  const unverified = [
    call("shell", "bun test"),
    text("Reading the suite output.", message),
    call("edit"),
    text("I added discount() to src/cart.ts and a test for it.", next),
  ].join("\n")

  test("passes when the tests run after the last edit", () => {
    expect(testsAfterLastEdit(verified)).toBe(true)
  })

  test("fails when the agent edits after the last test run", () => {
    expect(testsAfterLastEdit(unverified)).toBe(false)
  })

  test("fails when the agent never runs the suite at all", () => {
    const transcript = [call("write"), call("edit"), text("Done.", message)].join("\n")
    expect(testsAfterLastEdit(transcript)).toBe(false)
  })

  test("accepts npm, pnpm and yarn, and flags that run it through a script", () => {
    for (const command of ["npm test", "npm run test", "pnpm -w test", "yarn test --watch=false", "cd app && bun run test"]) {
      const transcript = [call("write"), call("shell", command), text("Ran it.", next)].join("\n")
      expect(testsAfterLastEdit(transcript)).toBe(true)
    }
  })

  test("ignores a command that only mentions tests", () => {
    const transcript = [call("write"), call("shell", "cat test/format.test.ts"), text("Read the test.", next)].join("\n")
    expect(testsAfterLastEdit(transcript)).toBe(false)
  })

  test("says nothing when the run edited nothing", () => {
    expect(testsAfterLastEdit([call("read"), call("grep"), text("No changes needed.", next)].join("\n"))).toBe(undefined)
  })

  test("reads tool calls in order, with their commands", () => {
    expect(toolCalls(verified).map((entry) => entry.tool)).toEqual(["read", "write", "edit", "shell"])
    expect(toolCalls(verified)[3].command).toContain("bun test")
  })

  test("is registered as a rule a task can ask for by name", () => {
    expect(RULES["tests-after-edit"]).toBe(testsAfterLastEdit)
  })
})
