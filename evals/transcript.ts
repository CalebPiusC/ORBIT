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

/** The text of the last assistant message, in the order the parts were emitted. */
export function agentText(transcript: string): string {
  const text = new Map<string, { messageID: string; text: string }>()
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    let event: { type?: string; part?: Part }
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    const part = event.part
    if (event.type !== "text" || part === undefined || typeof part.text !== "string") continue
    // A part's text arrives as its current full value, so the last write for an id wins while the map
    // keeps the order the parts first appeared in.
    text.set(part.id ?? part.messageID ?? String(text.size), { messageID: part.messageID ?? "", text: part.text })
  }
  if (text.size === 0) return ""
  const parts = [...text.values()]
  const last = parts[parts.length - 1].messageID
  return parts
    .filter((part) => part.messageID === last)
    .map((part) => part.text)
    .join("\n")
    .trim()
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
