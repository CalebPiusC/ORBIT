import { expect, test } from "bun:test"
import { formatTitleForHeader, formatTitleForList, slugify } from "../src/format"

test("long titles are clipped", () => {
  const title = "a".repeat(60)
  expect(formatTitleForList(title)).toBe("a".repeat(37) + "...")
  expect(formatTitleForHeader(title)).toBe("a".repeat(37) + "...")
})

test("short titles are trimmed only", () => {
  expect(formatTitleForList("  hello  ")).toBe("hello")
})

test("slugify lowercases and dashes", () => {
  expect(slugify(" Hello World ")).toBe("hello-world")
})
