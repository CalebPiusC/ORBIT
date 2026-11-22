import { expect, test } from "bun:test"
import { slugify, titleCase } from "../src/text.js"

test("titleCase capitalises each word", () => {
  expect(titleCase("hello world")).toBe("Hello World")
})

test("slugify lowercases and joins words", () => {
  expect(slugify("Hello World")).toBe("hello-world")
})

test("slugify collapses punctuation and spacing", () => {
  expect(slugify("  Hello,   World!  ")).toBe("hello-world")
})

test("slugify trims leading and trailing dashes", () => {
  expect(slugify("--Hello--World--")).toBe("hello-world")
})
