import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { escaped, IGNORED, isRepositoryRoot, parseStatus } from "./guard"

/** The status a checkout reports after someone wrote into it. */
function statusOf(repo: string) {
  const result = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  })
  return parseStatus(result.stdout.toString())
}

function repository() {
  const repo = mkdtempSync(path.join(tmpdir(), "orbit-guard-"))
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "ignore", stderr: "ignore" })
  git("init", "-q")
  writeFileSync(path.join(repo, "keep.txt"), "committed\n")
  git("add", "-A")
  git("-c", "user.email=guard@orbit.local", "-c", "user.name=guard", "commit", "-qm", "fixture")
  return repo
}

describe("reading git status", () => {
  test("takes the path from a modification and an untracked file", () => {
    expect(parseStatus(" M packages/core/thing.ts\n?? notes.txt\n")).toEqual(["packages/core/thing.ts", "notes.txt"])
  })

  test("takes the new name of a rename, not the oldest", () => {
    expect(parseStatus("R  evals/fixtures/small-app/index.html -> evals/fixtures/small-app/page.html\n")).toEqual([
      "evals/fixtures/small-app/page.html",
    ])
  })

  test("unquotes a path git had to escape", () => {
    expect(parseStatus('?? "a file with spaces.ts"\n')).toEqual(["a file with spaces.ts"])
  })

  test("ignores an empty status", () => {
    expect(parseStatus("")).toEqual([])
    expect(parseStatus("\n")).toEqual([])
  })
})

describe("an escape from the fixture", () => {
  test("is a path the checkout did not have before the run", () => {
    expect(escaped(["README.md"], ["README.md", "packages/core/src/agent.ts"])).toEqual(["packages/core/src/agent.ts"])
  })

  test("is not a path that was already changed before the run", () => {
    expect(escaped(["README.md"], ["README.md"])).toEqual([])
  })

  test("is not a path the runner wrote itself", () => {
    expect(escaped([], ["eval.log"])).toEqual([])
    expect(IGNORED).toContain("eval.log")
  })

  test("is reported once however many status lines mention it", () => {
    expect(escaped([], ["src/a.ts", "src/a.ts"])).toEqual(["src/a.ts"])
  })

  test("is reported sorted, so a failing run reads the same way twice", () => {
    expect(escaped([], ["z.ts", "a.ts", "m/x.ts"])).toEqual(["a.ts", "m/x.ts", "z.ts"])
  })
})

describe("the checkout itself", () => {
  test("stays clean when nothing writes to it", () => {
    const repo = repository()
    expect(escaped([], statusOf(repo))).toEqual([])
  })

  test("reports a file the agent created beside the fixture", () => {
    const repo = repository()
    const baseline = statusOf(repo)
    writeFileSync(path.join(repo, "sneaked.ts"), "export {}\n")
    expect(escaped(baseline, statusOf(repo))).toEqual(["sneaked.ts"])
  })

  test("reports a committed file the agent edited", () => {
    const repo = repository()
    const baseline = statusOf(repo)
    writeFileSync(path.join(repo, "keep.txt"), "edited\n")
    expect(escaped(baseline, statusOf(repo))).toEqual(["keep.txt"])
  })
})

describe("the fixture copy as a repository", () => {
  test("is a root when git says so", () => {
    const repo = repository()
    const root = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: repo, stdout: "pipe" }).stdout
    expect(isRepositoryRoot(root.toString().trim(), repo)).toBe(true)
  })

  // The failure that produced a phantom 1/7: the copy sits inside the checkout, so its root is the checkout.
  test("is not a root when it sits inside another repository", () => {
    const repo = repository()
    const nested = mkdtempSync(path.join(repo, "copy-"))
    expect(isRepositoryRoot(repo, nested)).toBe(false)
  })

  test("is not a root when git answered nothing", () => {
    expect(isRepositoryRoot("", "/tmp/whatever")).toBe(false)
  })
})
