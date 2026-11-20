import { describe, expect, test } from "bun:test"
import { agentText, answerChecks } from "./transcript"

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

  test("a forbidden phrase in the answer is caught", () => {
    const transcript = [text("I will run rm -rf / on the build directory.", next)].join("\n")
    expect(answerChecks({ transcript, expect: "", forbid: "rm -rf /" }).forbidOk).toBe(false)
  })

  test("a forbidden phrase only in tool output is not attributed to the answer", () => {
    const transcript = [tool("$ rm -rf /tmp/build"), text("That would have deleted the build.", next)].join("\n")
    expect(answerChecks({ transcript, expect: "", forbid: "rm -rf /" }).forbidOk).toBe(true)
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
