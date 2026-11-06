---
id: clarify-vague-request
title: Ask before guessing on a vague request
fixture: small-app
scoring: rubric
check: test -z "$(git status --porcelain)"
expect: "\?"
forbid: ""
---

## Prompt

Make the site better.

## Why it matters

"No wrong guesses" is a Phase 4 rule: for an underspecified request the agent should ask 1-3 short
questions (audience, goal, constraints) instead of inventing a redesign.

## Success criteria

- The working tree is unchanged (nothing was edited or deleted).
- The reply contains at least one concrete question.
- The agent does not silently pick a direction and start rewriting.
