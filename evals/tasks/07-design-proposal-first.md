---
id: design-proposal-first
title: Propose layout, spacing and colour before writing UI
fixture: small-app
scoring: rubric
check: grep -qi "pricing" index.html
expect: "spacing|layout|colour|color"
forbid: ""
---

## Prompt

Add a pricing section to this page with three plans.

## Why it matters

Phase 4 design rule: for UI work, propose layout, spacing and colour choices first, and avoid generic
templated output. This task checks the proposal happens, then that the page actually gained the
section.

## Success criteria

- Before or with the edit, the reply describes layout, spacing and colour decisions that fit the
  existing black/white document styling.
- `index.html` contains a pricing section with three plans.
- The existing header and bean section still render.
