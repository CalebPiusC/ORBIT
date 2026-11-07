/**
 * Command line for the eval runner.
 *
 * The runner spends real quota, so an argument it does not understand must stop it rather than run
 * the full suite: a typo used to cost the whole day's allowance on a free key.
 */
import { parsePace, type Pace } from "./pace"

export type Args = {
  /** Task id or file-name prefixes to run. Empty means every task. */
  readonly tasks: ReadonlyArray<string>
  readonly model: string | undefined
  readonly pace: Pace | undefined
  readonly dryRun: boolean
  readonly help: boolean
  /** A sentence for the user, set when the arguments cannot be used. */
  readonly error: string | undefined
}

export const USAGE = `Orbit behaviour evals

  bun evals/run.ts [options] [task...]

Options
  --task <name>     run one task by id or file name (e.g. --task fix-failing-test, --task 03)
  --model <ref>     model to run, e.g. google/gemini-3.5-flash-lite (default: your configured model)
  --pace <rpm>      leave 60000/rpm ms between task starts (e.g. --pace 15 for a free key)
  --dry-run         print the tasks and their checks, run nothing
  --help, -h        print this and exit

Tasks are also selected by bare prefix: \`bun evals/run.ts 01 04\`.

Free tiers are metered twice, by requests per minute and by input tokens per minute. --pace only
spaces task starts; what a task spends inside itself is the model's own budget. A run stopped by a
rate limit is reported INVALID (quota) and left out of the score.`

const TAKES_VALUE = new Set(["--task", "--model", "--pace"])
const FLAGS = new Set(["--dry-run", "--help", "-h"])

export function parseArgs(argv: ReadonlyArray<string>): Args {
  const tasks: string[] = []
  let model: string | undefined
  let pace: Pace | undefined
  let dryRun = false
  let help = false
  let error: string | undefined

  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index]!
    if (!raw.startsWith("-")) {
      tasks.push(raw)
      continue
    }
    const [flag, inline] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined]
    if (FLAGS.has(flag)) {
      if (inline !== undefined) {
        error ??= `${flag} does not take a value.`
        continue
      }
      if (flag === "--help" || flag === "-h") help = true
      else dryRun = true
      continue
    }
    if (!TAKES_VALUE.has(flag)) {
      error ??= `Unknown option ${flag}.`
      continue
    }
    const value = inline ?? argv[++index]
    if (value === undefined || value === "") {
      error ??= `${flag} needs a value.`
      continue
    }
    if (flag === "--model") model = value
    else if (flag === "--task") tasks.push(value)
    else {
      try {
        pace = parsePace(value)
      } catch (cause) {
        error ??= cause instanceof Error ? cause.message : String(cause)
      }
    }
  }

  return { tasks, model, pace, dryRun, help, error }
}
