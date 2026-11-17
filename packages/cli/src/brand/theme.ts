import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { name } from "@opencode/util/brand"
import THEME from "./orbit-theme.json" with { type: "json" }

export const THEME_NAME = name
const CLI_CONFIG = "cli.json"
const LEGACY_GLOBAL_CONFIG = ["opencode.json", "opencode.jsonc"]

function configRoot(home: string) {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), name)
}

function writeIfChanged(file: string, content: string) {
  let current: string | undefined
  try {
    current = fs.readFileSync(file, "utf8")
  } catch {
    current = undefined
  }
  if (current === content) return false
  fs.writeFileSync(file, content, { mode: 0o600 })
  return true
}

function exists(file: string) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Installs Orbit's own look without touching the TUI renderer: the theme is an ordinary user theme
 * in `<config>/themes/orbit.json`, selected through the ordinary `cli.json` setting. Both are written
 * once on first run and the theme file is refreshed when it changes, so users get upstream theme fixes.
 *
 * The global config also turns off OpenCode's self-updater: this fork is not published where that
 * updater looks, and an "update" would replace Orbit with a different product.
 */
export function installBrandAssets(options: { home?: string } = {}) {
  if (process.env.OPENCODE_TEST_HOME) return
  try {
    const root = configRoot(options.home ?? os.homedir())
    const themes = path.join(root, "themes")
    fs.mkdirSync(themes, { recursive: true })
    writeIfChanged(path.join(themes, `${THEME_NAME}.json`), JSON.stringify(THEME, null, 2) + "\n")

    const cli = path.join(root, CLI_CONFIG)
    if (!exists(cli)) {
      fs.writeFileSync(
        cli,
        JSON.stringify({ theme: { name: THEME_NAME, mode: "dark" } }, null, 2) + "\n",
        { mode: 0o600 },
      )
    }

    if (!LEGACY_GLOBAL_CONFIG.some((file) => exists(path.join(root, file)))) {
      fs.writeFileSync(path.join(root, "opencode.json"), JSON.stringify({ update: "disable" }, null, 2) + "\n", {
        mode: 0o600,
      })
    }
  } catch (error) {
    // Branding must never prevent the CLI from starting.
    if (process.stderr.isTTY) {
      process.stderr.write(`Could not install the Orbit theme: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}
