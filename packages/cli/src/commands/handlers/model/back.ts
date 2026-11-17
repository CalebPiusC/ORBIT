import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

/**
 * Undo a fallback (or any model change) without opening the TUI.
 *
 * The default model from config is the primary a session falls back to, so this needs no state of
 * its own: it reads the same default the runner would, and switches the session to it.
 */
const handler = Effect.fn("cli.model.back")(function* (input: Runtime.Input<typeof Commands.commands.model.commands.back>) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const directory = process.cwd()
  const sessionID = yield* Option.match(input.session, {
    onNone: () =>
      Effect.gen(function* () {
        const page = yield* Effect.tryPromise({
          try: (signal) => client.session.list({ directory, order: "desc", limit: 1 }, { signal }),
          catch: (cause) => cause,
        })
        const latest = page.data[0]
        if (!latest) return yield* Effect.fail(new Error("No session to change in this folder. Pass --session <id>."))
        return latest.id
      }),
    onSome: (id) => Effect.succeed(id),
  })
  const target = yield* Option.match(input.to, {
    onNone: () =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: (signal) => client.model.default({ location: { directory } }, { signal }),
          catch: (cause) => cause,
        })
        const model = response.data
        if (!model)
          return yield* Effect.fail(
            new Error('No default model is configured. Set "model" in orbit.json, or pass --to provider/model.'),
          )
        return Model.Ref.make({ providerID: Provider.ID.make(model.providerID), id: Model.ID.make(model.id) })
      }),
    onSome: (value: string) => {
      const parsed = Model.Ref.parse(value)
      return Effect.succeed(parsed)
    },
  })
  yield* Effect.tryPromise({
    try: (signal) => client.session.switchModel({ sessionID, model: target }, { signal }),
    catch: (cause) => cause,
  })
  yield* Effect.sync(() => {
    process.stdout.write(`Switched ${sessionID} to ${target.providerID}/${target.id}.` + EOL)
  })
})

export default Runtime.handler(Commands.commands.model.commands.back, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
