# @opencode/eval

Deterministic evaluation harness for ORBIT coding-task benchmarks. Drives the inherited OpenCode agent engine over scripted fixtures — no API credits consumed.

## Usage

```bash
# Run all fixtures with the deterministic backend (TestLLM — no API calls)
bun run eval

# Or explicitly
bun run eval:deterministic

# Run regression, script-accounting, and timeout tests
bun run test
```

Exits 0 when every fixture passes, 1 otherwise.

## What it does

For each fixture, the harness:

1. Creates a temporary workspace and writes the fixture's initial files
2. Builds the OpenCode app layer with a TestLLM client (deterministic)
3. Starts a session and sends the fixture prompt
4. The deterministic backend serves scripted responses: each turn is either a batch of tool calls (`write`, `edit`, `shell`, …) or a final text response
5. Captures tool calls, file diffs, bus events, and metrics from the completed session
6. Runs the fixture's hidden correctness check against the final workspace state
7. Renders a completion report

## Architecture

| File | Purpose |
|------|---------|
| `src/types.ts` | Shared types: `Fixture`, `ScriptedTurn`, `ScriptAccounting`, `EvalResult`, `CheckContext`, `CheckResult` |
| `src/backend/types.ts` | `EvalBackend` and `BackendSession` interfaces — pluggable backend contract |
| `src/backend/deterministic.ts` | TestLLM-based deterministic backend with script accounting |
| `src/harness.ts` | Core evaluation loop: workspace setup, bounded session timeout (`timeoutMs`, default 30s), session lifecycle, capture, check, report |
| `src/capture.ts` | Extracts tool calls, file diffs, metrics from session messages and workspace state |
| `src/report.ts` | Renders human-readable and JSON completion reports |
| `src/fixtures/index.ts` | Ten deterministic coding-task fixtures |
| `src/index.ts` | CLI entry point |
| `test/` | Permanent negative regression, script accounting, and timeout/cleanup tests |

## Fixtures

Ten fixtures exercise the inherited tool surface across simple arithmetic, text manipulation, and code-generation tasks:

| ID | Task | Tools |
|----|------|-------|
| `add` | Add 3+4, write to answer.txt | write |
| `multiply` | Multiply 6×7, write to answer.txt | write |
| `edit` | Create greeting.txt, then edit its content | write, edit |
| `shell` | Run `echo 42 > answer.txt` via shell | shell |
| `fizzbuzz` | Write a FizzBuzz function | write |
| `palindrome` | Write "racecar" to a file | write |
| `reverse` | Reverse "hello" → "olleh" | write |
| `factorial` | Calculate 5! = 120 | write |
| `count` | Count "a" in "banana" → 3 | write |
| `gcd` | Calculate GCD(12,18) = 6 | write |

## Adding a fixture

Add an entry to `src/fixtures/index.ts`:

```ts
{
  id: "my-fixture",
  title: "My fixture",
  description: "What it does",
  files: {}, // initial workspace files (path -> content)
  prompt: "The prompt sent to the agent",
  script: [
    { toolCalls: [{ name: "write", input: { path: "answer.txt", content: "42" } }] },
    { text: "Done" },
  ],
  check: (ctx) =>
    Effect.gen(function* () {
      const content = yield* readFile(ctx.directory, "answer.txt")
      return { pass: content.trim() === "42", details: "..." }
    }),
}
```

## Backends

The `EvalBackend` interface allows alternative backends (e.g., live LLM). The deterministic backend uses `TestLLM` from `@opencode/ai/testing` — the same test double used by the project's own test suite — so runs are fully reproducible and consume no API credits.
