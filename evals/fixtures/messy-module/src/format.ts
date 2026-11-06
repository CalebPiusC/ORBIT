export function formatTitleForList(title: string) {
  const trimmed = title.trim()
  if (trimmed.length > 40) return trimmed.slice(0, 37) + "..."
  return trimmed
}

export function formatTitleForHeader(title: string) {
  const trimmed = title.trim()
  if (trimmed.length > 40) return trimmed.slice(0, 37) + "..."
  return trimmed
}

export function slugify(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-")
}
