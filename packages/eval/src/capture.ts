/**
 * Capture logic: extracts tool calls, file diffs and metrics from a completed
 * session. Tool calls and metrics come from the session messages (assistant
 * tool parts and token usage); diffs come from comparing the initial fixture
 * files against the final workspace state.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { CapturedToolCall, FileDiff, Metrics, CapturedEvent } from "./types.js"

/** Extracts plain text from a message content value (string or part array). */
const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text)
        return ""
      })
      .join("")
  }
  return ""
}

/** True when a request is a session-title generation side call. */
export const isTitleRequest = (messages: readonly { role: string; content: unknown }[]): boolean =>
  messages.length === 1 &&
  messages[0]?.role === "user" &&
  textOf(messages[0]?.content).includes("Reply with only the title")

/** Extracts captured tool calls from assistant message content. */
export const captureToolCalls = (messages: readonly SessionMessage.Info[]): CapturedToolCall[] => {
  const calls: CapturedToolCall[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    const content = message.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object" || (part as { type?: string }).type !== "tool") continue
      const tool = part as {
        name: string
        state: { status: string; input?: unknown; content?: unknown; error?: { message?: string } }
      }
      const state = tool.state
      const output = state.content
      calls.push({
        name: tool.name,
        input: state.input,
        output,
        error: state.status === "error" ? state.error?.message ?? "tool error" : undefined,
      })
    }
  }
  return calls
}

/** Reads every file under a directory (relative path -> content). */
const readWorkspace = async (directory: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {}
  const walk = async (dir: string) => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue
        await walk(full)
      } else if (entry.isFile()) {
        const rel = path.relative(directory, full)
        try {
          out[rel] = await fs.readFile(full, "utf8")
        } catch {
          // Unreadable files are skipped.
        }
      }
    }
  }
  await walk(directory)
  return out
}

/** Computes per-file diffs between the initial fixture files and the final workspace. */
export const captureDiffs = (
  directory: string,
  initial: Readonly<Record<string, string>>,
): Effect.Effect<FileDiff[]> =>
  Effect.promise(async () => {
    const final = await readWorkspace(directory)
    const paths = new Set([...Object.keys(initial), ...Object.keys(final)])
    const diffs: FileDiff[] = []
    for (const p of paths) {
      const before = initial[p] ?? ""
      const after = final[p] ?? ""
      if (before !== after) {
        diffs.push({ path: p, before, after, changed: true })
      }
    }
    return diffs.sort((a, b) => a.path.localeCompare(b.path))
  })

/** Computes run metrics from captured events and messages. */
export const captureMetrics = (
  events: readonly CapturedEvent[],
  messages: readonly SessionMessage.Info[],
  started: number,
): Metrics => {
  let steps = 0
  let errors = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const event of events) {
    if (event.type === "session.step.started") steps++
    if (event.type === "session.step.failed" || event.type === "session.execution.failed") errors++
  }
  for (const message of messages) {
    if (message.type !== "assistant") continue
    const tokens = (message as { tokens?: { inputTokens?: number; outputTokens?: number } }).tokens
    if (tokens) {
      inputTokens += tokens.inputTokens ?? 0
      outputTokens += tokens.outputTokens ?? 0
    }
  }
  return {
    steps,
    toolCalls: captureToolCalls(messages).length,
    durationMs: Date.now() - started,
    inputTokens,
    outputTokens,
    errors,
  }
}
