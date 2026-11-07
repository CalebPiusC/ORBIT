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

/**
 * Models a free key should start on, best guess first.
 *
 * Google meters the free tier per model, not per key: as of 2026-11-07 Flash Lite gets about 15
 * requests a minute and 500 a day, while 3.8 Flash gets 5 a minute and 20 a day — one long agent turn
 * spends that. A Lite model is the honest default for a free key; the stronger Flash is an upgrade a
 * paid key can make deliberately.
 */
export const LITE_MODELS = [
  "google/gemini-3.8-flash-lite",
  "google/gemini-3.5-flash-lite",
  "google/gemini-2.5-flash-lite",
] as const
export const PRIMARY_MODEL = LITE_MODELS[0]
/** The stronger Flash tier, kept in the catalog as the paid-key upgrade. */
export const UPGRADE_MODEL = "google/gemini-3.8-flash"
export const KEY_PAGE = "https://aistudio.google.com/apikey"

/** What Google's free tier allows, in the numbers its rate-limit page showed on 2026-11-07. */
export const FREE_LIMITS = {
  lite: { perMinute: 15, perDay: 500 },
  flash: { perMinute: 5, perDay: 20 },
} as const

/**
 * The Lite model this catalog actually has.
 *
 * A cold start lists models in the background, so the answer can lag the catalog by a moment. Guessing
 * the first Lite id is still better than defaulting to a model with a fifth of the daily budget.
 */
export const primaryModel = (client: OpenCodeClient) =>
  Effect.gen(function* () {
    const listed = yield* Effect.promise(() => client.model.list({ location })).pipe(
      Effect.timeout("5 seconds"),
      // A cold or failing catalog is not a reason to keep the user waiting or to throw.
      Effect.catchCause(() => Effect.succeed(undefined)),
    )
    const enabled = new Set(
      (listed?.data ?? [])
        .filter(
          (model) =>
            model.enabled &&
            model.providerID === "google" &&
            !model.id.includes("-tts") &&
            !model.id.includes("image") &&
            !model.id.includes("embedding"),
        )
        .map((model) => model.id),
    )
    const chosen = LITE_MODELS.map((ref) => ref.slice("google/".length)).find((id) => enabled.has(id))
    if (chosen) return `google/${chosen}`
    // A Lite model released after this list still beats Flash for a free key.
    const anyLite = [...enabled].find((id) => id.includes("flash-lite"))
    return anyLite ? `google/${anyLite}` : PRIMARY_MODEL
  })

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
  log.info(
    `Free keys are metered per model: about ${FREE_LIMITS.lite.perMinute} requests a minute and ${FREE_LIMITS.lite.perDay} a day on Flash Lite, only ${FREE_LIMITS.flash.perMinute} a minute and ${FREE_LIMITS.flash.perDay} a day on 3.8 Flash. A long task can use up a day here.`,
  )
  log.info("So Orbit starts on Flash Lite. Add a second provider as a backup whenever you like: orbit auth login openrouter (also free).")
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
    const model = yield* primaryModel(client)
    yield* setDefaultModel(model)
    return model
  }).pipe(Effect.result)

  if (result._tag === "Failure") {
    log.error(`That key could not be saved: ${errorMessage(result.failure)}`)
    outro("No key added. Orbit still starts, using the free models it ships with.")
    return
  }
  const model = result.success
  outro(
    `Connected. Orbit will start on ${model} — the biggest free allowance. A paid key can move to ${UPGRADE_MODEL} with /model.`,
  )
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
