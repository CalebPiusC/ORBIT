// Draws the three Orbit icon candidates from one geometry, as SVG and as PNGs at every size the
// platform needs, plus the two contact sheets used to choose between them.
//
//   cd brand/icons/options && bun add @resvg/resvg-js && bun run generate.mjs
//
// `@resvg/resvg-js` is not a repository dependency: it is only needed to re-render the PNGs.
// ImageMagick (`convert`) is needed for the contact sheets, as in brand/icons/generate.sh.

import { Resvg } from "@resvg/resvg-js"
import { mkdir, writeFile } from "node:fs/promises"
import { $ } from "bun"

const TILE_LIGHT = "#F2F4EF" // tile behind the dark green mark
const MARK_ON_LIGHT = "#006400"
const TILE_DARK = "#006400"
const MARK_ON_DARK = "#9FE0A0" // mark on the dark green tile
const SIZES = [16, 32, 64, 128, 256, 512]
const CANVAS = 512
const C = CANVAS / 2

const rad = (deg) => (deg * Math.PI) / 180
const n = (v) => Number(v.toFixed(2))
const polar = (r, deg) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))]

function ellipsePoint(rx, ry, deg, tilt) {
  const x = rx * Math.cos(rad(deg))
  const y = ry * Math.sin(rad(deg))
  const t = rad(tilt)
  return [C + x * Math.cos(t) - y * Math.sin(t), C + x * Math.sin(t) + y * Math.cos(t)]
}

// A. A solid planet inside an elliptical band tilted 24 degrees, with one small satellite riding
//    the band at its right end. The band passes behind the planet; the satellite carries a tile
//    halo so it reads as a body on the band, not a lump on it.
function optionA(mark, tile) {
  const RX = 196
  const RY = 66
  const BAND = 34
  const PLANET = 92
  const SATELLITE = 20
  const HALO = 32
  const TILT = -24
  const [sx, sy] = ellipsePoint(RX, RY, 10, TILT)
  return {
    body: `
  <g transform="rotate(${TILT} ${C} ${C})">
    <ellipse cx="${C}" cy="${C}" rx="${RX}" ry="${RY}" fill="none" stroke="${mark}" stroke-width="${BAND}"/>
  </g>
  <circle cx="${C}" cy="${C}" r="${PLANET}" fill="${mark}"/>
  <circle cx="${n(sx)}" cy="${n(sy)}" r="${HALO}" fill="${tile}"/>
  <circle cx="${n(sx)}" cy="${n(sy)}" r="${SATELLITE}" fill="${mark}"/>`,
    note: "planet, tilted band, satellite",
  }
}

// B. One bold ring with no centre dot and a satellite clear of its upper-right edge. Sized to
//    survive 16 px: ring stroke 56/512 and satellite 48/512 both stay above 2 px when downscaled.
function optionB(mark) {
  const RING = 138
  const STROKE = 56
  const SAT = 48
  const DIST = 224
  const [sx, sy] = polar(DIST, -50)
  return {
    body: `
  <circle cx="${C}" cy="${C}" r="${RING}" fill="none" stroke="${mark}" stroke-width="${STROKE}"/>
  <circle cx="${n(sx)}" cy="${n(sy)}" r="${SAT}" fill="${mark}"/>`,
    note: "bold ring, edge satellite",
  }
}

// C. A thick letter O with a small gap at the top and a dot sitting in the gap.
function optionC(mark) {
  const R = 118
  const STROKE = 90
  const GAP = 44
  const DOT = 26
  const CENTRE = -90
  const start = CENTRE + GAP / 2
  const end = CENTRE - GAP / 2 + 360
  const [x1, y1] = polar(R, start)
  const [x2, y2] = polar(R, end)
  const [dx, dy] = polar(R, CENTRE)
  return {
    body: `
  <path d="M${n(x1)} ${n(y1)} A${R} ${R} 0 ${360 - GAP > 180 ? 1 : 0} 1 ${n(x2)} ${n(y2)}" fill="none" stroke="${mark}" stroke-width="${STROKE}" stroke-linecap="butt"/>
  <circle cx="${n(dx)}" cy="${n(dy)}" r="${DOT}" fill="${mark}"/>`,
    note: "letter O, gap and dot",
  }
}

const OPTIONS = [
  ["a", optionA],
  ["b", optionB],
  ["c", optionC],
]

const svg = (body, tile, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="${title}">
  <title>${title}</title>
  <rect width="${CANVAS}" height="${CANVAS}" rx="114" fill="${tile}"/>
${body}
</svg>
`

const root = new URL("./", import.meta.url)

for (const [key, draw] of OPTIONS) {
  await mkdir(new URL(`${key}/`, root), { recursive: true })
  for (const [scheme, tile, mark] of [
    ["light", TILE_LIGHT, MARK_ON_LIGHT],
    ["dark", TILE_DARK, MARK_ON_DARK],
  ]) {
    const option = draw(mark, tile)
    const title = `Orbit icon ${key.toUpperCase()} (${scheme}) - ${option.note}`
    const source = svg(option.body, tile, title)
    await writeFile(new URL(`${key}/orbit-${key}-${scheme}.svg`, root), source)
    for (const size of SIZES) {
      const png = new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng()
      await writeFile(new URL(`${key}/orbit-${key}-${scheme}-${size}.png`, root), png)
    }
  }
  console.log(`${key}: svg + ${SIZES.length * 2} png`)
}

// ---- contact sheets ----
const tmp = new URL("./.sheet/", root)
await mkdir(tmp, { recursive: true })

// Large: three options across, light then dark, 256 px, labelled.
const large = []
for (const [scheme] of [["light"], ["dark"]]) {
  for (const [key] of OPTIONS) {
    const label = `${key.toUpperCase()} ${scheme}`
    const out = new URL(`large-${key}-${scheme}.png`, tmp).pathname
    await $`convert ${new URL(`${key}/orbit-${key}-${scheme}-256.png`, root).pathname}\
      -background "#101010" -fill "#EDEDED" -font DejaVu-Sans -pointsize 20\
      -gravity south -splice 0x34 -annotate +0+8 ${label} ${out}`
    large.push(out)
  }
}
await $`convert ${large} -bordercolor "#101010" -border 8 +append -resize 1200x ${new URL("compare-large.png", root).pathname}`

// Small: 16 and 32 px at actual size next to an 8x pixel blow-up of each, per option.
const small = []
for (const [key] of OPTIONS) {
  const row = []
  for (const size of [16, 32]) {
    const actual = new URL(`${key}/orbit-${key}-light-${size}.png`, root).pathname
    const zoom = new URL(`zoom-${key}-${size}.png`, tmp).pathname
    await $`convert ${actual} -filter point -resize ${size === 16 ? "800%" : "400%"} ${zoom}`
    row.push(actual, zoom)
  }
  const out = new URL(`small-${key}.png`, tmp).pathname
  await $`convert ${row} -background "#101010" -splice 12x0 +append -background "#101010" -gravity west\
    -fill "#EDEDED" -font DejaVu-Sans -pointsize 20 -splice 80x0 -annotate +14+0 ${key.toUpperCase()} ${out}`
  small.push(out)
}
await $`convert ${small} -append -bordercolor "#101010" -border 12 ${new URL("compare-small.png", root).pathname}`

await $`rm -rf ${tmp.pathname}`
console.log("compare-large.png, compare-small.png")
