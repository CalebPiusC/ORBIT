import { describe, expect, it } from "bun:test"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { FREE_LIMITS, LITE_MODELS, PRIMARY_MODEL, UPGRADE_MODEL, primaryModel, setDefaultModel } from "../src/onboarding"

type Listed = { providerID: string; id: string; enabled: boolean; status?: string }

const model = (id: string, providerID = "google", enabled = true, status?: string): Listed => ({
  providerID,
  id,
  enabled,
  ...(status === undefined ? {} : { status }),
})

/** The catalog this repo ships, so a hardcoded model id can be checked against reality. */
const snapshot = JSON.parse(
  readFileSync(path.resolve(import.meta.dir, "../../core/src/models-dev/snapshot.txt"), "utf8"),
) as { google: { models: Record<string, { status?: string }> } }
const catalogued = snapshot.google.models

/** A client stub: onboarding only ever asks for the model list here. */
const client = (models: Listed[] | Error) =>
  ({
    model: {
      list: async () => {
        if (models instanceof Error) throw models
        return { data: models }
      },
    },
  }) as never

const choose = (models: Listed[] | Error) =>
  Effect.runPromise(primaryModel(client(models)).pipe(Effect.provideService(Global.Service, roots())))

const roots = (config = mkdtempSync(path.join(tmpdir(), "orbit-onboarding-"))): Global.Interface => ({
  home: path.dirname(config),
  data: path.join(config, "data"),
  cache: path.join(config, "cache"),
  config,
  state: path.join(config, "state"),
  tmp: path.join(config, "tmp"),
  bin: path.join(config, "bin"),
  log: path.join(config, "log"),
  repos: path.join(config, "repos"),
})

describe("first-run model choice", () => {
  it("starts a free key on a Lite model, not the Flash tier", async () => {
    const chosen = await choose([model("gemini-3.8-flash"), model("gemini-3.5-flash-lite")])
    expect(chosen).toBe("google/gemini-3.5-flash-lite")
    expect(chosen).not.toBe(UPGRADE_MODEL)
  })

  it("prefers the newest Lite model it knows before older ones", async () => {
    const chosen = await choose([
      model("gemini-2.5-flash-lite"),
      model("gemini-3.1-flash-lite"),
      model("gemini-3.5-flash-lite"),
    ])
    expect(chosen).toBe(LITE_MODELS[0])
  })

  it("skips a Lite model the catalog marks deprecated", async () => {
    const chosen = await choose([
      model("gemini-3.5-flash-lite", "google", true, "deprecated"),
      model("gemini-3.1-flash-lite", "google", true, "active"),
    ])
    expect(chosen).toBe("google/gemini-3.1-flash-lite")
  })

  it("takes a Lite model that appeared after this release", async () => {
    expect(await choose([model("gemini-3.8-flash"), model("gemini-4.0-flash-lite")])).toBe(
      "google/gemini-4.0-flash-lite",
    )
  })

  it("ignores speech, image and disabled models", async () => {
    const chosen = await choose([
      model("gemini-3.5-flash-lite-tts"),
      model("gemini-3.1-flash-lite-image"),
      model("gemini-3.5-flash-lite", "google", false),
      model("gemini-3.8-flash"),
    ])
    // Nothing usable was listed, so the guess stands rather than falling back to Flash.
    expect(chosen).toBe(PRIMARY_MODEL)
  })

  it("falls back to the Lite default on a cold catalog or an error", async () => {
    expect(await choose([model("gemini-3.8-flash")])).toBe(PRIMARY_MODEL)
    expect(await choose([])).toBe(PRIMARY_MODEL)
    expect(await choose(new Error("catalog not ready"))).toBe(PRIMARY_MODEL)
  })

  it("names only models the shipped catalog actually has", () => {
    // A default the catalog does not know fails the first run, so the list is checked against the
    // snapshot rather than a memory of what Google released.
    for (const ref of LITE_MODELS) {
      const id = ref.slice("google/".length)
      expect(catalogued[id], `${ref} is not in packages/core/src/models-dev/snapshot.txt`).toBeDefined()
      expect(catalogued[id]?.status).not.toBe("deprecated")
    }
    expect(catalogued[PRIMARY_MODEL.slice("google/".length)]).toBeDefined()
    expect(catalogued[UPGRADE_MODEL.slice("google/".length)], `${UPGRADE_MODEL} is not catalogued`).toBeDefined()
  })

  it("states the free limits it was written against", () => {
    expect(FREE_LIMITS.lite).toEqual({ perMinute: 15, perDay: 500 })
    expect(FREE_LIMITS.flash).toEqual({ perMinute: 5, perDay: 20 })
  })
})

describe("setDefaultModel", () => {
  const write = (config: string, model: string) =>
    Effect.runPromise(setDefaultModel(model).pipe(Effect.provideService(Global.Service, roots(config))))

  it("writes the model into a new config file", async () => {
    const config = mkdtempSync(path.join(tmpdir(), "orbit-onboarding-"))
    await write(config, PRIMARY_MODEL)
    expect(JSON.parse(readFileSync(path.join(config, "opencode.json"), "utf8"))).toEqual({ model: PRIMARY_MODEL })
  })

  it("leaves a model the user already chose alone", async () => {
    const config = mkdtempSync(path.join(tmpdir(), "orbit-onboarding-"))
    writeFileSync(path.join(config, "opencode.json"), '{ "model": "google/gemini-3.8-flash" }\n')
    await write(config, PRIMARY_MODEL)
    expect(readFileSync(path.join(config, "opencode.json"), "utf8")).toContain("gemini-3.8-flash")
    expect(readFileSync(path.join(config, "opencode.json"), "utf8")).not.toContain("flash-lite")
  })
})
