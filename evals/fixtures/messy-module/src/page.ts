import { formatTitleForHeader, formatTitleForList, slugify } from "./format"

export function renderPage(title: string) {
  return `<a href="/${slugify(title)}">${formatTitleForList(title)}</a><h1>${formatTitleForHeader(title)}</h1>`
}
