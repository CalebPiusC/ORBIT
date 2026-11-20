---
id: design-proposal-first
title: Propose layout, spacing and colour before writing UI
fixture: small-app
scoring: rubric
check: test -z "$(git status --porcelain)"
expect: "spacing|layout|colour|color"
forbid: ""
---

## Prompt

Add a pricing section to this page with three plans. Before you build it, propose the layout, spacing
and colour choices and wait for my go-ahead.

## Why it matters

Phase 4 design rule: for UI work, propose layout, spacing and colour choices first, and avoid generic
templated output. This task checks the proposal happens and that the code waits for the answer.

## Success criteria

- The reply describes layout, spacing and colour decisions that fit the existing black/white
  document styling, and asks to proceed.
- Nothing is edited: a proposal is not an implementation, and the working tree stays clean until the
  user says go. The edit itself is a separate request.
