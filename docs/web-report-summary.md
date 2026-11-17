# The web version in one page

A plain-English summary of [`web-report.md`](./web-report.md), which is the full study (packages, API,
security, hosting costs, phases). Nothing here has been built. Figures and prices are the report's, as
checked on 2026-11-06.

## What already exists

Orbit ships a web version today. `orbit serve` starts the API **and** serves the real frontend, which is
built into the same binary — one process, one origin, no separate deploy. The frontend is the same SolidJS
app the desktop version uses, installable as a phone app (PWA).

Underneath it is a full client/server product, not a mock:

- a typed HTTP API with SSE streaming and WebSocket shell access;
- a real chat UI with streaming, queued prompts, subagents and background shells;
- a file tree with a live watcher, and viewers for text, images, audio, video, PDF and office files;
- two working change-review mechanisms: an approve/deny prompt per tool call, and a session-level review
  pane with per-file diffs, split/unified and line comments, plus staged revert;
- build and plan agents, model selection, and bring-your-own-key sign-in flows for providers.

Two package names mislead: `packages/web` is the marketing **docs site**, `packages/console` is the
**billing site**. The product frontend is `packages/app`.

## What can be reused as-is

Almost all of it. The gaps are in packaging and identity, not in features. Reusable without changes:
chat, the file tree and viewers, the diff and permission UI, model/provider connect flows, the PWA shell,
and the theme layer — colours and logos are CSS variables and components, so rebranding is a styling job,
not a rewrite.

## What is missing

- **Accounts.** Auth is one shared password per server, signed into a same-origin cookie. There is no user
  table, anywhere. Pairing (a QR code) is how a phone joins.
- **Isolation.** The server is single-tenant by construction, and there is no sandbox: the shell endpoint,
  the filesystem endpoints and a debug heap-dump endpoint are all reachable by the holder of that password.
  Nothing in the tree uses seccomp, bubblewrap or landlock.
- **Opening a repo.** Projects are added by local path. There is no clone endpoint, no git credential flow
  and no "new workspace from a repo" screen.
- **Small product gaps.** No code editor (read-only viewing only), no per-file accept/reject, and the
  Plan/Build switch is buried in settings rather than visible.
- **Branding.** 1,597 occurrences of "OpenCode" live in the frontend, mostly translation strings. Left
  alone, the login page says OpenCode.

## The recommended first version

**One server per user, with a login gate in front.** Do not try to make today's single-tenant server
multi-tenant; run one container per workspace, each with its own home folder, database and random
password, and let a small gateway own the login and the user → workspace mapping. Same-origin proxying
keeps the existing cookie model working untouched. Inside each container: unprivileged user, read-only
root, one writable volume, resource caps, and an egress allowlist.

The MVP is deliberately narrow: a stranger opens a URL, signs in, clones a public GitHub repo, chats with
the agent, watches files change, opens them, and approves or denies edits — inside their own container,
with nothing shared. Out of scope for it: teams, billing, code editing, and seat management.

Suggested order, smallest first: brand the shell → get one hosted box reachable over HTTPS → add login
and one container per user → add "open from a GitHub repo" → polish (visible Plan/Build switch, per-file
accept/reject, BYO-key validation).

## What it costs, and what to do before spending

Before paying for anything, test the real UI for free: run `orbit serve` on your own machine and pair a
phone to it over a tunnel. That exercises chat, diffs, files and terminal on the actual frontend. If that
feels right, the cheapest first step is one small Hetzner box (about $6/month), with Fly.io machines
(about $5 per user) if per-user isolation without ops is worth more than the money.

## The one decision this needs first

**Is the web frontend Orbit-branded?** If yes, the 1,597-string rename happens here and the desktop and
web both inherit it; the icon, the neutral dark theme and the dark green brand moments apply to it. If no,
the hosted product ships with someone else's name on its login page.
