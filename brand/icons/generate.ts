// Draws every Orbit icon from the two source files.
//
// The green is written once, below. Each colourway is one of the sources with that green swapped out,
// so the drawing itself is never edited here: the two sources are the designer's files and the only
// thing this script does to them is change colour and, for the tiled variants, lay a tile behind.
//
// The small ring is used at 16 and 32 px because the ring drops out below 64 px otherwise; 64 px and
// up use the regular source.
//
//   cd brand/icons && bun install && bun run generate
//
// Needs bun and @resvg/resvg-js for the rasterising (@resvg/resvg-js implements SVG masks, which the
// drawing depends on to cut the ring's gap out of the planet), and ImageMagick (`convert`) only for
// the two review sheets.

import { Resvg } from "@resvg/resvg-js"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const GREEN = "#06402B" // the mark. The one place this colour is written.
const LIGHT = "#F2F4EF" // light tile, and the mark on the green tile
const WHITE = "#FFFFFF"
const BLACK = "#000000"

const SIZES = [16, 32, 64, 128, 256, 512]
const SMALL_MAX = 32 // sizes at or below this use source-small.svg
const CORNER = 22.27 // tile corner radius in the 100-unit viewBox: 114 in 512

const VARIANTS = [
  { slug: "green-on-light", tile: LIGHT, mark: GREEN, label: "green on the light tile" },
  { slug: "light-on-green", tile: GREEN, mark: LIGHT, label: "light on the green tile" },
  { slug: "mark-only", tile: null, mark: GREEN, label: "mark only, transparent" },
  { slug: "black-on-white", tile: WHITE, mark: BLACK, label: "black on white tile" },
  { slug: "white-on-black", tile: BLACK, mark: WHITE, label: "white on black tile" },
] as const

const here = import.meta.dir
const file = (name: string) => path.join(here, name)

const sources = {
  regular: await readFile(file("source.svg"), "utf8"),
  small: await readFile(file("source-small.svg"), "utf8"),
}

for (const [name, text] of Object.entries(sources)) {
  const count = text.split(GREEN).length - 1
  if (count !== 3) throw new Error(`${name}: expected the mark colour ${GREEN} 3 times, found ${count}`)
}

const sourceFor = (size: number) => (size <= SMALL_MAX ? sources.small : sources.regular)

// One variant at one size, as SVG text: the source, recoloured, with a tile behind it if the variant
// has one. The mark keeps its own margins; nothing is rescaled or nudged.
function paint(source: string, tile: string | null, mark: string, size: number) {
  if (!tile && mark === GREEN) {
    // The transparent variant is the source untouched apart from declaring its pixel size.
    return source.replace(/<svg\b[^>]*>/, tag(size))
  }
  const recoloured = source.replaceAll(GREEN, mark)
  const open = tag(size)
  const svg = recoloured.replace(/<svg\b[^>]*>/, open)
  if (!tile) return svg
  return svg.replace(open, `${open}\n  <rect width="100" height="100" rx="${CORNER}" fill="${tile}"/>`)
}

const tag = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Orbit">`

const raster = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size }, background: "rgba(0,0,0,0)" }).render()

// The drawing depends on an SVG mask to cut the ring's gap out of the planet. If the renderer ignored
// masks, every variant would come out as a solid disc and the gap would silently be a lighter arc
// instead of a hole. So: render the transparent variant and insist on holes inside the planet.
function assertMasksAreReal() {
  const size = 256
  const image = raster(paint(sources.regular, null, GREEN, size), size)
  const { pixels, width } = image
  let holes = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Inside the planet (centre 50,50 radius 24 in viewBox units), where the cut runs.
      const dx = (x / width) * 100 - 50
      const dy = (y / width) * 100 - 50
      if (Math.hypot(dx, dy) > 22) continue
      if (pixels[(y * width + x) * 4 + 3] === 0) holes++
    }
  }
  if (holes < 50) throw new Error(`renderer is not applying the mask: ${holes} transparent pixels in the planet`)
  return holes
}

const holes = assertMasksAreReal()

for (const variant of VARIANTS) {
  for (const size of SIZES) {
    const svg = paint(sourceFor(size), variant.tile, variant.mark, size)
    await writeFile(file(`orbit-icon-${variant.slug}-${size}.svg`), svg)
    const png = raster(svg, size).asPng()
    await writeFile(file(`orbit-icon-${variant.slug}-${size}.png`), png)
  }
}
console.log(`wrote ${VARIANTS.length * SIZES.length} svg + ${VARIANTS.length * SIZES.length} png`)

// ---- review sheets ----
const tmp = path.join(here, ".sheet")
await mkdir(tmp, { recursive: true })
const $ = Bun.$

const hasConvert = Bun.which("convert") !== null
if (!hasConvert) {
  console.log("no ImageMagick: skipped the review sheets")
} else {
  // Sheet one: every variant at the three sizes where the choice of source matters, actual pixels.
  const W = 800
  const ROW = 116
  const HEAD = 150
  const H = HEAD + ROW * VARIANTS.length + 30
  const COLUMNS = [
    { label: "16 px", size: 16, x: 360 },
    { label: "32 px", size: 32, x: 430 },
    { label: "64 px", size: 64, x: 510 },
    { label: "16 px, 6x", size: 96, x: 616 },
  ]
  await $`convert -size ${W}x${H} xc:"#2b2b2f" ${tmp}/sheet.png`
  const draw = async (args: string[]) => {
    await $`convert ${tmp}/sheet.png ${args} ${tmp}/sheet.png`
  }
  await draw(["-font", "DejaVu-Sans", "-pointsize", "26", "-fill", "#F5F5F5", "-annotate", "+28+48", "Orbit icon — actual size"])
  await draw(["-font", "DejaVu-Sans", "-pointsize", "18", "-fill", "#9a9aa3", "-annotate", "+28+82", "Five colourways. Nothing here is in use yet."])
  for (const column of COLUMNS) {
    await draw(["-font", "DejaVu-Sans", "-pointsize", "17", "-fill", "#9a9aa3", "-annotate", `+${column.x}+104`, column.label])
  }
  for (const [index, variant] of VARIANTS.entries()) {
    const top = HEAD + index * ROW
    const middle = top + ROW / 2 - 14
    await draw(["-font", "DejaVu-Sans", "-pointsize", "20", "-fill", "#D4D4D8", "-annotate", `+28+${middle + 6}`, variant.label])
    await $`convert ${file(`orbit-icon-${variant.slug}-16.png`)} -filter point -resize 600% ${tmp}/zoom-${variant.slug}.png`
    for (const column of COLUMNS) {
      const png =
        column.size === 96 ? `${tmp}/zoom-${variant.slug}.png` : file(`orbit-icon-${variant.slug}-${column.size}.png`)
      const y = middle - Math.round(column.size / 2)
      await draw([png, "-geometry", `+${column.x}+${y}`, "-composite"])
    }
  }
  await $`cp ${tmp}/sheet.png ${file("icons-actual-size.png")}`

  // Sheet two: one row at 256 px, big enough to look at.
  const tile = 256
  const gap = 28
  const margin = 32
  const width = margin * 2 + VARIANTS.length * tile + (VARIANTS.length - 1) * gap
  const height = tile + 88
  await $`convert -size ${width}x${height} xc:"#111113" ${tmp}/preview.png`
  for (const [index, variant] of VARIANTS.entries()) {
    const x = margin + index * (tile + gap)
    await $`convert ${tmp}/preview.png ${file(`orbit-icon-${variant.slug}-256.png`)} -geometry +${x}+24 -composite ${tmp}/preview.png`
    await $`convert ${tmp}/preview.png -font DejaVu-Sans -pointsize 19 -fill "#B9B9C0" -annotate +${x}+${tile + 56} ${variant.label} ${tmp}/preview.png`
  }
  await $`cp ${tmp}/preview.png ${file("icons-256.png")}`
  await rm(tmp, { recursive: true, force: true })
  console.log("wrote icons-actual-size.png, icons-256.png")
}

console.log(`mask check: ${holes} transparent pixels inside the planet, so the cut is a real hole`)
