# Orbit on the web — findings and plan

Status: **report only.** Nothing has been built. Head at time of writing: `a4a8f43` on
`arena/11e9240c-orbit`; `.github/workflows/eval.yml` is on the branch (commit `76f7bea`),
`.github/workflows/eval.yml` blob `4e1fa23`.

Costs below were checked on 2026-11-06 and are labelled as estimates; verify at signup.

The short version: **Orbit already has a web version.** `orbit serve` starts the API *and*
serves the real frontend, which is embedded in the binary. What it does not have is a
*product* around it: no accounts, no per-user isolation, no repo import. The work is
therefore mostly identity, isolation and hosting — not UI.

---

## 1. What already exists

| Package | Role | Size |
| --- | --- | --- |
| `packages/app` | The frontend: SolidJS + Vite, PWA (service worker), used by **both** web and desktop | 902 ts/tsx, 16 MB |
| `packages/server` | Effect HTTP API (137 `/api` routes in 28 groups + `/auth`) | 105 files, 764 KB |
| `packages/protocol` | Route/schema definitions, `openapi.json` (codegen source) | 52 files, 1.2 MB |
| `packages/client` | Generated typed SDK: `promise`, `effect`, `solid` entries | 68 files |
| `packages/ui` | Design system, CSS variables, icons, diff/file primitives | 268 files, 13 MB |
| `packages/session-ui` | Session widgets: diff review, line comments, markdown, tool cards | — |
| `packages/cli` | The `orbit` binary; **contains the web server mode** | 211 files |
| `packages/desktop` | Electron shell (not Tauri) hosting `app` + a local server | 182 files, 10 MB |
| `packages/sdk` | Embeds the whole server as a library; also a `workerd` export | 30 files |
| `packages/process-daemon` | Rust PTY daemon, local socket, one owning connection | — |
| `packages/web` | Astro/Starlight **marketing docs site** — not the app | — |
| `packages/console` | SolidStart marketing/billing site (opencode.ai), SST on Cloudflare | — |

Two packages are easy to misread: `web` is the docs site, `console` is the billing site.
Neither is the product frontend. `app` is the product frontend.

### The CLI has a built-in web mode

```
orbit serve [--hostname H] [--port P] [--cors ORIGIN]... [--service] [--stdio]
```
`packages/cli/src/commands/commands.ts:593` — "Start the v2 API and web server".

* Hostname defaults to `127.0.0.1`; port is whatever you pass (the managed service uses
  `0xC0DE` by channel, `packages/cli/src/services/service-config.ts:46`).
* The built `packages/app` is **embedded in the binary** as brotli assets
  (`packages/cli/script/app-assets.ts` runs `bun run build` in `packages/app` with
  `VITE_OPENCODE_SERVER_MODE=origin`). So one binary, one origin, UI + API.
* `packages/cli/src/services/web-ui.ts` serves the shell for every non-`/api`, non-`/auth`,
  non-`/openapi.json` path, with a CSP and immutable asset caching. Index is `no-cache`.
* Split hosting is supported too: `VITE_OPENCODE_SERVER_MODE=none` builds a frontend that
  assumes no server origin and lets the user add servers (`packages/app/src/runtime/platform/web.ts:49`).
  `infra/webapp.ts` already deploys `packages/app` that way to Cloudflare static assets.
* Dev loop: root `dev:web` (app dev server) + `dev:vite`; in DEV the app points at
  `http://<host>:4096` unless `VITE_OPENCODE_SERVER_HOST/PORT` say otherwise.

### How clients talk to the server

* REST under `/api/*`, **SSE** at `/api/event` (`packages/server/src/handlers/event.ts:27`),
  **WebSocket** for PTY/MCP connects authorised by a one-time ticket (browsers cannot set
  headers on upgrades), plus `/openapi.json`.
* Auth is **one shared password per server**, username hard-coded to `"opencode"`
  (`packages/server/src/auth.ts`). In order of use:
  1. HTTP Basic, or `?auth_token=<base64 user:pass>` (browser bootstrap and WS).
  2. Session cookie `opencode_session_<port>`, HMAC-signed with a key derived from the
     password, 30-day TTL, accepted **only for same-origin requests**.
  3. Pairing: `POST /api/pair` issues a 5-minute single-use code → `/auth/connect/:code` link
     → QR. This is how a phone joins.
* Password sources: `OPENCODE_PASSWORD` / `OPENCODE_SERVER_PASSWORD`, else a random 32-byte
  base64url value printed once (`server password …`). The password is stripped from the
  environment handed to tools (`packages/cli/src/env.ts`).
* There are **no user accounts anywhere** in the server, database schema, or API.

### One footgun worth fixing regardless

`ServerAuth.required()` returns false when the password is empty, and the authorization
layer then becomes a no-op (`packages/server/src/middleware/authorization.ts:79`). `serve`
always generates a password, so this only bites when someone sets an empty
`OPENCODE_PASSWORD`. Binding that to `0.0.0.0` would publish an unauthenticated agent with a
shell. The CLI should refuse a non-loopback bind without a password.

---

## 2. Can the existing UI be re-themed as Orbit's web frontend?

Yes — it *is* a web frontend, and theming is CSS variables plus assets, not a rewrite.

* Palette: `packages/ui/src/styles/theme.css` (632 lines) and `colors.css` (772 lines) plus
  `styles/tokens/`. Light and dark blocks already exist as `--background-*` style variables.
* Brand assets: `packages/ui/src/components/{logo,app-icon,provider-icon}.tsx`, icon sets,
  `packages/app/src/providers/opencode-logo`, favicons and the PWA manifest.
* Type: IBM Plex (`@ibm/plex`) — swap only if Orbit's brand differs.
* Strings: **1,597 occurrences of "OpenCode" in `packages/app/src`**, mostly i18n values but
  also inline (`packages/app/src/app.tsx:60` sets the document title to `OpenCode`). This is
  the same rename debt the earlier scope decision parked. If the web frontend is
  Orbit-branded, this is the moment to pay it down; if it stays parked, the web UI ships
  saying OpenCode.

Effort: a few days for colour, logo and strings; the risk is breadth (locales, stories,
snapshot tests), not difficulty.

### Feature gaps, measured against the code

| Need | State today | Gap |
| --- | --- | --- |
| Sign-in | Password → signed cookie, pairing QR, connect dialog with server URL + password | No accounts, no OAuth. Identity must be added *outside* the server (§3). |
| Open a GitHub repo | None. `/api/project` lists; `projects.add(directory)` takes a local path (`packages/app/src/home/projects/add.ts`) | No clone endpoint, no git credential flow, no "new workspace from repo" screen |
| File tree | Exists: `@pierre/trees` FileTree, workspace browser with live watcher (`packages/app/src/workspaces/files/{tree-store,watcher}.ts`), `/api/fs/list` | None for MVP |
| File viewer | Exists: text with highlighting, plus image/audio/video/PDF/office viewers (`workspaces/files/artifact.ts`) | No editor — no CodeMirror/Monaco dependency anywhere. Read-only is fine for MVP. |
| Diff approve/reject | Two real mechanisms: (a) permission dock, allow once / always / deny per tool call (`session/requests/session-permission-dock.tsx`); (b) session revert staged via `POST /revert/stage` → `DELETE /revert` → `POST /revert/commit`, with a review pane showing per-file diffs, split/unified toggle and line comments (`packages/session-ui/src/components/session-review.tsx`) | No per-file "accept this change" like a PR. Approval is at tool-call time; undo is session-level. Fine for W1, worth a per-file surface later. |
| Chat | Complete: timer, streaming SSE, queued prompts, questions, subagents, background shells | None |
| Plan / Build toggle | Both agents exist (`packages/core/src/plugin/plan.ts` defines the read-only `plan` agent; `build` is `Agent.defaultID`). `/api/session/{id}/agent`, `/agent` slash command, `mod+.` cycles (`packages/app/src/composer/commands.tsx:130`) | Not a visible control: agent selection sits behind `settings.visibility.customAgents` (`providers/models/selection.tsx:109`). Needs an always-visible Plan/Build switch. |
| Model + BYO key | Complete: settings → providers/models, `/api/credential`, `/api/integration` OAuth, connect dialog for API key / browser / command sign-in (`providers/connect/*`) | Works; needs product defaults and per-user key storage once hosting is multi-user |

---

## 3. Security plan

**The current server is single-tenant by construction, and there is no sandbox.** One
process owns one SQLite database, one password and one filesystem view. `/api/pty` is a
shell, `/api/fs/*` reads any path the process can, `/api/debug/heap-dump` exists, and
permissions are prompt-level policy only: `Permission.evaluate` defaults to `ask` for
unmatched actions (`packages/core/src/permission.ts:95`) and nothing in the tree uses
seccomp, bubblewrap or landlock.

So the plan is not "harden the server into a multi-tenant server". It is "one server per
tenant, gate the door in front".

1. **Login required, at the gateway.** GitHub OAuth (or email magic link) in a small service
   in front of everything. No cookie, no access. The gateway owns the user table and the
   user→workspace mapping.
2. **One container per user workspace.** Each holds its own `HOME`, `OPENCODE_DB`, config
   dir, and a random per-boot `OPENCODE_PASSWORD` injected by the gateway and never shown to
   the browser. The container runs `orbit serve --hostname 127.0.0.1 --port 4096` and only
   the gateway's proxy can reach it.
3. **Same-origin proxying, because the session cookie is deliberately same-origin.** Serve
   the frontend and the API under one hostname per workspace (or one hostname with a path
   prefix) and let the proxy add the Basic credentials. Never put `auth_token` in a URL that
   a proxy logs; the app strips it from the address bar at startup, but access logs still
   see the first request.
4. **Isolation inside the container:** unprivileged user, read-only root filesystem, a single
   writable volume for the workspace, no docker socket, CPU/memory/PID caps, and an egress
   allowlist (model provider, GitHub, package registries). Per-user provider keys, or a
   gateway-scoped proxy key, so one user cannot spend or read another's.
5. **Fail closed at the edges:** refuse non-loopback binds without a password (see §1);
   rate-limit `/api/pair` and login; disable `/api/debug/*`; keep `--stdio` lease
   credentials out of tool env (already true).
6. **Data:** the per-user volume is the unit of deletion. Encrypt at rest; keep a session log
   per user for support and abuse.
7. **Turn things off that a hosted product does not need:** `/api/plugin` install, `/api/rpc`,
   `/api/shell`, `/api/pty` unless the product actually offers terminals.

---

## 4. Hosting options

Effort assumes the work in §5 and a single region.

| Option | Shape | Effort | Est. cost/month | Notes |
| --- | --- | --- | --- | --- |
| **Your own machine + tunnel** | `orbit serve` + `orbit pair --remote` (OpenTunnel) or `cloudflared` | Hours — **works today** | $0 | Machine must stay awake. Perfect for evaluating the UI from a phone. |
| **Hetzner CX23** | 2 vCPU / 4 GB / 40 GB, 20 TB traffic; Docker + Caddy, N users per box | Medium (own the box) | ≈ €4.29–5.49 + €0.50 IPv4 ≈ **$6 total** | Cheapest per user. You run updates, backups, TLS. EU latency to Lagos ≈ 90–120 ms. |
| **Fly.io** | 1 Machine + volume per user | Medium | 256 MB $2.19, 512 MB $4.39, volume $0.15/GB, egress $0.02/GB (NA/EU) — **$0.12/GB Africa/India** | Per-user isolation without ops. No free tier for new orgs. Egress pricing matters for a Lagos audience. |
| **Railway** | Service per workspace | Low | Hobby $5 incl. $5 usage; ~$20/vCPU-month + $10/GB-RAM-month, so a 0.5 vCPU / 1 GB always-on service ≈ **$20–22** | Best DX, worst unit economics. $1 free credit is not enough for always-on. |
| **Render** | Web service | Low | $7 per 512 MB always-on | Free tier sleeps after 15 min — kills long turns and SSE. |
| **Cloud Run / Cloudflare Containers** | Scale-to-zero containers | High | Variable, needs min-instances | Scale-to-zero breaks SSE/PTY. But note `packages/server/src/workerd.ts`: the control plane already boots inside a Durable Object with the execution plane stubbed pending "a remote sandbox". Control plane on Workers + execution in Containers is where upstream is heading. |
| **Codespaces / Actions** | Dev environments / CI | — | Free quotas | Actions cannot host a server. You already found Codespaces unusable for provider traffic. |

Recommendation for the first paid step: **one Hetzner box** (cheapest, full control, easy to
add per-user containers later), or **Fly Machines** if per-user isolation without ops is worth
~$5/user.

### What you can test free, from a phone browser, today

```bash
OPENCODE_PASSWORD='something-long' orbit serve --hostname 0.0.0.0 --port 4096
orbit pair --remote          # prints a pairing URL + QR, enables the tunnel on first use
```

Open the QR on the phone: that is the real web UI — chat, diffs, terminal, file browser — in
a mobile browser, installable as a PWA. No hosting, no account, no cost. On the same LAN drop
`--remote` and use `http://<laptop-ip>:4096`. `orbit pair --url https://…` works too if you
prefer to front it with your own tunnel.

Buy hosting only after the UI passes that test, because it (not the infrastructure) is the
part with unknowns.

---

## 5. MVP, phases, and how it fits the CLI work

**MVP definition (end of W2):** a stranger opens a URL, signs in, clones a public GitHub
repo, chats with the agent, watches files change in the tree, opens them, and approves or
denies edits — inside their own container, with nothing shared. Explicitly out: teams,
billing, code editing, cloud-scale orchestration, a mobile-specific layout.

| Phase | Work | Est. | Done when |
| --- | --- | --- | --- |
| **W0 — Branded shell** | Tokens/colours/logo/strings to Orbit, rebuild `packages/app`, verify `orbit serve` | 0.5–1 day | `orbit serve` shows an Orbit-branded UI |
| **W1 — Single-user hosted box** | Dockerfile that *builds* Orbit (today's image only copies a prebuilt dist binary), base image with git + ripgrep + node/bun, compose with TLS proxy, password from env, fail-closed guard, volume for state | 3–5 days | Reachable over HTTPS from a phone, survives restart |
| **W2 — Accounts + isolation** | Gateway with GitHub OAuth, user→workspace mapping, one container per user with its own volume/password, same-origin proxy, pairing and debug endpoints disabled, egress allowlist | 1–2 weeks | Two users cannot see each other's files, processes or keys |
| **W3 — Open from GitHub** | `POST /api/workspace/clone` (server-side clone with a per-user GitHub App or device-flow token), progress over SSE, then `projects.add(path)`; a "new workspace from repo" screen | 1 week | Paste a repo URL → session starts in it |
| **W4 — Product polish** | Visible Plan/Build switch, always-on workspace explorer, per-file accept/reject on top of revert + permissions, BYO-key flow with validation, usage page | 3–5 days | Matches the CLI feature list a user would expect |
| Later | Code editor (CodeMirror 6), team seats per workspace, pre-warmed sandboxes, Cloudflare control plane + container execution | — | — |

**Fit with the remaining CLI phases (a), (b), (d):** no conflict, and W2 makes them more
valuable. A hosted product pays for tokens per user, so the free-key lean profile (a) and the
compaction/output caps (b) turn directly into host cost and latency; (d) is independent.
Suggested order stays: baseline → (a) → (b) → (d) interleaved with W0/W1, since W0/W1 touch
only the frontend and packaging.

**One decision to take before W0:** whether the web frontend is Orbit-branded. If yes, the
1,597-string rename lands here and the CLI/desktop inherit it. If no, the web product ships
with someone else's brand on the login page.
