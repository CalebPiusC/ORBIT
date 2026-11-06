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
 *   bun evals/run.ts --dry-run             # print what would run, touch nothing
 *
 * Requires a configured provider (see `orbit auth login`). Nothing here runs in CI.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
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
const argv = process.argv.slice(2)
const dryRun = argv.includes("--dry-run")
const modelFlag = argv.indexOf("--model")
const model = modelFlag === -1 ? undefined : argv[modelFlag + 1]
const filters = argv.filter((argument, index) => !argument.startsWith("--") && argv[index - 1] !== "--model")

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
  .filter((task) => filters.length === 0 || filters.some((filter) => task.id.startsWith(filter)))

if (tasks.length === 0) {
  console.error("No matching tasks.")
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

  console.log(`\n▶ ${task.id} — ${task.title}`)
  console.log(`  workdir: ${workdir}`)
  if (dryRun) {
    console.log(`  prompt:  ${task.prompt.split("\n")[0]}`)
    console.log(`  check:   ${task.check}`)
    continue
  }

  const started = Date.now()
  const agent = run(orbit(task.prompt), workdir)
  const transcript = `${agent.stdout}\n${agent.stderr}`
  const check = run(["bash", "-lc", task.check], workdir)
  const expectOk = task.expect === "" ? true : new RegExp(task.expect, "i").test(transcript)
  const forbidOk = task.forbid === "" ? true : !new RegExp(task.forbid, "i").test(transcript)
  const passed = check.code === 0 && expectOk && forbidOk

  const directory = path.join(results, task.id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, "transcript.log"), transcript)
  writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify({ task: task.id, passed, check, expectOk, forbidOk, ms: Date.now() - started }, null, 2),
  )

  console.log(`  ${passed ? "PASS" : "FAIL"}  check=${check.code === 0 ? "ok" : "failed"} expect=${expectOk} forbid=${forbidOk}`)
  if (!passed && task.scoring === "rubric") console.log(`  (rubric task: read ${path.join(directory, "transcript.log")})`)
  summary.push({ id: task.id, scoring: task.scoring, passed, checkOk: check.code === 0 })
}

if (!dryRun) {
  writeFileSync(path.join(results, "summary.json"), JSON.stringify({ model: model ?? "default", summary }, null, 2))
  const passed = summary.filter((item) => item.passed).length
  console.log(`\n${passed}/${summary.length} tasks passed. Results in evals/results/.`)
}
