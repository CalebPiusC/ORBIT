import { describe, expect, it } from "bun:test"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { ModelFallback } from "@opencode/core/model-fallback"

const model = (providerID: string, id: string, overrides: Partial<Model.Info> = {}): Model.Info =>
  ({
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
    name: id,
    ...overrides,
  }) as Model.Info

const ref = (providerID: string, id: string) =>
  Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) })

const error = (input: Partial<{ type: string; message: string; retryAfterMs: number; body: string }>) => ({
  type: input.type ?? "provider.rate-limit",
  message: input.message ?? "Too many requests",
  ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
  ...(input.body === undefined ? {} : { response: { body: input.body } }),
})

// Google answers a per-minute throttle and an exhausted free tier with the same 429 and the same
// opening sentence, so these two fixtures are the ones that must be told apart.
const googlePerMinute = error({
  message:
    "You exceeded your current quota, please check your plan and billing details. Quota exceeded for quota metric 'Generate Content API requests per minute' and limit 'GenerateContentRequestsPerMinutePerProjectPerModel-FreeTier' for service 'generativelanguage.googleapis.com'.",
  retryAfterMs: 23_000,
  body: JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [] }],
    },
  }),
})

const googlePerDay = error({
  message:
    "You exceeded your current quota, please check your plan and billing details. Quota exceeded for quota metric 'Generate Content API requests per day' and limit 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' for service 'generativelanguage.googleapis.com'.",
  body: JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }],
    },
  }),
})

describe("ModelFallback", () => {
  it("defaults to asking once, a free router backup and a three attempt threshold", () => {
    const settings = ModelFallback.settings()
    expect(settings.mode).toBe("ask")
    expect(settings.threshold).toBe(3)
    expect(settings.maxSwitches).toBe(3)
    expect(settings.resetAfterMs).toBe(3_600_000)
    expect(settings.models.map((item) => `${item.providerID}/${item.id}`)).toEqual(["openrouter/openrouter/free"])
  })

  it("reads configured backups, threshold and reset window", () => {
    const settings = ModelFallback.settings({
      fallback: {
        mode: "always",
        models: [
          { providerID: Provider.ID.make("openrouter"), model: Model.ID.make("first") },
          { providerID: Provider.ID.make("openrouter"), model: Model.ID.make("second") },
        ],
        threshold: 5,
        resetAfter: 90_000,
        maxSwitches: 2,
      } as never,
    })
    expect(settings.mode).toBe("always")
    expect(settings.threshold).toBe(5)
    expect(settings.resetAfterMs).toBe(90_000)
    expect(settings.models.map((item) => item.id)).toEqual(["first", "second"] as never)
  })

  it("treats limit errors as limits and auth errors as something else", () => {
    expect(ModelFallback.isLimit(error({ type: "provider.rate-limit" }))).toBe(true)
    expect(ModelFallback.isLimit(error({ type: "provider.quota" }))).toBe(true)
    expect(ModelFallback.isLimit(error({ type: "provider.auth" }))).toBe(false)
    expect(ModelFallback.isLimit(error({ type: "provider.transport" }))).toBe(false)
  })

  it("separates a daily cap from a per minute throttle in Google's wording", () => {
    expect(ModelFallback.isCap(googlePerDay)).toBe(true)
    expect(ModelFallback.isCap(googlePerMinute)).toBe(false)
    expect(ModelFallback.isCap(error({ type: "provider.free-limit" }))).toBe(true)
  })

  it("does not switch on one stray rate limit", () => {
    const settings = ModelFallback.settings()
    expect(
      ModelFallback.shouldSwitch({ error: googlePerMinute, attempt: 2, settings, switches: 0 }),
    ).toBe(false)
    expect(
      ModelFallback.shouldSwitch({ error: googlePerMinute, attempt: 3, settings, switches: 0 }),
    ).toBe(true)
  })

  it("honours a configured threshold", () => {
    const settings = { ...ModelFallback.settings(), threshold: 5 }
    expect(ModelFallback.shouldSwitch({ error: googlePerMinute, attempt: 4, settings, switches: 0 })).toBe(false)
    expect(ModelFallback.shouldSwitch({ error: googlePerMinute, attempt: 5, settings, switches: 0 })).toBe(true)
  })

  it("switches immediately for an exhausted allowance", () => {
    const settings = ModelFallback.settings()
    expect(ModelFallback.shouldSwitch({ error: googlePerDay, attempt: 2, settings, switches: 0 })).toBe(true)
    expect(
      ModelFallback.shouldSwitch({ error: error({ type: "provider.quota" }), attempt: 2, settings, switches: 0 }),
    ).toBe(true)
  })

  it("stays put when disabled or out of switches", () => {
    const off = { ...ModelFallback.settings(), mode: "never" as const }
    expect(ModelFallback.shouldSwitch({ error: googlePerDay, attempt: 5, settings: off, switches: 0 })).toBe(false)
    const exhausted = ModelFallback.settings()
    expect(
      ModelFallback.shouldSwitch({ error: googlePerDay, attempt: 5, settings: exhausted, switches: 3 }),
    ).toBe(false)
  })

  it("picks the first enabled backup that is not the current or tried model", () => {
    const settings = ModelFallback.settings({
      fallback: {
        models: [
          { providerID: Provider.ID.make("openrouter"), model: Model.ID.make("a") },
          { providerID: Provider.ID.make("openrouter"), model: Model.ID.make("b") },
          { providerID: Provider.ID.make("openrouter"), model: Model.ID.make("c") },
        ],
      } as never,
    })
    const available = [
      model("google", "primary"),
      model("openrouter", "b"),
      model("openrouter", "c"),
      model("openrouter", "image-only", {
        capabilities: { tools: false, input: ["text"], output: ["image/png"] },
      }),
    ]
    expect(ModelFallback.candidate({ settings, current: ref("google", "primary"), tried: [], available })?.id).toBe(
      Model.ID.make("b"),
    )
    expect(
      ModelFallback.candidate({
        settings,
        current: ref("google", "primary"),
        tried: [ref("openrouter", "b")],
        available,
      })?.id,
    ).toBe(Model.ID.make("c"))
    expect(
      ModelFallback.candidate({
        settings,
        current: ref("openrouter", "c"),
        tried: [ref("openrouter", "b")],
        available,
      }),
    ).toBeUndefined()
  })

  it("prefers the provider's reset hint and otherwise uses the configured wait", () => {
    const settings = ModelFallback.settings()
    expect(ModelFallback.resetAt({ error: googlePerMinute, now: 1000, settings })).toBe(24_000)
    expect(ModelFallback.resetAt({ error: googlePerDay, now: 1000, settings })).toBe(3_601_000)
  })

  it("says what happened in plain english", () => {
    expect(ModelFallback.humanize(30 * 60_000)).toBe("about 30 minutes")
    expect(ModelFallback.humanize(2 * 60 * 60_000)).toBe("about 2 hours")
    expect(ModelFallback.humanize(10_000)).toBe("less than a minute")
    expect(
      ModelFallback.switched({
        from: "Gemini 3.8 Flash",
        to: "OpenRouter Free Models Router",
        resetsInMs: 2 * 60 * 60_000,
        reason: "cap",
      }),
    ).toBe(
      "Gemini 3.8 Flash reached its usage limit (resets in about 2 hours). Switched to OpenRouter Free Models Router and continuing this task.",
    )
    expect(
      ModelFallback.switched({
        from: "Gemini 3.8 Flash",
        to: "OpenRouter Free Models Router",
        resetsInMs: 20_000,
        reason: "limit",
      }),
    ).toBe("Gemini 3.8 Flash is rate limited. Switched to OpenRouter Free Models Router and continuing this task.")
    expect(ModelFallback.returned({ from: "Gemini 3.8 Flash", to: "OpenRouter Free Models Router" })).toBe(
      "Gemini 3.8 Flash is available again. Switched back to it from OpenRouter Free Models Router.",
    )
  })
})
