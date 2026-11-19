/**
 * The guard that keeps a task inside its own fixture copy.
 *
 * Each task is scored on a throwaway copy of a fixture, and the check reads that copy. Nothing stops
 * the agent from walking up to the checkout it was launched from, though, and a run where it did
 * scores every task against work it never did — a 1/7 that says nothing about the agent. The only
 * cheap, universal evidence is the checkout's own git status: a task that leaves it clean stayed
 * where it was told to.
 *
 * Both halves are pure so they can be tested without a provider key or a model call.
 */
import { realpathSync } from "node:fs"

/** Paths the runner itself writes, which must not read as an escape. */
export const IGNORED = ["eval.log"]

/**
 * The paths `git status --porcelain --untracked-files=all` reports.
 *
 * Every entry is two status characters, a space, then the path; a rename puts `old -> new` where the
 * path goes, and git quotes any path that needs escaping. Only paths are of interest here.
 */
export function parseStatus(output: string): string[] {
  const paths: string[] = []
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue
    // The status characters occupy the first two columns; three for a rename or copy.
    const rest = line.slice(3)
    if (rest === "") continue
    const arrow = rest.lastIndexOf(" -> ")
    const raw = arrow === -1 ? rest : rest.slice(arrow + 4)
    paths.push(unquote(raw))
  }
  return paths
}

function unquote(path: string) {
  if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path
  return path.slice(1, -1).replace(/\\(["\\])/g, "$1")
}

/**
 * What the checkout gained since the baseline, ignoring the runner's own files.
 *
 * A path present before the run is not evidence against the agent, and one that disappeared is not
 * either: an escape shows up as a new modification, a new file, or a new deletion, and all three
 * arrive here as a path that was not in the baseline.
 */
export function escaped(baseline: readonly string[], current: readonly string[], ignore: readonly string[] = IGNORED): string[] {
  const known = new Set(baseline)
  const ignored = (path: string) => ignore.some((entry) => path === entry || path.startsWith(`${entry}/`))
  return [...new Set(current)].filter((path) => !known.has(path) && !ignored(path)).sort()
}

/**
 * Whether the task's copy is its own repository root.
 *
 * `git rev-parse --show-toplevel` answers the copy's parent when the copy is inside a checkout, and a
 * check that runs there is scoring the wrong tree. Real paths, because a temporary directory is a
 * symlink on macOS and often is not spelled the same way twice.
 */
export function isRepositoryRoot(toplevel: string, workdir: string): boolean {
  if (toplevel === "") return false
  return realpath(toplevel) === realpath(workdir)
}

function realpath(path: string) {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}
