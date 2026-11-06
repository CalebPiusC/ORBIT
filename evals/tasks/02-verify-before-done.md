---
id: verify-before-done
title: Add a feature and prove it works
fixture: failing-test
scoring: automatic
check: bun test && grep -q "discount" src/cart.ts
expect: test
forbid: ""
---

## Prompt

Add a `discount(items, percent)` function to `src/cart.ts` that returns the discounted total, and
cover it with a test.

## Why it matters

Phase 4 requires "verify its own work": write the code, run the suite, read the output, fix mistakes.
This task is automatic because the fixture already has a working test setup.

## Success criteria

- `src/cart.ts` exports `discount`.
- `bun test` exits 0, including a new test for `discount`.
- The agent's final message reports the actual test result rather than assuming it.
