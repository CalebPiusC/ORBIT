import { HttpRecorder } from "@opencode/http-recorder"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { Auth, LLMClient, type LLMClientService, RequestExecutor } from "@opencode/ai/route"
import { Model } from "@opencode/core/model"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { EventTable } from "@opencode/core/event/sql"
import { Permission } from "@opencode/core/permission"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Snapshot } from "@opencode/core/snapshot"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRunCoordinator } from "@opencode/core/session/run-coordinator"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionRunnerLLM } from "@opencode/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Tool } from "@opencode/core/tool"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Location } from "@opencode/core/location"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Instructions } from "@opencode/core/instructions/index"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { ReferenceInstructions } from "@opencode/core/reference/instructions"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { OptimizePlugin } from "@opencode/core/plugin/optimize"
import { IdentityPlugin } from "@opencode/core/plugin/identity"
import { ModelFallbackPlugin } from "@opencode/core/plugin/model-fallback"
import { Provider } from "@opencode/core/provider"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import path from "node:path"
import { testEffect } from "./lib/effect"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { promptLocationNode } from "./fixture/prompt-location"
import { permissionLayer } from "./lib/permission"
import { agentHost, modelHost, host, noProviders } from "./plugin/host"

// A hand-written cassette: the same chat-completions request answered twice with the real Gemini
// free-tier 429 and then with a recorded success, so the switch runs through the real runner and
// transport without a provider key. Two throttles are needed because one is retried in place.
const cassetteName = "session-runner/model-fallback-single-429"
const cassetteDirectory = path.resolve(import.meta.dir, "fixtures/recordings")
const cassette = HttpRecorder.layerFetch(cassetteName, {
  directory: cassetteDirectory,
  // The retry rewrites the model in the request body; only the route has to match.
  match: (incoming, recorded) => incoming.method === recorded.method && incoming.url === recorded.url,
})
const executor = RequestExecutor.layer.pipe(Layer.provide(cassette))
const client = LLMClient.layer.pipe(Layer.provide(executor))
const permission = permissionLayer()
const route = OpenAIChat.route
  .with({
    endpoint: { baseURL: "https://api.openai.com/v1" },
    auth: Auth.bearer("fixture"),
    generation: { maxTokens: 20, temperature: 0 },
  })
  .model({ id: "gpt-4o-mini", compatibility: { supportsPromptCacheKey: true } })

const primary = Model.Ref.make({ providerID: Provider.ID.make("google"), id: Model.ID.make("gemini-3.8-flash") })
const backup = Model.Ref.make({
  providerID: Provider.ID.make("openrouter"),
  id: Model.ID.make("openrouter/free"),
})
const info = (ref: Model.Ref, name: string): Model.Info =>
  ({ ...Model.Info.default(ref.providerID, ref.id), name }) as Model.Info

/**
 * One route for both models: the cassette answers the same URL either way, and mirroring the Session's
 * chosen model into `ref` is what the runner would do for two real provider packages.
 */
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: (session) =>
    Effect.succeed({
      ...SessionRunnerModel.resolved(route, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 20 },
      }),
      ref: session.model ?? primary,
    }),
})
const systemContext = Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) })
const instructionContext = Layer.mock(InstructionDiscovery.Service, {
  project: true,
  global: true,
  load: () => Effect.succeed(Instructions.empty),
})
const skillInstructions = Layer.mock(SkillInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const referenceInstructions = Layer.mock(ReferenceInstructions.Service, {
  load: () => Effect.succeed(Instructions.empty),
})
const mcpInstructions = Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) })
const config = Config.testLayer()
// Availability drives the fallback candidate search.
const promptModels = Layer.mock(Model.Service, {
  get: () => Effect.undefined,
  all: () => Effect.succeed([]),
  available: () => Effect.succeed([info(primary, "Gemini 3.8 Flash"), info(backup, "Free Models Router")]),
  default: () => Effect.undefined,
  small: () => Effect.undefined,
})
const runnerLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(SessionRunnerLLM.node, [
    Snapshot.node.replace(Snapshot.noopLayer),
    LayerNodePlatform.llmClient.replace(llmClient),
    SessionRunnerModel.node.replace(models),
    InstructionBuiltIns.node.replace(systemContext),
    InstructionDiscovery.node.replace(instructionContext),
    Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    SkillInstructions.node.replace(skillInstructions),
    ReferenceInstructions.node.replace(referenceInstructions),
    McpInstructions.node.replace(mcpInstructions),
    Config.node.replace(config),
    Permission.node.replace(permission),
    PluginSupervisor.node.replace(Layer.empty),
    Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
  ])
const execution = (llmClient: Layer.Layer<LLMClientService>) =>
  Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const sessionRunner = yield* SessionRunner.Service
      const coordinator = yield* SessionRunCoordinator.make<Session.ID, SessionRunner.RunError>({
        drain: (sessionID, force) => sessionRunner.drain({ sessionID, force }).pipe(Effect.asVoid),
      })
      return SessionExecution.Service.of({
        active: coordinator.active,
        isActive: coordinator.isActive,
        resume: coordinator.run,
        wake: coordinator.wake,
        interrupt: (sessionID) => coordinator.interrupt(sessionID),
        awaitIdle: coordinator.awaitIdle,
      })
    }),
  ).pipe(Layer.provide(runnerLayer(llmClient)), Layer.orDie)
const testLayer = (llmClient: Layer.Layer<LLMClientService>) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      Model.node,
      PluginHooks.node,
      Tool.node,
      SessionRunnerModel.node,
      InstructionBuiltIns.node,
      InstructionDiscovery.node,
      SkillInstructions.node,
      ReferenceInstructions.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      Session.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      LocationServiceMap.node.replace(promptLocationNode),
      LayerNodePlatform.llmClient.replace(llmClient),
      Permission.node.replace(permission),
      Model.node.replace(promptModels),
      SessionRunnerModel.node.replace(models),
      InstructionBuiltIns.node.replace(systemContext),
      InstructionDiscovery.node.replace(instructionContext),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      SkillInstructions.node.replace(skillInstructions),
      ReferenceInstructions.node.replace(referenceInstructions),
      Config.node.replace(config),
      Snapshot.node.replace(Snapshot.noopLayer),
      PluginSupervisor.node.replace(Layer.empty),
      Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
      SessionExecution.node.replace(execution(llmClient)),
    ],
  )
const it = testEffect(testLayer(client))
const sessionID = Session.ID.make("ses_runner_fallback")

describe("SessionRunnerLLM model fallback with one throttle", () => {
  // The retry schedule sleeps, so this test runs on the real clock rather than the test clock.
  it.live("retries one 429 in place and finishes on the same model", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const models = yield* Model.Service
      const hooks = yield* PluginHooks.Service
      const sessions = yield* Session.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "execute", resource: "*", effect: "deny" })
        }),
      )
      const pluginHost = host({
        agent: agentHost(agents),
        model: modelHost(models),
        provider: noProviders,
        // The fallback plugin needs the real session surface, not the host's unused stubs.
        session: {
          hook: (name: "retry" | "prompt", callback: (input: never) => Effect.Effect<void>) =>
            hooks.register("session", name, callback as never),
          get: (input: { sessionID: Session.ID }) => sessions.get(input.sessionID).pipe(Effect.orDie),
          switchModel: (input: { sessionID: Session.ID; model: Model.Ref }) =>
            sessions.switchModel({ sessionID: input.sessionID, model: input.model }).pipe(Effect.orDie),
          synthetic: (input: {
            sessionID: Session.ID
            text: string
            description?: string
            metadata?: Record<string, unknown>
          }) =>
            sessions
              .synthetic({
                sessionID: input.sessionID,
                text: input.text,
                ...(input.description === undefined ? {} : { description: input.description }),
                ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
              })
              .pipe(Effect.asVoid, Effect.orDie),
        } as never,
      })
      yield* Effect.forEach(OptimizePlugin.Plugins, (plugin) => plugin.effect(pluginHost), { discard: true })
      yield* IdentityPlugin.Plugin.effect(pluginHost)
      yield* ModelFallbackPlugin.Plugin.effect(pluginHost)

      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)

      const session = yield* Session.Service
      const prompt = yield* session.prompt({ sessionID, text: "Say hello in one short sentence.", resume: false })
      yield* session.resume(sessionID)

      const messages = yield* session.context(sessionID)
      expect(messages[0]).toMatchObject({ id: prompt.id, type: "user" })
      // The assistant answer arrived after the retry, from the cassette's recorded success.
      const answers = messages.filter((message) => message.type === "assistant")
      expect(answers.at(-1)).toMatchObject({ type: "assistant", finish: "stop" })
      expect(answers.at(-1)?.type === "assistant" ? answers.at(-1)!.content : []).toMatchObject([
        { type: "text", text: "Hello!" },
      ])
      // The task continued inside the same prompt instead of failing.
      expect(messages.filter((message) => message.type === "user")).toHaveLength(1)

      const events = yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(EventTable.seq)
        .all()
      const types = events.map((event) => event.type)
      // Google's wording reaches the session as a limit, not as an auth or transport failure.
      const retry = events.find((event) => event.type.startsWith("session.retry.scheduled"))
      const reported = retry?.data as unknown as { error: { type: string; message: string } }
      expect(reported.error.type).toBe("provider.rate-limit")
      expect(reported.error.message).toContain("You exceeded your current quota")
      // One 429 is not a reason to switch: nothing was selected and nothing was announced.
      expect(types).not.toContain("session.model.selected.1")
      expect(types).not.toContain("session.synthetic.1")
      // Two attempts: one throttled, then answered by the same model.
      expect(types.filter((type) => type === "session.step.started.1").length).toBe(2)

      const notice = messages.find(
        (message) => typeof (message as { text?: unknown }).text === "string" && String((message as { text: string }).text).includes("Switched to"),
      )
      expect(notice).toBeUndefined()
    }).pipe(Effect.withSpan("fixture.fallback")),
  )
})
