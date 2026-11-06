import { confirm, intro, log, outro } from "@clack/prompts"
import type { OpenCodeClient } from "@opencode/client"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { applyEdits, modify, parse } from "jsonc-parser"
import path from "node:path"
import { secret } from "./commands/handlers/auth/form"
import { location, loadIntegrations, request } from "./commands/handlers/auth/shared"
import { openUrl, prompt } from "./ui/prompt"
import { errorMessage } from "./util/error"

/** The model a first run starts on: Gemini's current Flash tier, cheap and strong enough for coding. */
export const PRIMARY_MODEL = "google/gemini-3.8-flash"
export const KEY_PAGE = "https://aistudio.google.com/apikey"

/** The config file names the engine reads, in the order a new file should prefer. */
const CONFIG_NAMES = ["opencode.json", "opencode.jsonc"] as const

/** Keys are read from the environment by the provider itself, so they skip onboarding entirely. */
const ENV_KEYS = ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"] as const

/**
 * Plain-English first run: one key, one link, no account and no card.
 *
 * Runs only when nothing is connected anywhere and no provider key is in the environment, so anyone
 * already set up never sees it. A key goes through the existing integration API and the existing
 * credential storage; the only file this writes is the default model in the global config.
 */
export const firstRun = Effect.fn("cli.onboarding")(function* (client: OpenCodeClient) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return
  if (ENV_KEYS.some((key) => process.env[key])) return

  const integrations = yield* loadIntegrations(client)
  if (integrations.some((integration) => integration.connections.length > 0)) return
  const google = integrations.find((integration) => integration.id === "google")
  if (!google) return

  intro("Welcome to Orbit")
  log.info("Orbit needs a model to think with. Google's Gemini has a free tier: a key, not a card.")
  log.info(`Get one at ${KEY_PAGE} — open Google AI Studio, then "Get API key".`)
  const wants = yield* prompt<boolean>(() =>
    confirm({ message: "Paste a Gemini API key now?", initialValue: true }),
  ).pipe(Effect.catchCause(() => Effect.succeed(false)))
  if (!wants) {
    outro("Skipped. Add a key any time with: orbit auth login google")
    return
  }

  yield* prompt<boolean>(() => confirm({ message: "Open the key page in your browser?", initialValue: true })).pipe(
    Effect.tap((open) => (open ? openUrl(KEY_PAGE) : Effect.void)),
    Effect.catchCause(() => Effect.void),
  )

  const result = yield* Effect.gen(function* () {
    const key = yield* secret("Paste your Gemini API key")
    yield* request((signal) => client.integration.connect.key({ integrationID: google.id, key, location }, { signal }))
    yield* setDefaultModel(PRIMARY_MODEL)
  }).pipe(Effect.result)

  if (result._tag === "Failure") {
    log.error(`That key could not be saved: ${errorMessage(result.failure)}`)
    outro("No key added. Orbit still starts, using the free models it ships with.")
    return
  }
  outro(`Connected. Orbit will start on ${PRIMARY_MODEL}.`)
})

/**
 * Writes the default model without touching anything else in the file. An existing `model` is a
 * deliberate choice and is left alone.
 */
export const setDefaultModel = (model: string) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const directory = global.config
    const candidates = CONFIG_NAMES.map((name) => path.join(directory, name))
    const existing = yield* Effect.promise(async () => {
      for (const candidate of candidates.toReversed()) {
        try {
          return { path: candidate, text: await readFile(candidate, "utf8") }
        } catch {}
      }
      return { path: candidates[0]!, text: "{}\n" }
    })
    const parsed = parse(existing.text) as { model?: unknown } | undefined
    if (parsed?.model !== undefined) return
    const updated = applyEdits(
      existing.text,
      modify(existing.text, ["model"], model, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
    )
    yield* Effect.promise(() => mkdir(directory, { recursive: true }))
    yield* Effect.promise(() => writeFile(existing.path, updated.endsWith("\n") ? updated : `${updated}\n`))
  })
