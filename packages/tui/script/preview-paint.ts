// Paints a captured frame — the spans that `app.captureSpans()` hands back — to a PNG.
//
// Spans carry text, foreground, background, a bold bit and a column width, so the whole frame becomes
// one SVG of <rect> and <text> runs which resvg rasterises. Monospace means a column is a fixed
// advance, so text lands exactly where the terminal put it and the PNG is a faithful copy of the
// screen rather than a re-render of the component tree.

import { Resvg } from "@resvg/resvg-js"

export interface Span {
  text: string
  fg: RGBA
  bg: RGBA
  attributes: number
  width: number
}

export interface Frame {
  cols: number
  rows: number
  lines: Array<{ spans: Span[] }>
}

type RGBA = { buffer?: Record<string, number>; r?: number; g?: number; b?: number; a?: number }

const ADVANCE = 0.6023 // DejaVu Sans Mono advance width per unit of font size
const LEADING = 1.32

function rgb(value: RGBA | undefined) {
  if (!value) return undefined
  const b = value.buffer
  if (b) return { r: b["0"] ?? 0, g: b["1"] ?? 0, b: b["2"] ?? 0, a: b["3"] ?? 255 }
  return { r: value.r ?? 0, g: value.g ?? 0, b: value.b ?? 0, a: value.a ?? 255 }
}

const hex = (c: { r: number; g: number; b: number }) =>
  "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function toSvg(frame: Frame, options: { size?: number; pad?: number; background?: string } = {}) {
  const size = options.size ?? 15
  const pad = options.pad ?? 20
  const background = options.background ?? "#0a0a0b"
  const cw = size * ADVANCE
  const lh = size * LEADING
  const width = Math.ceil(cw * frame.cols + pad * 2)
  const height = Math.ceil(lh * frame.rows + pad * 2)

  const body: string[] = [
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    `<g font-family="DejaVu Sans Mono" font-size="${size}" xml:space="preserve">`,
  ]

  frame.lines.forEach((line, row) => {
    let col = 0
    const y = pad + row * lh + size
    for (const span of line.spans) {
      const width = span.width || span.text.length
      const bg = rgb(span.bg)
      const fg = rgb(span.fg)
      if (bg && !(bg.r === 10 && bg.g === 10 && bg.b === 11)) {
        body.push(
          `<rect x="${(pad + col * cw).toFixed(2)}" y="${(pad + row * lh).toFixed(2)}" ` +
            `width="${(width * cw).toFixed(2)}" height="${lh.toFixed(2)}" fill="${hex(bg)}"/>`,
        )
      }
      if (span.text.trim() && fg) {
        body.push(
          `<text x="${(pad + col * cw).toFixed(2)}" y="${y.toFixed(2)}" fill="${hex(fg)}"` +
            `${span.attributes & 1 ? ' font-weight="700"' : ""}>${escape(span.text)}</text>`,
        )
      }
      col += width
    }
  })

  body.push("</g>")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body.join("")}</svg>`
}

export async function paint(frame: Frame, out: string, options: { size?: number } = {}) {
  const svg = toSvg(frame, options)
  const image = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans Mono" },
  })
    .render()
    .asPng()
  await Bun.write(out, image)
  return out
}

// Paint frames handed to us on the command line: `bun run script/preview-paint.ts a.frame.json ...`
if (import.meta.main) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error("usage: bun run script/preview-paint.ts <frame.json>...")
    process.exit(1)
  }
  for (const file of files) {
    const frame = JSON.parse(await Bun.file(file).text()) as Frame
    const out = file.replace(/\.frame\.json$|\.json$/, ".png")
    await paint(frame, out)
    console.log(`painted ${out}`)
  }
}
