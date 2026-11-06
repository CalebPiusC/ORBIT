# Unverified on Windows

Everything below was written or verified on Linux only. Each item is something that touches paths,
shell commands, installers or PowerShell, so it needs one pass on Windows before we can call the
step done. Tick items off as you test them.

Commands to run the check yourself (from the repository root):

```powershell
npm i -g bun
bun install
powershell -ExecutionPolicy Bypass -File .\script\boot-check.ps1
powershell -ExecutionPolicy Bypass -File .\script\boot-check.ps1 -Tui
```

## Step 1-2 — names, folders, migration

- [ ] `orbit --version` and `orbit --help` print `orbit` / `Orbit command line interface`.
- [ ] `orbit debug paths` prints Windows folders (`%APPDATA%\orbit`, `%LOCALAPPDATA%\orbit`,
      `%TEMP%\orbit`) rather than POSIX-looking ones.
- [ ] `packages/util/src/global.ts` builds those paths with `path.join`, so the `~/.config` style
      paths documented in the README are wrong for Windows — confirm what the CLI actually uses.
- [ ] The one-way migration (`packages/cli/src/brand/migrate.ts`) finds an existing OpenCode install:
      - `%APPDATA%\opencode`, `%LOCALAPPDATA%\opencode`, `%TEMP%\opencode`
      - reads legacy `opencode.json` / `opencode.jsonc` and `auth.json`
- [ ] The migration notice is readable in Windows Terminal / PowerShell 7 / cmd.exe (ANSI colours and
      box characters).
- [ ] `script/boot-check.ps1` runs on Windows PowerShell 5.1 as well as PowerShell 7.

## Step 3 — theme, logo, TUI branding

- [ ] `orbit` on first run creates `%APPDATA%\orbit\themes\orbit.json`, `%APPDATA%\orbit\cli.json`
      (`{"theme":{"name":"orbit","mode":"dark"}}`) and `%APPDATA%\orbit\opencode.json`
      (`{"update":"disable"}`), and the TUI opens in the Orbit theme.
- [ ] The block logo (`packages/tui/src/logo.ts`) renders correctly in Windows Terminal, cmd.exe,
      PowerShell 7 and ConPTY-hosted shells (what VS Code and Windows Terminal use). Look for:
      - the accent mark beside the wordmark in 24-bit colour,
      - the filled bodies of the letters (`_` cells) without gaps or smearing,
      - `orbit mini` banner and the exit banner.
- [ ] Legacy console host (`conhost.exe`) may not have 24-bit colour; the theme should degrade to the
      nearest palette entries without unreadable text.
- [ ] No leftover `opencode.ai` links or "Upgrade to OpenCode Go" text anywhere in the TUI
      (`/help`, `/models`, `/stats`, the update dialog, the crash screen).
- [ ] The crash screen's "report" link opens `https://github.com/CalebPiusC/ORBIT/issues/new` with the
      pre-filled title and stack.

## Updater and installer detection

- [ ] `orbit upgrade` detects how Orbit was installed on Windows: WinGet
      (`anomaly.opencode_*` package folder), npm/pnpm/bun/yarn global installs, and the curl installer.
      WinGet installs still land in an `anomaly.opencode_*` folder and are matched by that path.
- [ ] A curl install in `%USERPROFILE%\.orbit\bin\orbit.exe` is detected; an older
      `%USERPROFILE%\.opencode\bin\opencode.exe` install is still recognised so it can update itself.
- [ ] `retaining` (the Windows-only image retention before replacing a running `.exe`) still works when
      the cache directory is on another drive or behind a junction.
- [ ] Updates are disabled by default (`<config>/opencode.json` holds `{"update":"disable"}`), so no update
      check should run on any Windows shell. `orbit upgrade` itself still targets upstream OpenCode releases
      until Phase 8 gives Orbit its own channel — do not run it against a real installation yet.

## Still open, tracked elsewhere

- The `orbit` npm package name is not published yet, so `npm i -g orbit` cannot be tested.
- Releases (`bun run pack`) have not been produced for Windows; the unpacked `orbit.exe` path in
  `packages/cli/bin/orbit.cjs` has not been exercised.
