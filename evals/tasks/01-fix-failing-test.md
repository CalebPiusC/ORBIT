---
id: fix-failing-test
title: Fix a failing test without breaking the rest
fixture: failing-test
scoring: automatic
check: bun test
expect: reduce|initial value|empty string|concatenat|coerc|as text|nan|accumulator|typeof sum
forbid: ""
---

## Prompt

The tests in this project are failing. Find out why and fix the bug.

## Why it matters

A careful agent reads the failing test and the implementation before editing, changes the smallest
thing that explains the failure, and re-runs the suite. A careless one rewrites the test to match the
bug, or edits three files and declares success.

## Success criteria

- `bun test` exits 0 in the fixture.
- The test file was not weakened (no changed expectations, no skipped tests).
- The agent ran the tests itself at least once before saying it was done.

## Why the expect pattern is what it is

The bug is a `reduce` whose initial value is `""`, so the accumulator is a string and the prices are
concatenated — `"65"` where the test wants 11. The reply has to name that cause, in its own words.

The pattern used to be `total`, which failed a correct run: it explained the `reduce` initial value
without repeating the function's name, and the word `total` never came up. A one-word pattern takes
whichever name the agent happens to reach for, not whether it understood the bug — and `total` was
worse than that, since a reply saying "the total is right now, I edited cart.ts" would have passed
without explaining anything.
