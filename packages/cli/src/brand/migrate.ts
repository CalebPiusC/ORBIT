import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { displayName, legacy, name } from "@opencode/util/brand"

const DIRECTORIES = ["config", "data", "state"] as const

type Base = Record<(typeof DIRECTORIES)[number], string>

function bases(home: string): Base {
  return {
    config: process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    data: process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    state: process.env.XDG_STATE_HOME || path.join(home, ".local", "state"),
  }
}

function present(directory: string) {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory()
}

function populated(directory: string) {
  return present(directory) && fs.readdirSync(directory).length > 0
}

function short(directory: string) {
  const home = os.homedir()
  return directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory
}

/**
 * One-way import of the previous name's folders into Orbit's, run once before any command touches
 * global paths. Old data is copied, never moved, so an existing install keeps working; an Orbit
 * folder that already holds data is never overwritten.
 */
export function migrateLegacyData(options: { home?: string } = {}) {
  // Tests point OPENCODE_TEST_HOME at a scratch directory; keep them isolated from real data.
  if (process.env.OPENCODE_TEST_HOME) return []
  const home = options.home ?? os.homedir()
  const roots = bases(home)
  const imported: Array<{ from: string; to: string }> = []
  for (const key of DIRECTORIES) {
    // An explicit config directory overrides Orbit's own; there is nothing to import into it.
    if (key === "config" && process.env.OPENCODE_CONFIG_DIR) continue
    const from = path.join(roots[key], legacy)
    const to = path.join(roots[key], name)
    if (!populated(from) || populated(to)) continue
    try {
      fs.cpSync(from, to, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: false })
      imported.push({ from, to })
    } catch (error) {
      process.stderr.write(
        `Could not import existing ${legacy} data from ${short(from)}: ${error instanceof Error ? error.message : String(error)}\n` +
          `Orbit will start fresh in ${short(to)}.\n`,
      )
    }
  }
  // Informational only, and only when a person can see it: scripts and tests expect quiet stderr.
  if (imported.length && process.stderr.isTTY) {
    process.stderr.write(
      `${displayName} imported your existing ${legacy} data (one-time copy, originals left in place):\n` +
        imported.map((item) => `  ${short(item.from)} → ${short(item.to)}`).join("\n") +
        "\n",
    )
  }
  return imported
}
