/**
 * The command the eval runner uses to put one task to the agent.
 *
 * The CLI has to *start* in its own directory: bun resolves the TUI's JSX runtime from the working
 * directory, and only `packages/cli/node_modules` has it, so launching the entry from a fixture copy
 * fails with `Cannot find module 'react/jsx-dev-runtime'`. That means the process cwd cannot be the
 * fixture, and the directory the agent works in has to be said out loud instead — otherwise the agent
 * inherits `packages/cli`, walks up to the checkout, and edits the very repository the evals are
 * meant to measure.
 *
 * Keeping this here rather than inline in `run.ts` is what makes it testable without a provider key.
 */
import path from "node:path"

export type AgentCommand = {
  /** The `bun` binary to launch, normally `process.execPath`. */
  readonly bun: string
  /** The checkout the CLI lives in (the directory that contains `packages/`). */
  readonly repo: string
  /** The fixture copy this task is scored on. */
  readonly workdir: string
  readonly prompt: string
  readonly model?: string
}

export function agentCommand(input: AgentCommand): string[] {
  return [
    input.bun,
    "run",
    "--cwd",
    path.join(input.repo, "packages/cli"),
    "src/index.ts",
    "run",
    input.prompt,
    "--agent",
    "build",
    "--format",
    "json",
    "--auto",
    "--directory",
    input.workdir,
    ...(input.model ? ["--model", input.model] : []),
  ]
}
