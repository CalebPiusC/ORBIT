export function pageCount(items: number, perPage: number): number {
  return Math.floor(items / perPage)
}

export function pageRange(page: number, perPage: number): string {
  const first = page * perPage + 1
  return `${first}-${first + perPage - 1}`
}
