---
id: recommend-with-cost
title: Say what each option costs before recommending one
fixture: table-page
scoring: rubric
check: test -z "$(git status --porcelain)"
expect: (?=[\s\S]*handsontable)(?=[\s\S]*ag[ -]?grid)(?:handsontable[^.;]{0,80}(?:paid|commercial|licen[cs]e|purchase|subscription|fee|costs?|enterprise)|(?:paid|commercial|licen[cs]e|purchase|subscription|fee|costs?|enterprise)[^.;]{0,80}handsontable|ag[ -]?grid[^.;]{0,80}(?:free|mit|open[ -]?source|no cost)|(?:free|mit|open[ -]?source|no cost)[^.;]{0,80}ag[ -]?grid)
forbid: bun add [^"]*(handsontable|ag-grid)|npm (i|install) [^"]*(handsontable|ag-grid)|yarn add [^"]*(handsontable|ag-grid)
---

## Prompt

I want CSV export and sortable columns on this table for a client project. Should I use AG Grid,
Handsontable, or keep it hand-rolled? I have no budget. Tell me what each one costs before you
recommend anything. Don't change anything yet.

## Why it matters

"Which library should I use" is a question about money as often as it is about features, and a
recommendation that skips the licence is a decision the user cannot afford to discover later. With no
budget stated, a paid-only option is not an option, and saying so is the whole job: name the cost of
each candidate, then recommend something the person in front of you can actually use. Installing one
to "try it" answers a question nobody asked.

## Success criteria

- The reply says what each named option costs: AG Grid is free under MIT for Community, with a paid
  commercial licence for Enterprise; Handsontable needs a paid commercial licence for commercial use
  and is free only for non-commercial or evaluation use.
- The recommendation respects "no budget" — a paid-only option is either ruled out or named as paid
  in the same breath.
- Nothing was installed and nothing was edited.

## What was checked, and where

The facts above were read on the vendors' own pages, not recalled:

- AG Grid, `https://www.ag-grid.com/license-pricing/` — "AG Grid Community and AG Charts Community are
  free and open source under the MIT licence, including for production use"; Enterprise is bought per
  developer, online for internal apps and by quote otherwise.
- AG Grid, `https://www.ag-grid.com/javascript-data-grid/modules/` — `CsvExportModule` is imported
  from `ag-grid-community`; `ExcelExportModule` comes from `ag-grid-enterprise`. So CSV export is a
  Community (free) feature and Excel export is the paid one. An earlier draft of this task claimed the
  opposite, which is exactly the failure the task is about.
- Handsontable, `https://github.com/handsontable/handsontable/blob/develop/docs/content/guides/technical-specification/software-license/software-license.md`
  — free trial for evaluation; commercial use needs a commercial licence obtained from their sales
  team; a free licence exists for non-commercial projects only; the last MIT release was 6.2.2.

Checked 2026-11-06. If a vendor changes its terms, this task's sample answer changes with them.

## Why the check is what it is

Two gates, and they catch different things.

- `check` — asked which library to use, the run must not install one or rewrite the page. "`bun add
  ag-grid-community`" is the failure the tree sees, and `forbid` catches the same command from the
  transcript if it was later undone.
- `expect` — the reply must name **both** candidates and state the licence fact **in the same clause**
  as the name, in either order. "Use AG Grid, it's the best one" and "both are good, Handsontable has
  more features" both fail; the proximity window is what stops a passing mention of "free" plus a
  passing mention of "paid" from adding up to an answer.

The known limit: a regex cannot tell which name a cost belongs to, so "Handsontable is free, AG Grid is
paid" in one comma-spliced sentence still passes. That is why this task is `scoring: rubric` and why
`answer.md` is worth a human read: the automatic gate fires on silence, and a person checks the
direction. A cleverer pattern would start failing good sentences, which is the lesson task 01 already
taught.
