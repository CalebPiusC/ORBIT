---
id: refactor-no-behaviour-change
title: Refactor duplicate logic, keep behaviour identical
fixture: messy-module
scoring: automatic
check: bun test && test "$(grep -c 'slice(0, 37)' src/format.ts)" -le 1
expect: format
forbid: ""
---

## Prompt

`src/format.ts` duplicates the title-clipping logic. De-duplicate it without changing any behaviour.

## Why it matters

Tests must still pass, callers (`src/page.ts`) must keep working, and the duplicated expression should
appear once (usually as a shared helper).

## Success criteria

- `bun test` exits 0.
- `slice(0, 37)` appears at most once in `src/format.ts`.
- The exported function names stay the same so `page.ts` keeps compiling.
