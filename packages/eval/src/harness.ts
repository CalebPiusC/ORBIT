/**
 * The evaluation harness. Bootstraps the inherited OpenCode agent engine over a
 * temp workspace, drives a fixture to completion under a bounded timeout, and
 * captures events, tool calls, diffs, script accounting and metrics before
 * running the fixture's hidden correctness check and rendering a report.
 *
 * The harness is backend-agnostic: it accepts an `EvalBackend` that supplies the
 * LLM client layer (deterministic TestLLM or the live default) and a setup
 * effect returning a per-run session handle. The OpenCode execution runner is
 * preserved untouched.
 */
import { Cause, Duration, Effect, Exit, Layer, Option, Ref, Stream } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Session } from "@opencode/core/session"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { ModelsDev } from "@opencode/core/models-dev"
import { Agent } from "@opencode/core/agent"
import { Provider } from "@opencode/core/provider"
import { Model } from "@opencode/core/model"
import { AbsolutePath } from "@opencode/core/schema"
import { Plugin } from "@opencode/core/plugin"
import { captureToolCalls, captureDiffs, captureMetrics } from "./capture.js"
import { renderReport } from "./report.js"
import type { EvalBackend } from "./backend/types.js"
import type { CapturedEvent, CheckResult, EvalResult, Fixture } from "./types.js"

/** Default session timeout in milliseconds when `fixture.timeoutMs` is omitted. */
export const DEFAULT_SESSION_TIMEOUT_MS = 30_000

/** Creates a temp directory scoped to the effect, removed on completion. */
const tmpdirScoped = (prefix = "opencode-eval-") =>
  Effect.acquireRelease(
    Effect.tryPromise(() => fs.mkdtemp(path.join(os.tmpdir(), prefix))),
    (dir) => Effect.tryPromise(() => fs.rm(dir, { recursive: true, force: true })).pipe(Effect.orDie),
  ).pipe(Effect.map((dir) => ({ path: dir })))

/** A disposable temp dir for the global layer. */
const disposableTmp = async (prefix: string) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  return {
    path: dir,
    [Symbol.asyncDispose]() {
      return fs.rm(dir, { recursive: true, force: true })
    },
  }
}

/** Temp-global layer so the run never touches the user's real OpenCode state. */
const tempGlobalLayer = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => disposableTmp("opencode-eval-global-")),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.map((tmp) => {
      const data = path.join(tmp.path, "data")
      const cache = path.join(tmp.path, "cache")
      return Global.layerWith({
        data,
        cache,
        config: path.join(tmp.path, "config"),
        state: path.join(tmp.path, "state"),
        tmp: path.join(tmp.path, "tmp"),
        bin: path.join(cache, "bin"),
        log: path.join(data, "log"),
        repos: path.join(data, "repos"),
      })
    }),
  ),
)

/** Keeps ModelsDev offline so the harness never phones home. */
const offlineModels = ModelsDev.node.replace(ModelsDev.configured({ fetch: false }))

/** The deterministic model resolved for every eval session. */
const evalModel = () =>
  SessionRunnerModel.resolved(
    LanguageModel.make({ id: "eval", provider: "test", route: OpenAIChat.route }),
    {
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      cost: [],
      limit: { context: 200_000, output: 32_000 },
    },
  )

/** Builds the app layer for a run, substituting the backend's LLM client. */
const buildAppLayer = (llmLayer: Layer.Layer<never, never, never> | undefined) => {
  const group = LayerNode.group([Session.node, LocationServiceMap.node, Bus.node])
  const baseReplacements: LayerNode.Replacements = [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    SessionRunnerModel.node.replace(
      Layer.succeed(SessionRunnerModel.Service, {
        resolve: () => Effect.succeed(evalModel()),
      }),
    ),
  ]
  if (llmLayer === undefined) {
    return AppNodeBuilder.build(group, baseReplacements)
  }
  return Layer.merge(
    llmLayer,
    AppNodeBuilder.build(group, [
      ...baseReplacements,
      // Layer<ROut> has ROut contravariant, so Layer<never> doesn't satisfy
      // the "closed layer" constraint on replace(). The actual value (e.g.
      // TestLLM.testLayer()) does — cast through never to bypass the variance gap.
      LayerNodePlatform.llmClient.replace(llmLayer as never),
    ]),
  )
}

/** Writes the fixture's initial files into the workspace. */
const writeFixtureFiles = (directory: string, files: Readonly<Record<string, string>>) =>
  Effect.forEach(
    Object.entries(files),
    ([rel, content]) =>
      Effect.promise(async () => {
        const full = path.join(directory, rel)
        await fs.mkdir(path.dirname(full), { recursive: true })
        await fs.writeFile(full, content)
      }),
    { discard: true },
  )

/** Runs `fixture.check` while catching both synchronous throws and Effect failures/defects. */
const runCheckSafely = (
  fixture: Fixture,
  directory: string,
): Effect.Effect<CheckResult> =>
  Effect.gen(function* () {
    try {
      const exit = yield* Effect.exit(fixture.check({ directory, initial: fixture.files }))
      return Exit.isFailure(exit)
        ? { pass: false, details: `check failed: ${Cause.pretty(exit.cause)}` }
        : exit.value
    } catch (error) {
      return {
        pass: false,
        details: `check threw: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  })

/**
 * Runs a single fixture and returns a captured, checked, reported result.
 * Both the session and the workspace/global directories are scoped so
 * timeouts or failures always stop background work and clean up resources.
 */
export const runFixture = (fixture: Fixture, backend: EvalBackend): Effect.Effect<EvalResult> =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = Date.now()
      const tmp = yield* tmpdirScoped()
      yield* writeFixtureFiles(tmp.path, fixture.files)

      const appLayer = buildAppLayer(backend.llmLayer)
      const timeoutMs = fixture.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS

      const captured = yield* Effect.scoped(
        Effect.gen(function* () {
          const backendSession = yield* backend.setup(fixture)

          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const locations = yield* LocationServiceMap.Service

          // Capture every bus event published during the run.
          const eventsRef = yield* Ref.make<CapturedEvent[]>([])
          const collect = bus.subscribe().pipe(
            Stream.tap((event) =>
              Ref.update(eventsRef, (acc) => [...acc, { type: event.type, data: event.data }]),
            ),
            Stream.runDrain,
          )
          yield* collect.pipe(Effect.forkScoped({ startImmediately: true }))

          // Register session removal as a scope finalizer so active execution,
          // blocking/background jobs, child sessions and transports are always torn down.
          const session = yield* Effect.acquireRelease(
            sessions.create({
              location: { directory: AbsolutePath.make(tmp.path) },
              agent: Agent.ID.make("build"),
              model: Model.Ref.make({ id: Model.ID.make("eval"), providerID: Provider.ID.make("test") }),
            }),
            (created) => sessions.remove(created.id).pipe(Effect.ignore),
          )

          const location = locations.get(session.location)

          const sessionExit = yield* Effect.exit(
            Effect.gen(function* () {
              yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(location))
              yield* sessions.prompt({ sessionID: session.id, text: fixture.prompt })
              yield* sessions.wait(session.id)
            }).pipe(Effect.timeoutOption(Duration.millis(timeoutMs))),
          )

          const timedOut = Exit.isSuccess(sessionExit) && Option.isNone(sessionExit.value)
          const sessionFailed = Exit.isFailure(sessionExit)

          // Interrupt and settle any in-flight execution before reading context/accounting.
          if (timedOut || sessionFailed) {
            yield* sessions.interrupt(session.id).pipe(Effect.ignore)
            yield* sessions.wait(session.id).pipe(Effect.ignore)
          }

          // Let the event collector drain final events before snapshotting.
          yield* Effect.yieldNow
          yield* Effect.yieldNow

          const messages = yield* sessions.context(session.id).pipe(Effect.orElseSucceed(() => []))
          const toolCalls = captureToolCalls(messages)
          const scriptAccounting = yield* backendSession.accounting(toolCalls)
          const events = yield* Ref.get(eventsRef)

          return { sessionExit, timedOut, sessionFailed, messages, toolCalls, scriptAccounting, events }
        }),
      ).pipe(Effect.provide(appLayer))

      const diffs = yield* captureDiffs(tmp.path, fixture.files)
      const metrics = captureMetrics(captured.events, captured.messages, started)

      const timeoutDetails = `session timed out after ${timeoutMs}ms`
      const check: CheckResult = captured.timedOut
        ? { pass: false, details: timeoutDetails }
        : yield* runCheckSafely(fixture, tmp.path)

      const scriptAccounting = captured.scriptAccounting
      const scriptValid = scriptAccounting === undefined || scriptAccounting.outcome === "valid"
      const passed = !captured.timedOut && !captured.sessionFailed && scriptValid && check.pass

      let error: string | undefined
      if (captured.timedOut) {
        error = timeoutDetails
      } else if (Exit.isFailure(captured.sessionExit)) {
        error = `session failed: ${Cause.pretty(captured.sessionExit.cause)}`
      } else if (scriptAccounting !== undefined && scriptAccounting.outcome !== "valid") {
        error = scriptAccounting.details
          ? `script ${scriptAccounting.outcome}: ${scriptAccounting.details}`
          : `script ${scriptAccounting.outcome}`
      }

      const result: EvalResult = {
        fixtureId: fixture.id,
        backend: backend.name,
        passed,
        check,
        metrics,
        toolCalls: captured.toolCalls,
        diffs,
        events: captured.events,
        report: "",
        ...(error !== undefined ? { error } : {}),
        ...(scriptAccounting !== undefined ? { scriptAccounting } : {}),
        ...(captured.timedOut ? { timedOut: true } : {}),
      }
      return { ...result, report: renderReport(result) }
    }),
  ).pipe(
    Effect.match({
      onFailure: (error) => {
        const message = `run failed: ${error instanceof Error ? error.message : String(error)}`
        const result: EvalResult = {
          fixtureId: fixture.id,
          backend: backend.name,
          passed: false,
          check: { pass: false, details: message },
          metrics: { steps: 0, errors: 1, inputTokens: 0, outputTokens: 0, toolCalls: 0, durationMs: 0 },
          toolCalls: [],
          diffs: [],
          events: [],
          report: "",
          error: message,
        }
        return { ...result, report: renderReport(result) }
      },
      onSuccess: (value) => value,
    }),
  )
