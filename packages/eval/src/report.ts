/**
 * Completion report rendering. Turns a captured run into a human-readable
 * completion report (and a compact JSON shape) for CI and local review.
 */
import type { EvalResult, FileDiff } from "./types.js"

/** Summarizes a single file diff as added/removed line counts. */
const diffSummary = (diff: FileDiff): string => {
  const before = diff.before.split("\n")
  const after = diff.after.split("\n")
  const added = after.length - before.length
  return `${diff.path} (${added >= 0 ? "+" : ""}${added} lines)`
}

/** Renders a human-readable completion report for one fixture run. */
export const renderReport = (result: EvalResult): string => {
  const lines: string[] = []
  lines.push(`# Eval Report: ${result.fixtureId}`)
  lines.push("")
  lines.push(`- Backend: ${result.backend}`)
  lines.push(`- Result: ${result.passed ? "PASS" : "FAIL"}`)
  if (result.timedOut) {
    lines.push(`- Timed out: yes`)
  }
  if (result.scriptAccounting) {
    const sa = result.scriptAccounting
    const detailSuffix = sa.details ? ` — ${sa.details}` : ""
    lines.push(`- Script: ${sa.outcome} (${sa.turnsConsumed}/${sa.scriptLength} turns${detailSuffix})`)
  }
  lines.push(`- Check: ${result.check.details}`)
  if (result.error) lines.push(`- Error: ${result.error}`)
  lines.push("")
  lines.push("## Metrics")
  lines.push(`- Steps: ${result.metrics.steps}`)
  lines.push(`- Tool calls: ${result.metrics.toolCalls}`)
  lines.push(`- Duration: ${result.metrics.durationMs}ms`)
  lines.push(`- Input tokens: ${result.metrics.inputTokens}`)
  lines.push(`- Output tokens: ${result.metrics.outputTokens}`)
  lines.push(`- Errors: ${result.metrics.errors}`)
  lines.push("")
  lines.push("## Tool Calls")
  if (result.toolCalls.length === 0) {
    lines.push("- (none)")
  } else {
    for (const call of result.toolCalls) {
      const status = call.error ? `ERROR: ${call.error}` : "ok"
      lines.push(`- ${call.name} [${status}]`)
    }
  }
  lines.push("")
  lines.push("## Diffs")
  if (result.diffs.length === 0) {
    lines.push("- (no file changes)")
  } else {
    for (const diff of result.diffs) {
      lines.push(`- ${diffSummary(diff)}`)
    }
  }
  lines.push("")
  lines.push("## Events")
  lines.push(`- Captured ${result.events.length} events`)
  return lines.join("\n")
}

/** Renders a JSON completion report for machine consumption. */
export const renderJson = (result: EvalResult): string =>
  JSON.stringify(
    {
      fixtureId: result.fixtureId,
      backend: result.backend,
      passed: result.passed,
      timedOut: result.timedOut ?? false,
      scriptAccounting: result.scriptAccounting,
      check: result.check,
      metrics: result.metrics,
      toolCalls: result.toolCalls.map((c) => ({ name: c.name, error: c.error })),
      diffs: result.diffs.map((d) => d.path),
      error: result.error,
    },
    null,
    2,
  )
