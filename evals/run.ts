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
 *   bun evals/run.ts --task 03             # one task only
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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { USAGE, parseArgs } from "./args"
import { quotaStop, retryDelayMs, scoreLine, verdict, type Verdict } from "./pace"
import { tmpdir } from "node:os"
import path from "node:path"

type Task = {
  id: string
  title: string
  fixture: string
  scoring: "automatic" | "rubric"
  check: string
  expect: string
  forbid: string
  prompt: string
  file: string
}

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
const { dryRun, model, pace, tasks: filters } = args

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

function parse(file: string): Task {
  const text = readFileSync(file, "utf8")
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`Task is missing front matter: ${file}`)
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":")
    if (at === -1) continue
    const value = line.slice(at + 1).trim()
    meta[line.slice(0, at).trim()] = value === '""' ? "" : value
  }
  const prompt = /##\s*Prompt\n+([\s\S]*?)(?=\n##\s|$)/.exec(match[2])
  if (!meta.id || !prompt) throw new Error(`Task is missing an id or a Prompt section: ${file}`)
  return {
    id: meta.id,
    title: meta.title ?? meta.id,
    fixture: meta.fixture,
    scoring: (meta.scoring as Task["scoring"]) ?? "automatic",
    check: meta.check ?? "true",
    expect: meta.expect ?? "",
    forbid: meta.forbid ?? "",
    prompt: prompt[1].trim(),
    file,
  }
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

function run(command: string[], cwd: string) {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env: process.env })
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

const tasks = readdirSync(path.join(root, "tasks"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => parse(path.join(root, "tasks", name)))
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

const orbit = (message: string) => [
  process.execPath,
  "run",
  "--cwd",
  path.join(repo, "packages/cli"),
  "src/index.ts",
  "run",
  message,
  "--agent",
  "build",
  "--format",
  "json",
  "--auto",
  ...(model ? ["--model", model] : []),
]

mkdirSync(results, { recursive: true })
const summary: Array<Record<string, unknown>> = []

for (const task of tasks) {
  const workdir = path.join(mkdtempSync(path.join(tmpdir(), `orbit-eval-${task.id}-`)))
  cpSync(path.join(root, "fixtures", task.fixture), workdir, { recursive: true })
  run(["git", "init", "-q"], workdir)
  run(["git", "add", "-A"], workdir)
  run(["git", "-c", "user.email=eval@orbit.local", "-c", "user.name=orbit-eval", "commit", "-qm", "fixture"], workdir)

  paceNow()
  console.log(`\n▶ ${task.id} — ${task.title}`)
  console.log(`  workdir: ${workdir}`)
  if (dryRun) {
    console.log(`  prompt:  ${task.prompt.split("\n")[0]}`)
    console.log(`  check:   ${task.check}`)
    continue
  }

  const started = Date.now()
  let agent = run(orbit(task.prompt), workdir)
  let transcript = `${agent.stdout}\n${agent.stderr}`
  for (let attempt = 1; attempt < ATTEMPTS; attempt++) {
    if (!quotaStop({ exitCode: agent.code, transcript })) break
    const delay = retryDelayMs(transcript) ?? pace?.intervalMs ?? 5000
    console.log(`  the provider asked for ${(delay / 1000).toFixed(1)}s; waiting and trying again (attempt ${attempt + 1} of ${ATTEMPTS})`)
    paceNow()
    wait(Math.max(delay, 1000))
    agent = run(orbit(task.prompt), workdir)
    transcript = `${agent.stdout}\n${agent.stderr}`
  }
  const throttled = quotaStop({ exitCode: agent.code, transcript })

  const check = throttled ? { code: 1, stdout: "", stderr: "" } : run([...(shell ?? ["bash", "-lc"]), task.check], workdir)
  const expectOk = task.expect === "" ? true : new RegExp(task.expect, "i").test(transcript)
  const forbidOk = task.forbid === "" ? true : !new RegExp(task.forbid, "i").test(transcript)
  const passed = !throttled && check.code === 0 && expectOk && forbidOk
  const status: Verdict = verdict({ passed, quotaStopped: throttled })

  const directory = path.join(results, task.id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, "transcript.log"), transcript)
  writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify({ task: task.id, status, passed, quotaStopped: throttled, check, expectOk, forbidOk, ms: Date.now() - started }, null, 2),
  )

  if (status === "invalid") {
    console.log(`  INVALID (quota)  the run was stopped by rate limiting, not by the task; not scored`)
    console.log(`  transcript: ${path.join(directory, "transcript.log")}`)
  } else {
    console.log(`  ${passed ? "PASS" : "FAIL"}  check=${check.code === 0 ? "ok" : "failed"} expect=${expectOk} forbid=${forbidOk}`)
    if (!passed && task.scoring === "rubric") console.log(`  (rubric task: read ${path.join(directory, "transcript.log")})`)
  }
  summary.push({ id: task.id, scoring: task.scoring, status, passed: status === "pass", checkOk: check.code === 0 })
}

if (!dryRun) {
  writeFileSync(
    path.join(results, "summary.json"),
    JSON.stringify(
      {
        model: model ?? "default",
        pace: pace?.perMinute ?? null,
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
  console.log(
    `\n${scoreLine({
      pass: summary.filter((item) => item.status === "pass").length,
      fail: summary.filter((item) => item.status === "fail").length,
      invalid: summary.filter((item) => item.status === "invalid").length,
    })}`,
  )
}
