---
id: fix-failing-test
title: Fix a failing test without breaking the rest
fixture: failing-test
scoring: automatic
check: bun test
expect: total
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
