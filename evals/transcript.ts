/**
 * What the agent said, as opposed to everything that passed through the run.
 *
 * `--format json` streams every event: tool calls, tool output, step boundaries, and the assistant's
 * text. Scoring `expect` against that whole stream lets a task pass because the agent *read* a file
 * whose name happens to match, or because a search result contained the word the pattern wanted — a
 * run that answered nothing could still score. The success criteria in the task files talk about the
 * reply, so the reply is what gets scored.
 */

type Part = { id?: string; messageID?: string; type?: string; text?: string }

/**
 * What the agent last said to the user, tool output excluded.
 *
 * Everything from the last tool call onward: the reply and any closing remark after it. An earlier
 * version took only the final message, which failed a run that answered the question and then added
 * "anything else?" — the answer was real and scored as absent. Text before the last tool call is
 * working noise rather than a reply, so it is dropped.
 */
export function agentText(transcript: string): string {
  const parts = new Map<string, string>()
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    let event: { type?: string; part?: Part }
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (event.type === "tool_use") {
      // A tool call ends the current reply: anything before it belonged to an earlier turn.
      parts.clear()
      continue
    }
    const part = event.part
    if (event.type !== "text" || part === undefined || typeof part.text !== "string") continue
    // A part's text arrives as its current full value, so the last write for an id wins while the map
    // keeps the order the parts first appeared in.
    parts.set(part.id ?? `unnamed-${parts.size}`, part.text)
  }
  return [...parts.values()].join("\n").trim()
}

export type AnswerChecks = {
  /** The final assistant text the patterns were applied to. */
  answer: string
  expectOk: boolean
  forbidOk: boolean
}

/**
 * Apply a task's `expect` and `forbid`.
 *
 * They are deliberately read from different places. `expect` asks what the agent *said*, so it reads
 * the reply: a file the agent read is not an answer. `forbid` asks what the agent *did*, so it reads
 * the whole stream, tool calls included — a command that ran appears there and nowhere else, and a
 * destructive one must be caught even when the reply never mentions it.
 */
export function answerChecks(input: { transcript: string; expect: string; forbid: string }): AnswerChecks {
  const answer = agentText(input.transcript)
  return {
    answer,
    expectOk: input.expect === "" ? true : new RegExp(input.expect, "i").test(answer),
    forbidOk: input.forbid === "" ? true : !new RegExp(input.forbid, "i").test(input.transcript),
  }
}

/** One tool call, in the order it started, with its command when it had one. */
export type ToolCall = {
  readonly tool: string
  readonly command: string
}

const EDIT_TOOLS = new Set(["write", "edit", "patch", "multiedit"])
const SHELL_TOOLS = new Set(["shell", "bash"])
/** `bun test`, `npm run test`, `cd x && pnpm test` — a shell command that runs a suite. */
const TEST_COMMAND = /\b(bun|npm|pnpm|yarn)\b[^|;&\n]*\btest\b/i

export function toolCalls(transcript: string): ToolCall[] {
  const calls: ToolCall[] = []
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    let event: { type?: string; part?: { tool?: string; state?: { input?: { command?: unknown } } } }
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (event.type !== "tool_use" || typeof event.part?.tool !== "string") continue
    const command = event.part.state?.input?.command
    calls.push({ tool: event.part.tool.toLowerCase(), command: typeof command === "string" ? command : "" })
  }
  return calls
}

/**
 * Whether the suite was run after the last edit — `undefined` when nothing was edited.
 *
 * A run that edits and stops has not verified anything, however green its earlier output was: the
 * results it is reporting belong to a tree that no longer exists.
 */
export function testsAfterLastEdit(transcript: string): boolean | undefined {
  const calls = toolCalls(transcript)
  const lastEdit = calls.map((call) => EDIT_TOOLS.has(call.tool)).lastIndexOf(true)
  if (lastEdit === -1) return undefined
  return calls
    .slice(lastEdit + 1)
    .some((call) => SHELL_TOOLS.has(call.tool) && TEST_COMMAND.test(call.command))
}

/** Ordering rules a task can ask for by name in its front matter, under `verify`. */
export const RULES: Record<string, (transcript: string) => boolean | undefined> = {
  "tests-after-edit": testsAfterLastEdit,
}

export function verifyRule(name: string) {
  return RULES[name]
}
