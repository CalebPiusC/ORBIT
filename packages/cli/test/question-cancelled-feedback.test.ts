import { describe, expect, test } from "bun:test"
import { QuestionCancelledFeedback } from "../src/run/noninteractive"

/**
 * The model reads this string when its question cannot be answered, and it used to say "continue
 * without an answer; make reasonable assumptions and state them" — which on a vague request produced a
 * rewritten project instead of a question. It has to send the model back to the user, not onward.
 */
describe("a question that cannot be asked", () => {
  test("says no changes are to be made on a guess", () => {
    expect(QuestionCancelledFeedback).toContain("Do not make changes on a guess")
  })

  test("asks for the questions to come back in the reply", () => {
    expect(QuestionCancelledFeedback).toContain("reply with the questions you would have asked")
  })

  test("still says why it happened, so the model does not retry the tool", () => {
    expect(QuestionCancelledFeedback).toContain("non-interactive")
    expect(QuestionCancelledFeedback).toContain("cancelled")
  })

  test("no longer invites assumptions", () => {
    expect(QuestionCancelledFeedback.toLowerCase()).not.toContain("reasonable assumptions")
    expect(QuestionCancelledFeedback.toLowerCase()).not.toContain("continue without an answer")
  })
})
