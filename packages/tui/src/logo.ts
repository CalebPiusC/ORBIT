// Orbit's wordmark, drawn in the block-cell alphabet the terminal renderers understand.
//
// `_` is a space on the shadow background (the filled body of a letter), `^` is an upper half block on the shadow, and
// `~` is an upper half block in the shadow colour. Everything else is drawn in the foreground colour as-is.
//
// `left` is the orbital mark and `right` the ORBIT wordmark; both are five rows tall so they can sit side by side.

export const mark = ["     ", " ▄▄▄ ", "█ ● █", " ▀▀▀ ", "     "]

export const wordmark = [
  "▄▀▀▀▄ █▀▀▀▄ █▀▀▀▄ ▀▀█▀▀ ▀▀▀▀▀",
  "█___█ █___█ █___█ __█__ __█__",
  "█___█ █▀▀▀▀ █▀▀▀▄ __█__ __█__",
  "█___█ █__█_ █___█ __█__ __█__",
  "▀▄▄▄▀ ▀▀▀▀▀ ▀▀▀▀▀ ▀▀█▀▀ __█__",
]

export const logo = {
  left: mark,
  right: wordmark,
}

// The compact mark for narrow terminals, the mini banner and the update monogram: three rows, no wordmark.
export const go = {
  left: ["     ", "     ", "     ", "     "],
  right: ["     ", ...mark.slice(1, 4)],
}
