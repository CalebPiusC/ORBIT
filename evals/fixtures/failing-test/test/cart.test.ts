import { expect, test } from "bun:test"
import { formatTotal, total } from "../src/cart"

const items = [
  { name: "pen", price: 2, quantity: 3 },
  { name: "pad", price: 5, quantity: 1 },
]

test("adds prices and quantities", () => {
  expect(total(items)).toBe(11)
})

test("formats the total as dollars", () => {
  expect(formatTotal(items)).toBe("$11")
})
