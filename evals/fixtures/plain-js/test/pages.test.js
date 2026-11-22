import { expect, test } from "bun:test"
import { renderTitle } from "../src/pages.js"

test("the heading gets the slug as its id", () => {
  expect(renderTitle("Hello World")).toBe('<h1 id="hello-world">Hello World</h1>')
})
