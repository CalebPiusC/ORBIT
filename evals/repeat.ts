/**
 * Turning several runs of one task into one scoreboard line.
 *
 * A single run of a seven-task suite is one bit of signal per task, and two tasks flipped between runs
 * of the same commit — so a one-task-per-point scoreboard cannot tell a real improvement from a coin
 * landing the other way. Repeating a task turns that bit into a rate, and the rate is what gets read.
 *
 * The rule is strict on purpose: a task counts as passed only when every run passed. A task that
 * passes two times out of three is not "mostly fine" — it is the flakiness this exists to expose, and
 * the count next to it is the evidence. A run that ended INVALID leaves the whole task unscored
 * rather than averaging a number over a run that measured nothing.
 */
import type { Verdict } from "./pace"

/** The verdict across a task's runs, plus the count to print beside it. */
export type Tally = {
  readonly status: Verdict
  readonly passes: number
  readonly runs: number
  /** "2/3" — what the scoreboard shows for this task. */
  readonly label: string
}

export function tallyTasks(verdicts: ReadonlyArray<Verdict>): Tally {
  const runs = verdicts.length
  const passes = verdicts.filter((status) => status === "pass").length
  const label = `${passes}/${runs}`
  // No runs at all is not a pass: it is a task that never got measured.
  if (runs === 0) return { status: "invalid", passes, runs, label }
  if (verdicts.includes("invalid")) return { status: "invalid", passes, runs, label }
  return { status: passes === runs ? "pass" : "fail", passes, runs, label }
}
