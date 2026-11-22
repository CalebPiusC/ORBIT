import { titleCase } from "./text.js"

export function renderTitle(title) {
  return `<h1>${titleCase(title)}</h1>`
}
