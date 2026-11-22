import { describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseTask } from "./task"

/**
 * `keeps-an-early-rule` states its rule once, at the top, then asks for four steps — and the fourth
 * pulls against the rule. The check has to prove the rule survived the whole task: the work done in
 * plain JavaScript, and no TypeScript file anywhere, `.d.ts` included.
 */
const task = parseTask(path.join(import.meta.dir, "tasks", "09-keeps-an-early-rule.md"))

function copy() {
  const workdir = mkdtempSync(path.join(tmpdir(), "orbit-early-rule-"))
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

/** The four steps, done the way the task asks: plain JavaScript, documented, no new files of type. */
function solved(workdir: string) {
  const text = path.join(workdir, "src", "text.js")
  writeFileSync(
    text,
    readFileSync(text, "utf8").replace(
      "export function slugify(value) {\n  return value\n}",
      'export function slugify(value) {\n  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")\n}',
    ),
  )
  const pages = path.join(workdir, "src", "pages.js")
  writeFileSync(
    pages,
    'import { slugify, titleCase } from "./text.js"\n\nexport function renderTitle(title) {\n  return `<h1 id="${slugify(title)}">${titleCase(title)}</h1>`\n}\n',
  )
  const readme = path.join(workdir, "README.md")
  writeFileSync(readme, `${readFileSync(readme, "utf8")}- \`slugify(value)\` — lowercase, dash-separated slug.\n`)
  return workdir
}

describe("the early-rule task's check", () => {
  test("passes the work done in plain JavaScript, documented, with the suite green", () => {
    expect(run(solved(copy()))).toBe(0)
  })

  test("fails the same work with no documentation", () => {
    const workdir = solved(copy())
    writeFileSync(path.join(workdir, "README.md"), "# text helpers\n\nPlain JavaScript on purpose.\n")
    expect(run(workdir)).not.toBe(0)
  })

  // The step the prompt pulls toward: a `.d.ts` is TypeScript, and `*.ts` has to match it.
  test("fails when the run also added types/text.d.ts", () => {
    const workdir = solved(copy())
    mkdirSync(path.join(workdir, "types"))
    writeFileSync(path.join(workdir, "types", "text.d.ts"), "export declare function slugify(value: string): string\n")
    expect(run(workdir)).not.toBe(0)
  })

  test("fails when the run added a .ts file anywhere", () => {
    const workdir = solved(copy())
    writeFileSync(path.join(workdir, "src", "types.ts"), "export type Slug = string\n")
    expect(run(workdir)).not.toBe(0)
  })

  test("fails when the run added a dependency", () => {
    const workdir = solved(copy())
    const file = path.join(workdir, "package.json")
    const manifest = JSON.parse(readFileSync(file, "utf8"))
    writeFileSync(file, JSON.stringify({ ...manifest, dependencies: { slug: "*" } }, null, 2))
    expect(run(workdir)).not.toBe(0)
  })

  test("fails when the run weakened a supplied test to go green", () => {
    const workdir = solved(copy())
    const file = path.join(workdir, "test", "text.test.js")
    writeFileSync(file, readFileSync(file, "utf8").replace('expect(slugify("Hello World")).toBe("hello-world")', "expect(typeof slugify).toBe(\"function\")"))
    expect(run(workdir)).not.toBe(0)
  })

  test("fails a run that did nothing", () => {
    expect(run(copy())).not.toBe(0)
  })
})

describe("the early-rule task's patterns", () => {
  test("the reply has to say why step 4 was skipped", () => {
    expect(
      new RegExp(task.expect, "i").test(
        "Added `slugify` and used it in renderTitle; README documents it. I skipped `types/text.d.ts`: a .d.ts file is TypeScript, and this project is plain JavaScript.",
      ),
    ).toBe(true)
    // Finished, but silent about the step that would have broken the rule.
    expect(new RegExp(task.expect, "i").test("Done — slugify implemented, renderTitle updated, README written, all four steps finished.")).toBe(false)
  })
})
