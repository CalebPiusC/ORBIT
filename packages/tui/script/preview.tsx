/** @jsxImportSource @opentui/solid */
// Renders Orbit's screens from recorded conversations and paints them to PNG.
//
// No model, no key, no network: `createAppFixture` boots the real TUI against a local fake API whose
// answers are written below, so what lands in the PNG is the product's own components rendering the
// product's own data shapes. Dev tool only; nothing in the product imports it.
//
//   bun run script/preview.tsx [outDir]
//
// Screens that need the CLI before the TUI starts (the first-run key prompt) are captured separately
// by script/preview-pty.py, which boots the real binary in a pseudo-terminal.

import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createAppFixture } from "../test/fixture/app"
import { json } from "../test/fixture/tui-client"
import { paint, type Frame } from "./preview-paint"

const out = path.resolve(process.argv[2] ?? process.env.PREVIEW_OUT ?? "/tmp/orbit-preview")
await mkdir(out, { recursive: true })

// Theme discovery looks in the config directory and in `<ancestor>/.opencode`, resolving against the
// working directory. Running from a scratch directory with the Orbit theme in `.opencode/themes` is
// how the previews get Orbit's own colours without touching the repository.
const scratch = path.join(out, ".run")
await mkdir(path.join(scratch, ".opencode", "themes"), { recursive: true })
const themeFile = new URL("../../cli/src/brand/orbit-theme.json", import.meta.url)
await Bun.write(path.join(scratch, ".opencode", "themes", "orbit.json"), await Bun.file(themeFile).text())
process.chdir(scratch)

const directory = "/home/user/ORBIT"
const location = { directory, project: { id: "project", directory, canonical: directory } }
const sessionID = "ses_preview"

const session = {
  id: sessionID,
  projectID: "project",
  title: "Retry when the provider answers 429",
  agent: "build",
  model: { providerID: "google", id: "gemini-3.5-flash-lite" },
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const PATCH = `@@ -41,4 +41,8 @@ async function call(input: Request) {
   const response = await fetch(input)
-  if (!response.ok) throw new Error("request failed")
+  if (response.status === 429) {
+    await sleep(retryAfter(response))
+    return call(input)
+  }
+  if (!response.ok) throw new Error("request failed")
   return response
 }`

const tools = {
  id: "prt_edit",
  type: "tool" as const,
  name: "edit",
  time: { created: 3000, completed: 4000 },
  state: {
    status: "completed" as const,
    input: { path: "packages/ai/src/route/client.ts", filePath: "packages/ai/src/route/client.ts" },
    content: [{ type: "text" as const, text: "Edited packages/ai/src/route/client.ts" }],
    metadata: { diff: PATCH, filepath: "packages/ai/src/route/client.ts" },
  },
}

const messages = [
  {
    id: "msg_1",
    type: "assistant" as const,
    agent: "build",
    model: session.model,
    time: { created: 2000, streamed: 3000, completed: 5000 },
    finish: "stop" as const,
    cost: 0,
    tokens: { input: 1200, output: 180, reasoning: 0, cache: { read: 0, write: 0 } },
    content: [
      { type: "text" as const, text: "I'll add one retry that waits as long as the provider asks." },
      tools,
    ],
  },
  { id: "msg_0", type: "user" as const, text: "add a retry when the provider answers 429", time: { created: 1000 } },
]

const permission = {
  id: "per_preview",
  sessionID,
  action: "edit",
  resources: ["packages/ai/src/route/client.ts"],
  metadata: { diff: PATCH, filepath: "packages/ai/src/route/client.ts" },
  source: { messageID: "msg_1", id: "prt_edit" },
  message: "Add one retry when the provider answers 429",
}

// The notice model-fallback writes when the primary hits its limit: a system message whose
// description is the sentence the session renders.
const fallbackMessages = [
  ...messages,
  {
    id: "msg_2",
    type: "system" as const,
    text: "google/gemini-3.5-flash-lite is rate limited.",
    description:
      "google/gemini-3.5-flash-lite is rate limited. Switched to google/gemini-3.1-flash-lite and continuing this task.",
    time: { created: 6000 },
  },
]

function handler(input: { messages?: unknown[]; permission?: unknown[] }) {
  return (url: URL) => {
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: [
          { id: "build", name: "Build", mode: "primary", hidden: false, permissions: [], model: session.model },
          { id: "plan", name: "Plan", mode: "primary", hidden: false, permissions: [], model: session.model },
        ],
      })
    if (url.pathname === "/api/provider")
      return json({ location, data: [{ id: "google", name: "Google" }, { id: "openrouter", name: "OpenRouter" }] })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: [
          ["gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", []],
          ["gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", []],
        ].map(([id, name]) => ({
          id,
          providerID: "google",
          name,
          status: "active",
          enabled: true,
          capabilities: { input: ["text"], output: ["text"], tools: true },
          variants: [],
          cost: [],
          limit: { context: 1000000, output: 8192 },
          time: { released: 0 },
        })),
      })
    if (url.pathname === "/api/command") return json({ location, data: [] })
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${sessionID}`) return json({ data: session })
    if (url.pathname === `/api/session/${sessionID}/message`)
      return json({ data: input.messages ?? messages, cursor: {} })
    if (url.pathname === `/api/session/${sessionID}/permission`) return json({ data: input.permission ?? [] })
    if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
    return undefined
  }
}

async function capture(name: string, options: { session?: boolean; messages?: unknown[]; permission?: unknown[]; keys?: string[] }) {
  await using setup = await createAppFixture({
    width: 100,
    height: 40,
    state: path.join(out, ".state", name),
    config: { animations: false, theme: { name: "orbit", mode: "dark" } },
    args: options.session ? { sessionID } : {},
    fetch: handler({ messages: options.messages, permission: options.permission }) as never,
  })
  setup.renderer.start()
  await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 }).catch(() => {})
  await setup.renderOnce()
  await Bun.sleep(600)
  for (const key of options.keys ?? []) {
    const [modifier, letter] = key.includes("+") ? key.split("+") : [undefined, key]
    if (modifier === "ctrl") setup.mockInput.pressKey(letter, { ctrl: true })
    else setup.mockInput.pressKey(letter)
    await Bun.sleep(300)
    await setup.renderOnce()
  }
  await Bun.sleep(400)
  await setup.renderOnce()
  const frame = setup.captureSpans() as unknown as Frame
  await paint(frame, path.join(out, `${name}.png`))
  console.log(`preview: ${name}.png (${frame.cols}x${frame.rows})`)
}

await capture("home", {})
await capture("session", { session: true })
await capture("approve", { session: true, permission: [permission] })
await capture("fallback", { session: true, messages: fallbackMessages })
await capture("models", { keys: ["ctrl+x", "m"] })

console.log(`preview: wrote ${out}`)
process.exit(0)
