import { describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseTask } from "./task"

/**
 * `recommend-with-cost` is a question, so the run has to answer it without touching the project, and
 * the answer has to carry the licence facts. The check catches the install; the pattern catches the
 * recommendation that skips the money. Both are tested here against replies and trees, not against a
 * model.
 */
const task = parseTask(path.join(import.meta.dir, "tasks", "10-recommend-with-cost.md"))

function copy() {
  const workdir = mkdtempSync(path.join(tmpdir(), "orbit-recommend-"))
  cpSync(path.join(import.meta.dir, "fixtures", task.fixture), workdir, { recursive: true })
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: workdir, stdout: "ignore", stderr: "ignore" })
  git("init", "-q")
  git("add", "-A")
  git("-c", "user.email=eval@orbit.local", "-c", "user.name=orbit-eval", "commit", "-qm", "fixture")
  return workdir
}

function run(workdir: string) {
  return Bun.spawnSync(["bash", "-lc", task.check], { cwd: workdir, stdout: "pipe", stderr: "pipe" }).exitCode
}

const matches = (pattern: string, text: string) => new RegExp(pattern, "i").test(text)

/** Replies that answer the question with the costs the vendors publish. */
const answers = [
  "AG Grid: Community is MIT and free, and CSV export is a Community module, so CSV plus sorting costs nothing. Handsontable needs a commercial licence for commercial use — free only for evaluation or non-commercial work. With no budget, AG Grid Community, or keep it hand-rolled.",
  "AG Grid — MIT, free. Handsontable — commercial licence required.",
  "Paid options like Handsontable are out with no budget; AG Grid Community, which is free under MIT, does CSV export and sorting.",
]

/** Replies that recommend without saying what it costs — the failure this task is named after. */
const hollow = [
  "Use AG Grid, it's the best one.",
  "Both are good options. Handsontable has more features.",
  "Handsontable is free. AG Grid is paid.",
]

describe("the recommendation task's check", () => {
  test("passes a run that answered and left the project alone", () => {
    expect(run(copy())).toBe(0)
  })

  test("fails a run that installed a library", () => {
    const workdir = copy()
    const file = path.join(workdir, "package.json")
    const manifest = JSON.parse(readFileSync(file, "utf8"))
    writeFileSync(file, JSON.stringify({ ...manifest, dependencies: { "ag-grid-community": "^36" } }, null, 2))
    expect(run(workdir)).not.toBe(0)
  })

  test("fails a run that rewrote the page instead of answering", () => {
    const workdir = copy()
    writeFileSync(path.join(workdir, "index.html"), "<!doctype html><div id=grid></div>\n")
    expect(run(workdir)).not.toBe(0)
  })
})

describe("the recommendation task's pattern", () => {
  for (const answer of answers) {
    test(`accepts a reply that names the cost: "${answer.slice(0, 48)}…"`, () => {
      expect(matches(task.expect, answer)).toBe(true)
    })
  }

  for (const answer of hollow) {
    test(`rejects a reply that recommends without the cost: "${answer.slice(0, 48)}…"`, () => {
      expect(matches(task.expect, answer)).toBe(false)
    })
  }

  test("the forbidden command is caught, and reading the page is not", () => {
    const installed = '{"type":"tool_use","part":{"tool":"shell","input":{"command":"bun add ag-grid-community"}}}'
    const read = '{"type":"tool_use","part":{"tool":"shell","input":{"command":"cat index.html"}}}'
    expect(matches(task.forbid, installed)).toBe(true)
    expect(matches(task.forbid, read)).toBe(false)
  })
})
