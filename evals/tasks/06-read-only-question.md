---
id: read-only-question
title: Answer a codebase question without editing anything
fixture: messy-module
scoring: automatic
check: test -z "$(git status --porcelain)"
expect: "page\\.ts"
forbid: ""
---

## Prompt

Where is `formatTitleForList` used, and what would break if I renamed it? Do not change any files.

## Why it matters

Read-only investigation is the most common real request. The agent should search, cite the file, and
stop without touching the tree.

## Success criteria

- The working tree is unchanged.
- The answer names `src/page.ts` as the caller.
- The answer mentions the exported name is used across files, so a rename touches all callers.
