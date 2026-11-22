import { expect, test } from "bun:test"
import { pageCount, pageRange } from "../src/pages"

test("a full page counts as one page", () => {
  expect(pageCount(10, 10)).toBe(1)
})

test("a partial last page still counts", () => {
  expect(pageCount(11, 10)).toBe(2)
})

test("a page range starts on the first item of that page", () => {
  expect(pageRange(0, 10)).toBe("1-10")
})
