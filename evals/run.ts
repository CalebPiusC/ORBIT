#!/usr/bin/env bun
/**
 * Orbit behaviour eval runner.
 *
 * Copies each fixture into a scratch git repository, runs the task prompt through `orbit run`
 * headlessly, applies the task's check, and writes a scoreboard. Use it before and after prompt or
 * agent-policy changes (Phase 4) to see whether careful behaviour actually improved.
 *
 *   bun evals/run.ts                       # every task, default model
 *   bun evals/run.ts 01 04                 # tasks whose id starts with the arguments
 *   bun evals/run.ts --model google/gemini-2.5-flash
 *   bun evals/run.ts --pace 5              # keep under 5 requests/minute (free tiers)
 *   bun evals/run.ts --rpm 15 --budget 250000   # let the agent wait out the rolling minute
 *   bun evals/run.ts --task 03             # one task only
 *   bun evals/run.ts --repeat 3            # each task three times, scored as a rate
 *   bun evals/run.ts --dry-run             # print what would run, touch nothing
 *   bun evals/run.ts --help                # print usage and stop
 *
 * Requires a configured provider (see `orbit auth login`). Nothing here runs in CI.
 *
 * A run stopped by rate limiting or quota is reported INVALID and left out of the score, because a
 * free tier running dry says nothing about the agent under test. `--pace` spaces task starts out, and
 * when the provider says how long to wait (Gemini's `retryDelay`) the runner waits that long and
 * tries the task again before giving up on it.
 *
 * Task checks are POSIX shell snippets, so a shell is required. On Windows that means Git Bash; the
 * runner finds it if it is installed anywhere standard and otherwise stops with instructions instead
 * of reporting a misleading "check failed" for every task.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { agentCommand } from "./agent"
import { USAGE, parseArgs } from "./args"
import { escaped, isRepositoryRoot, parseStatus } from "./guard"
import { parseTask, type Task } from "./task"
import { outcome } from "./outcome"
import { tallyTasks } from "./repeat"
import { answerChecks, verifyRule } from "./transcript"
import { quotaStop, retryDelayMs, scoreLine, type Verdict } from "./pace"
import { tmpdir } from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir)
const repo = path.resolve(root, "..")
const results = path.join(root, "results")
const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(USAGE)
  process.exit(0)
}
if (args.error !== undefined) {
  console.error(`${args.error}\n\n${USAGE}`)
  process.exit(2)
}
const { dryRun, model, pace, rpm, budget, repeat, tasks: filters } = args

/** Attempts per task when the provider keeps saying "wait this long". */
const ATTEMPTS = 3

/** Space task starts out so a per-minute budget is not spent in one burst. */
let nextStart = 0
function paceNow() {
  if (!pace || dryRun) return
  const wait = nextStart - Date.now()
  if (wait > 0) Bun.sleepSync(wait)
  nextStart = Date.now() + pace.intervalMs
}

const wait = (ms: number) => {
  if (ms > 0) Bun.sleepSync(ms)
}

/**
 * A POSIX shell for task checks, or undefined when the machine has none.
 *
 * Windows PowerShell cannot run these checks, and a missing shell used to look like a failing task,
 * so the candidates are probed once and the absence is reported plainly.
 */
function findShell(): string[] | undefined {
  const local = process.env.LOCALAPPDATA
  const candidates =
    process.platform === "win32"
      ? [
          "bash",
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
          ...(local ? [path.join(local, "Programs", "Git", "bin", "bash.exe")] : []),
        ]
      : ["bash"]
  for (const candidate of candidates) {
    const probe = Bun.spawnSync([candidate, "-c", "true"], { stdout: "ignore", stderr: "ignore" })
    if (probe.exitCode === 0) return [candidate, "-lc"]
  }
  return undefined
}

const shell = findShell()
if (!shell && !dryRun) {
  console.error(
    [
      "These checks need a POSIX shell (bash), and none was found on this machine.",
      "",
      "On Windows, install Git for Windows (it includes Git Bash), then run this again:",
      "  winget install --id Git.Git -e",
      "Or run the eval inside WSL, a Codespace, or any Linux machine.",
      "",
      "Nothing was scored; no task result is being reported as a failure.",
    ].join("\n"),
  )
  process.exit(2)
}

/**
 * The agent's own budget for this run, handed over as environment because the agent is a separate
 * process. Unset means the agent keeps whatever config says, which is today's behaviour.
 */
const budgetEnv = {
  ...(rpm === undefined ? {} : { ORBIT_RATE_LIMIT_RPM: String(rpm) }),
  ...(budget === undefined ? {} : { ORBIT_RATE_LIMIT_TPM: String(budget) }),
}

function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env })
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

const tasks = readdirSync(path.join(root, "tasks"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => parseTask(path.join(root, "tasks", name)))
  .filter(
    (task) =>
      filters.length === 0 ||
      filters.some(
        (filter) =>
          task.id.startsWith(filter) || path.basename(task.file).startsWith(filter) || task.file.endsWith(`/${filter}.md`),
      ),
  )

if (tasks.length === 0) {
  console.error(`No task matched ${filters.map((filter) => `"${filter}"`).join(", ")}.\n\n${USAGE}`)
  process.exit(1)
}

const orbit = (message: string, workdir: string) =>
  agentCommand({ bun: process.execPath, repo, workdir, prompt: message, model })

/**
 * The checkout's status, for the guard. A task is scored on its own copy, so anything new here is
 * work the agent did somewhere it was not asked to.
 */
const checkoutStatus = () => parseStatus(run(["git", "status", "--porcelain", "--untracked-files=all"], repo).stdout)
const baseline = checkoutStatus()

/** What this run is measuring. A scoreboard without it is a number nobody can attribute. */
const commit = run(["git", "rev-parse", "HEAD"], repo).stdout.trim()
let escapedAny = false

mkdirSync(results, { recursive: true })
const summary: Array<Record<string, unknown>> = []

/** What one run of one task produced, for the caller that aggregates repetitions. */
type AttemptOutcome = {
  status: Verdict
  passed: boolean
  checkOk: boolean
  reason: "harness" | "quota" | "agent" | undefined
}

/**
 * One run of one task: a fresh copy of the fixture, one agent session, one check, its own artifacts.
 *
 * A repetition gets its own copy on purpose — a second attempt that inherited the first one's working
 * tree would be measuring leftover edits rather than the agent. `--pace` is honoured at the start of
 * every attempt, so repeating a task does not spend the minute's budget in one burst.
 */
function attemptTask(task: Task, repetition: number): AttemptOutcome {
  const workdir = path.join(mkdtempSync(path.join(tmpdir(), `orbit-eval-${task.id}-`)))
  cpSync(path.join(root, "fixtures", task.fixture), workdir, { recursive: true })
  run(["git", "init", "-q"], workdir)
  run(["git", "add", "-A"], workdir)
  run(["git", "-c", "user.email=eval@orbit.local", "-c", "user.name=orbit-eval", "commit", "-qm", "fixture"], workdir)

  paceNow()
  console.log(`\n▶ ${task.id} — ${task.title}${repeat === 1 ? "" : `  (run ${repetition}/${repeat})`}`)
  console.log(`  workdir: ${workdir}`)
  if (rpm !== undefined || budget !== undefined) {
    console.log(
      `  budget:  ${rpm === undefined ? "no request cap" : `${rpm} requests/min`}, ${
        budget === undefined ? "no token cap" : `${budget.toLocaleString("en-US")} input tokens/min`
      }`,
    )
  }

  const started = Date.now()
  let agent = run(orbit(task.prompt, workdir), workdir, { ...process.env, ...budgetEnv })
  let transcript = `${agent.stdout}\n${agent.stderr}`
  for (let attempt = 1; attempt < ATTEMPTS; attempt++) {
    if (!quotaStop({ exitCode: agent.code, transcript })) break
    const delay = retryDelayMs(transcript) ?? pace?.intervalMs ?? 5000
    console.log(`  the provider asked for ${(delay / 1000).toFixed(1)}s; waiting and trying again (attempt ${attempt + 1} of ${ATTEMPTS})`)
    paceNow()
    wait(Math.max(delay, 1000))
    agent = run(orbit(task.prompt, workdir), workdir, { ...process.env, ...budgetEnv })
    transcript = `${agent.stdout}\n${agent.stderr}`
  }
  const throttled = quotaStop({ exitCode: agent.code, transcript })

  // A check that runs in a copy the agent never entered says nothing, so the copy has to be its own
  // repository root and the checkout has to be exactly as it was before the task started.
  const toplevel = run(["git", "rev-parse", "--show-toplevel"], workdir).stdout.trim()
  const rooted = isRepositoryRoot(toplevel, workdir)
  const touched = escaped(baseline, checkoutStatus())
  const harness = rooted
    ? touched.length === 0
      ? undefined
      : `the agent wrote outside its fixture: ${touched.join(", ")}`
    : `the fixture copy is not its own git root (git says ${toplevel === "" ? "nothing" : toplevel})`
  if (harness !== undefined && touched.length > 0) escapedAny = true

  const check =
    throttled || harness !== undefined
      ? { code: 1, stdout: "", stderr: "" }
      : run([...(shell ?? ["bash", "-lc"]), task.check], workdir)
  // `expect` reads the agent's reply and `forbid` reads the whole stream: what it said, and what it
  // did. A tool result that happens to contain the pattern is not an answer; a command that ran is
  // still something it did.
  const { answer, expectOk, forbidOk } = answerChecks({ transcript, expect: task.expect, forbid: task.forbid })
  // A named ordering rule, e.g. "the suite ran after the last edit". Undefined means the task asked
  // for nothing, or the run made no edit for the rule to care about.
  const verify = verifyRule(task.verify)
  const verifyOk = verify === undefined ? true : verify(transcript) !== false
  // A run that never reached the agent is INVALID, not a pass and not a failure: safety tasks ask for
  // no particular words, so an error line satisfied them. See outcome.ts.
  const result = outcome({
    exitCode: agent.code,
    transcript,
    quotaStopped: throttled,
    harness,
    checkCode: check.code,
    expectOk,
    forbidOk,
    verifyOk,
  })
  const status = result.status
  const passed = status === "pass"

  // One run writes straight into the task's folder, which is the layout every earlier artifact had.
  // Repeats get a folder each, so the second run cannot overwrite the evidence of the first.
  const directory = repeat === 1 ? path.join(results, task.id) : path.join(results, task.id, `run-${repetition}`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, "transcript.log"), transcript)
  writeFileSync(path.join(directory, "answer.md"), answer === "" ? "" : `${answer}\n`)
  writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(
      {
        task: task.id,
        run: repeat === 1 ? undefined : repetition,
        status,
        reason: result.reason,
        passed,
        quotaStopped: throttled,
        agent: { exitCode: agent.code, message: result.reason === "agent" ? result.message : undefined },
        harness: { rooted, toplevel, touched, message: harness },
        check,
        answer,
        expectOk,
        forbidOk,
        verify: task.verify === "" ? undefined : { rule: task.verify, ok: verifyOk },
        ms: Date.now() - started,
      },
      null,
      2,
    ),
  )

  if (status === "invalid") {
    console.log(
      result.reason === "harness"
        ? `  INVALID (harness)  ${result.message}`
        : result.reason === "agent"
          ? `  INVALID (agent)  ${result.message}; the agent never ran the task, so nothing is scored`
          : `  INVALID (quota)  the run was stopped by rate limiting, not by the task; not scored`,
    )
  } else {
    console.log(
      `  ${passed ? "PASS" : "FAIL"}  check=${check.code === 0 ? "ok" : "failed"} expect=${expectOk} forbid=${forbidOk}` +
        (task.verify === "" ? "" : ` ${task.verify}=${verifyOk}`),
    )
    if (!passed && task.scoring === "rubric") console.log(`  (rubric task: read ${path.join(directory, "transcript.log")})`)
  }
  console.log(`  transcript: ${path.join(directory, "transcript.log")}`)

  return { status, passed, checkOk: check.code === 0, reason: result.reason }
}

for (const task of tasks) {
  if (dryRun) {
    console.log(`\n▶ ${task.id} — ${task.title}`)
    console.log(`  prompt:  ${task.prompt.split("\n")[0]}`)
    console.log(`  check:   ${task.check}`)
    if (repeat > 1) console.log(`  repeat:  ${repeat} runs per task`)
    continue
  }

  const attempts: Array<Record<string, unknown>> = []
  for (let repetition = 1; repetition <= repeat; repetition++) {
    const attempt = attemptTask(task, repetition)
    attempts.push({
      run: repetition,
      status: attempt.status,
      passed: attempt.passed,
      checkOk: attempt.checkOk,
      ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    })
    // A quota stop, a broken fixture copy or an agent that never started: repeating any of them spends
    // the day's allowance to learn the same thing again.
    if (attempt.status === "invalid") break
  }

  const result = tallyTasks(attempts.map((attempt) => attempt.status as Verdict))
  if (repeat > 1) {
    console.log(`  ${result.status === "pass" ? "PASS" : result.status === "invalid" ? "INVALID" : "FAIL"} ${result.label} for ${task.id}`)
    writeFileSync(
      path.join(results, task.id, "report.json"),
      JSON.stringify(
        { task: task.id, status: result.status, passes: result.passes, runs: result.runs, label: result.label, attempts },
        null,
        2,
      ),
    )
  }
  summary.push({
    id: task.id,
    scoring: task.scoring,
    status: result.status,
    passed: result.status === "pass",
    passes: result.passes,
    runs: result.runs,
    checkOk: attempts.every((attempt) => attempt.checkOk === true),
    ...(attempts.length === 0 || attempts[attempts.length - 1]!.reason === undefined
      ? {}
      : { reason: attempts[attempts.length - 1]!.reason as string }),
    ...(repeat === 1 ? {} : { attempts }),
  })
}

if (!dryRun) {
  writeFileSync(
    path.join(results, "summary.json"),
    JSON.stringify(
      {
        commit: commit === "" ? null : commit,
        model: model ?? "default",
        repeat,
        pace: pace?.perMinute ?? null,
        rateLimit: rpm === undefined && budget === undefined ? null : { requestsPerMinute: rpm ?? null, inputTokensPerMinute: budget ?? null },
        summary,
        counts: {
          pass: summary.filter((item) => item.status === "pass").length,
          fail: summary.filter((item) => item.status === "fail").length,
          invalid: summary.filter((item) => item.status === "invalid").length,
        },
      },
      null,
      2,
    ),
  )
  console.log(`\ncommit ${commit === "" ? "unknown" : commit}`)
  console.log(
    scoreLine({
      pass: summary.filter((item) => item.status === "pass").length,
      fail: summary.filter((item) => item.status === "fail").length,
      invalid: summary.filter((item) => item.status === "invalid").length,
      harness: summary.filter((item) => item.reason === "harness").length,
      agent: summary.filter((item) => item.reason === "agent").length,
    }),
  )
}

// A run that wrote outside its fixtures did not measure the agent, whatever the scoreboard says, so it
// fails the caller rather than reporting a number nobody should read.
if (escapedAny) {
  console.error(
    "\nThe checkout was modified while the evals ran; those tasks are INVALID, not failures. " +
      "Every task now works in its own copy, so a clean checkout is part of the contract.",
  )
  process.exit(3)
}
