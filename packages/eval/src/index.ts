#!/usr/bin/env bun
/**
 * CLI entry point for the ORBIT evaluation harness.
 *
 * Runs all deterministic fixtures against the inherited OpenCode agent engine
 * and prints a completion report for each. Exits 0 when every fixture passes,
 * 1 otherwise. The deterministic backend uses TestLLM — no API credits are
 * consumed.
 */
import { Effect } from "effect"
import { runFixture } from "./harness.js"
import { deterministicBackend } from "./backend/deterministic.js"
import { fixtures } from "./fixtures/index.js"

const main = Effect.gen(function* () {
  const backend = deterministicBackend()
  const results = yield* Effect.forEach(fixtures, (fixture) => runFixture(fixture, backend))

  let passed = 0
  for (const result of results) {
    console.log(result.report)
    if (result.passed) passed++
  }

  const failed = results.length - passed
  console.log(`\n${passed}/${results.length} passed, ${failed} failed`)
  return failed === 0 ? 0 : 1
})

Effect.runPromise(main).then((code) => {
  process.exit(code)
})
