import { describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseTask } from "./task"

/**
 * `design-proposal-first` asks for a proposal, so a run that edits the page has not done the task —
 * however good the proposal in its reply. The check is what enforces that, and it has to fail on an
 * edited fixture the way it did on the real run that edited `index.html` and `styles.css`.
 */
const task = parseTask(path.join(import.meta.dir, "tasks", "07-design-proposal-first.md"))

function copy() {
  const workdir = mkdtempSync(path.join(tmpdir(), "orbit-design-"))
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

describe("the proposal task's check", () => {
  test("passes a run that proposed and left the page alone", () => {
    expect(run(copy())).toBe(0)
  })

  test("fails a run that edited index.html", () => {
    const workdir = copy()
    writeFileSync(path.join(workdir, "index.html"), "<!doctype html><title>Northwind Coffee</title><section>pricing</section>\n")
    expect(run(workdir)).not.toBe(0)
  })

  test("fails a run that edited styles.css", () => {
    const workdir = copy()
    writeFileSync(path.join(workdir, "styles.css"), "body { color: black; }\n")
    expect(run(workdir)).not.toBe(0)
  })

  test("fails a run that only added a new file", () => {
    const workdir = copy()
    writeFileSync(path.join(workdir, "notes.md"), "my plan\n")
    expect(run(workdir)).not.toBe(0)
  })

  test("still asks the reply for a proposal", () => {
    expect(task.expect).toBe("spacing|layout|colour|color")
  })
})
