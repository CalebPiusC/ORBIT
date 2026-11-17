import { expect, test } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { ai } from "../src/effect.js"
import { LLMClient } from "../src/route/client.js"
import { RequestExecutor } from "../src/route/executor.js"
import { RateLimit } from "../src/route/rate-limit.js"
import { OpenAI } from "../src/providers.js"
import { handlerLayer } from "./lib/http.js"
import { deltaChunk, finishChunk, usageChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"
import { it } from "./lib/effect.js"

const model = OpenAI.configure({ apiKey: "fixture", baseURL: "https://provider.test/v1" }).chat("gpt-4o-mini")
const request = () => ai.request({ model, prompt: "hello" })

/** A chat stream that reports 4,100 prompt tokens, so settlement has the provider's own number. */
const body = sseEvents(
  deltaChunk({ role: "assistant", content: "hi" }),
  finishChunk("stop"),
  usageChunk({ prompt_tokens: 4_100, completion_tokens: 1, total_tokens: 4_101 }),
)

const world = () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const http = handlerLayer((input) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (value) => value + 1)
        return input.respond(body, { headers: { "content-type": "text/event-stream" } })
      }),
    )
    return { calls, executor: RequestExecutor.layer.pipe(Layer.provide(http)) }
  })

const clientWith = (executor: Layer.Layer<RequestExecutor.Service>, rateLimit: Layer.Layer<RateLimit.Service>) =>
  LLMClient.meteredLayer.pipe(Layer.provide(Layer.merge(executor, rateLimit)))

it.effect("sends every request when the model has no configured limits", () =>
  Effect.gen(function* () {
    const { calls, executor } = yield* world()
    const layer = clientWith(executor, RateLimit.layer(() => undefined))
    yield* Effect.gen(function* () {
      for (let index = 0; index < 20; index++) yield* LLMClient.generate(request())
    }).pipe(Effect.provide(layer))
    expect(yield* Ref.get(calls)).toBe(20)
  }),
)

test("waits out the window instead of sending a request the provider would refuse", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const http = handlerLayer((input) =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (value) => value + 1)
          return input.respond(body, { headers: { "content-type": "text/event-stream" } })
        }),
      )
      const executor = RequestExecutor.layer.pipe(Layer.provide(http))
      const waits = yield* Ref.make<number[]>([])
      const layer = clientWith(
        executor,
        RateLimit.layer(() => ({ requestsPerMinute: 3 }), {
          // Recorded rather than slept: the arithmetic is what this asserts, not the wall clock.
          sleep: (millis) => Ref.update(waits, (all) => [...all, millis]),
        }),
      )
      yield* Effect.gen(function* () {
        for (let index = 0; index < 4; index++) yield* LLMClient.generate(request())
      }).pipe(Effect.provide(layer))
      return { calls: yield* Ref.get(calls), waits: yield* Ref.get(waits) }
    }),
  )
  expect(result.calls).toBe(4)
  const [waitMs] = result.waits
  expect(result.waits).toHaveLength(1)
  // The fourth request slept out the rest of the first one's minute, then went out.
  expect(waitMs).toBeGreaterThan(59_000)
  expect(waitMs).toBeLessThanOrEqual(60_000)
})

it.effect("charges the estimate first and corrects it with the provider's usage", () =>
  Effect.gen(function* () {
    const { executor } = yield* world()
    const reserved: number[] = []
    const settled: Array<number | undefined> = []
    const spy: RateLimit.Interface = {
      reserve: (input) =>
        Effect.sync(() => {
          reserved.push(input.tokens)
          return 0
        }),
      settle: (input) =>
        Effect.sync(() => {
          settled.push(input.actual)
        }),
      spend: () => Effect.succeed({ requests: 0, tokens: 0 }),
    }
    const layer = clientWith(executor, Layer.succeed(RateLimit.Service, RateLimit.Service.of(spy)))
    yield* LLMClient.generate(request()).pipe(Effect.provide(layer))

    expect(reserved).toHaveLength(1)
    // The estimate comes from the compiled body, so it is never zero for a real prompt.
    expect(reserved[0]).toBeGreaterThan(20)
    expect(settled).toEqual([4_100])
  }),
)
