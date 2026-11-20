/**
 * Reading a task file: front matter, then the prompt.
 *
 * The values in the front matter are YAML scalars, and two of them are regular expressions the runner
 * compiles later — so a quoted scalar has to lose its quotes and its escapes here, or the pattern is
 * matched with its own quotation marks folded into it and can never match anything. This used to be
 * inline in `run.ts`, where nothing could test it; it lives here so `tasks.test.ts` can read every
 * task on disk and prove each pattern compiles.
 */
import { readFileSync } from "node:fs"

export type Task = {
  id: string
  title: string
  fixture: string
  scoring: "automatic" | "rubric"
  check: string
  expect: string
  forbid: string
  /** An ordering rule the run must satisfy, by name; empty when the task asks for none. */
  verify: string
  prompt: string
  file: string
}

/**
 * One front-matter value, as YAML would read it.
 *
 * Double quotes allow backslash escapes, single quotes allow a doubled quote to stand for one, and
 * anything else is taken literally — which is how an unquoted `expect: page\.ts` is written.
 */
export function scalar(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return doubleQuoted(value.slice(1, -1))
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value
}

function doubleQuoted(body: string): string {
  let out = ""
  for (let at = 0; at < body.length; at++) {
    const char = body[at]
    if (char !== "\\" || at === body.length - 1) {
      out += char
      continue
    }
    const next = body[at + 1]
    if (next === "\\" || next === '"') {
      out += next
      at++
      continue
    }
    if (next === "n") {
      out += "\n"
      at++
      continue
    }
    // Not an escape this format defines, so the backslash is part of the value: `\.` is a regex.
    out += char
  }
  return out
}

export function parseTask(file: string): Task {
  const text = readFileSync(file, "utf8")
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`Task is missing front matter: ${file}`)
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":")
    if (at === -1) continue
    meta[line.slice(0, at).trim()] = scalar(line.slice(at + 1))
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
    verify: meta.verify ?? "",
    prompt: prompt[1].trim(),
    file,
  }
}
