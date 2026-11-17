# Orbit for Windows, without cloning

Report only. Nothing here is built yet: `build-windows.yml` is proposed, not added to
`.github/workflows/`. Everything below was checked against `arena/11e9240c-orbit` at `b6f32e8`.

## 1. Can GitHub Actions build a standalone Windows `orbit.exe`?

**Yes, and it already does the same thing in production — on a Linux runner.** Three facts, from the
code rather than from hope:

- `packages/cli/script/build.ts` lists `{ os: "win32", arch: "x64" }` among its targets and compiles it
  with `Bun.build({ compile: { target: "bun-windows-x64", windows: {} } })`, writing
  `packages/cli/dist/cli-windows-x64/bin/orbit.exe`. `OPENCODE_TARGET=windows-x64` narrows the build
  to that one target.
- `.github/workflows/release.yml` `build-cli` runs **on `ubuntu`**, with no target filter, and builds
  all twelve targets in one job — the two Windows ones included. The Windows-specific jobs later in
  that file only *sign* and repack what this job produced.
- Both post-build checks are static: `NativeArch.verify` reads PE/ELF/Mach-O headers (it exists because
  2.0.27 shipped an x64 `rust_pty.dll` inside the ARM64 Windows CLI) and `verifyArtifact` scans bytes
  for forbidden simulation payloads. Neither executes the binary, so neither needs Windows.

### What the build needs, and what it does by itself

| Need | Where it comes from |
| --- | --- |
| The Windows Bun runtime that gets embedded | `BUN_COMPILE_RELEASE: bun-v1.4.4`; the script downloads the matching `bun-windows-x64.zip` from the Bun release and checks its SHA-256 |
| `opencode-pty.exe` for persistent terminals | `build.ts` runs `bun install --os="*" --cpu="*" --libc="*" @opencode/pty@…`, which installs the win32 binary packages on Linux. Verified locally: it pulled `@opencode/pty-win32-x64`, `@lydell/node-pty-win32-x64`, `@parcel/watcher-win32-*`, `@ff-labs/fff-bin-win32-x64` |
| `GH_TOKEN` | Raises the GitHub API rate limit while resolving the Bun release; the workflow token is enough |
| Models catalogue | Optional. Without `OPENCODE_MODELS_SNAPSHOT` the build bundles the snapshot committed in the repo |

### What fails — and why it is not a repo problem

I tried the Windows build here and it stopped twice, both times on this sandbox's network and nowhere
else:

1. `bun install` exits 1 because `ghostty-web` is a GitHub tarball and this sandbox intercepts TLS
   (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). Everything else installs.
2. `build.ts` then fails at `compileExecutable` fetching `api.github.com/repos/oven-sh/bun/releases…`
   with the same TLS error, and with verification disabled the asset download is reset — the sandbox
   only allows a short list of hosts. A GitHub runner has plain access to both.

So: the only two unproven steps are ordinary public HTTPS downloads that upstream performs on every
release. Nothing in the build path is Windows-only.

### Size

| Measurement | Value |
| --- | --- |
| `@opencode/cli-windows-x64@2.3.0` unpacked, from the npm registry | **257,553,525 B ≈ 246 MiB** (4 files; the exe is essentially all of it) |
| `@opencode/cli-linux-x64@2.3.0`, for comparison | 250,685,851 B ≈ 239 MiB |
| Zip ratio, measured here on a Bun-compiled binary | 2.08× |
| Expected zip for the Windows exe | **≈ 124 MB (118 MiB)** — estimate |

This tree is `2.2.5` plus local commits, so expect the same order of magnitude, ±10 MB. The workflow
prints the exact byte count.

Build time: the release job allows 30 minutes for all twelve targets on a 4-vCPU runner; a single
Windows target on `ubuntu-latest` should land around 10–20 minutes, dominated by the web-UI build that
gets embedded.

## 2. Proposed workflow: `build-windows`

Not added yet. It lives on `dev` for the same reason `eval.yml` must: a `workflow_dispatch` workflow
only exists once it is on the default branch. The *code* it builds is whatever `branch` says.

```yaml
name: build-windows

# Manual only: an artifact is ~250 MB and nobody needs one by surprise.
on:
  workflow_dispatch:
    inputs:
      branch:
        description: Branch to build
        type: string
        default: arena/11e9240c-orbit
      release:
        description: Also attach the zip to a draft release
        type: boolean
        default: false

permissions:
  contents: write   # only used by the release step; the build itself reads

concurrency:
  group: build-windows
  cancel-in-progress: false

jobs:
  windows:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          ref: ${{ inputs.branch }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version-file: package.json

      - name: Install
        run: bun install --frozen-lockfile

      # One target, cross-compiled: the Windows runtime is downloaded and embedded, so the result
      # needs nothing installed on the machine that runs it.
      - name: Build the Windows CLI
        working-directory: packages/cli
        env:
          OPENCODE_TARGET: windows-x64
          BUN_COMPILE_RELEASE: bun-v1.4.4
          GH_TOKEN: ${{ github.token }}
        run: bun run build

      - name: Check the binary
        working-directory: packages/cli/dist/cli-windows-x64/bin
        run: |
          set -euo pipefail
          test -s orbit.exe
          file orbit.exe
          sha256sum orbit.exe | tee "$GITHUB_WORKSPACE/SHA256SUMS.txt"
          ls -l orbit.exe
          du -h orbit.exe

      - name: Upload the artifact
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: orbit-windows-x64
          path: packages/cli/dist/cli-windows-x64/bin/orbit.exe
          if-no-files-found: error
          retention-days: 14

      # A release asset is a single zip with a stable URL; an artifact is a zip that contains it.
      - name: Draft release
        if: ${{ inputs.release }}
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          cd packages/cli/dist/cli-windows-x64/bin
          zip -9 "$GITHUB_WORKSPACE/orbit-windows-x64.zip" orbit.exe
          cd "$GITHUB_WORKSPACE"
          gh release create "windows-build-${GITHUB_RUN_NUMBER}" orbit-windows-x64.zip \
            --draft \
            --title "Orbit for Windows — build ${GITHUB_RUN_NUMBER}" \
            --notes "Built from ${GITHUB_SHA:0:7} on ${GITHUB_REF_NAME}. Unsigned: Windows will show SmartScreen once."
```

Two packaging choices, deliberately: the **artifact** is the bare `orbit.exe`, so the download is one
zip that unzips to the executable; the **release asset** is `orbit-windows-x64.zip`, so there is a
stable URL to paste anywhere.

### Click by click, from a phone browser

1. `github.com` → your repository → **Actions** (top bar).
2. First time only: a fork shows *"Workflows aren't being run on this forked repository"* → tap
   **I understand my workflows, go ahead and enable them**. If there is no banner, **Settings →
   Actions → General → Allow all actions and reusable workflows → Save**.
3. Left sidebar → **build-windows** → **Run workflow** (right side; on a phone it may sit under the
   list).
4. Leave **branch** as `arena/11e9240c-orbit`; set **release** to `true` only if you want a stable link
   instead of an artifact.
5. Tap the green **Run workflow**, then reload the page; the run appears at the top. ~10–20 minutes.
6. **Download an artifact:** scroll to the bottom of the run summary → **Artifacts** →
   **orbit-windows-x64** → the phone downloads `orbit-windows-x64.zip`.
   **Download a release asset** (when `release` was on): **Releases** → the draft
   `windows-build-<n>` → `orbit-windows-x64.zip`. Drafts are only visible to you until you tap
   **Publish release**.
7. On the Windows machine: right-click the downloaded zip → **Extract All…** → `C:\Users\<you>\orbit`.
   The folder then holds `orbit.exe` (~250 MB).
8. Start it once from PowerShell:

   ```powershell
   cd C:\Users\<you>\orbit
   .\orbit.exe --version      # orbit v…
   .\orbit.exe                # the TUI, in whatever folder you want to work in
   ```

   Optional, to type `orbit` anywhere: `setx PATH "%PATH%;C:\Users\<you>\orbit"`, then open a new
   window.

If Windows says *"Windows protected your PC"*, tap **More info → Run anyway** — the binary is unsigned.
`Unblock-File .\orbit.exe` in PowerShell does the same thing quietly.

## 3. What has to be set up first

**On your machine: nothing.** No Bun, no Node, no WSL, no compilers. The exe is a Bun-compiled binary
with the runtime, the PTY helper and the web UI inside it.

Recommended, not required:

| | Why |
| --- | --- |
| **Git for Windows** | the agent's diffs, snapshots and revert use `git`; without it those features degrade rather than fail |
| **Windows Terminal** (or VS Code's terminal) | 24-bit colour; `conhost.exe` drops the theme to the nearest palette entries |
| Windows 10/11 **x64** | the `windows-x64` target; ARM64 Windows needs the other target adding to the matrix |

Path notes, verified in the code rather than assumed: the CLI uses XDG-style folders on **every**
platform, so on Windows everything lands under your profile —

- data and the database: `%USERPROFILE%\.local\share\orbit\opencode.db`
- config and theme: `%USERPROFILE%\.config\orbit\` (`orbit.json`, `cli.json`)
- cache: `%USERPROFILE%\.cache\orbit\`
- logs: `%USERPROFILE%\.local\share\orbit\log\`

`orbit debug paths` prints all four. (This also settles the open question in `docs/windows-todo.md`,
which asked whether the Windows paths were `%APPDATA%`-style: they are not.)

### Entering the Gemini key on first run

Three ways; the first is the one to use:

```powershell
.\orbit.exe auth login
```

Pick **Google** in the picker (it is listed among the providers), paste the key from Google AI Studio,
done. Non-interactive equivalent, if you ever script it: `.\orbit.exe auth login google --method key
--answer key=…` — the field name has to match the provider's form, so prefer the interactive flow.

Alternatives: inside the TUI, `/connect`; or an environment variable for one session only —
`$env:GOOGLE_GENERATIVE_AI_API_KEY="…"` (the provider layer reads that name; `GEMINI_API_KEY` is the
one voice and the eval harness use).

Where the key ends up: the `credential` table in `opencode.db`, as JSON, unencrypted — same as the
upstream CLI. Treat that file as a secret. `orbit auth list` shows what is stored, `orbit auth logout`
removes one.

### Health check after the first launch

```powershell
.\orbit.exe --version        # orbit v<channel>
.\orbit.exe debug paths      # four folders under your profile
.\orbit.exe auth list        # the Google credential you just added
```

If the TUI cannot start its background server, `.\orbit.exe --standalone` runs a private one instead;
that is the fastest way to tell a server problem from a terminal problem.

## 4. Working screen and colour

Unchanged by this: the working screen stays neutral dark, and `#006400` is only ever the app icon. The
neutral theme (`packages/cli/src/brand/orbit-theme.json`, currently uncommitted, awaiting your review)
carries no cyan and no green — selection is inverse video, diffs differ by lightness, and only errors
and warnings keep a hue.
