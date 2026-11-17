// Draws the Orbit app-icon candidates from one geometry, as SVG and as PNGs at every size the
// platform needs, plus the two contact sheets used to choose between them.
//
//   cd brand/icons/options && bun add @resvg/resvg-js && bun run generate.mjs
//
// `@resvg/resvg-js` is not a repository dependency: it is only needed to re-render the PNGs.
// ImageMagick (`convert`) is needed for the contact sheets, as in brand/icons/generate.sh.
//
// None of these depicts an orbit. The brief is an app icon: simple, abstract, distinctive and
// readable at 16 px, in the spirit of the Claude and GitHub marks.

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

// A. A heavy O with one flat facet: the ring is chamfered 45 degrees at the upper right, so the
//    silhouette is a letter with a cut corner rather than a target.
function optionA(mark, tile) {
  const OUTER = 172
  const INNER = 98
  return {
    body: `
  <mask id="a-facet">
    <rect width="${CANVAS}" height="${CANVAS}" fill="#fff"/>
    <polygon points="300,0 512,0 512,212" fill="#000"/>
  </mask>
  <g mask="url(#a-facet)">
    <path fill-rule="evenodd" fill="${mark}" d="M${C - OUTER} ${C}
      A${OUTER} ${OUTER} 0 1 1 ${C + OUTER} ${C}
      A${OUTER} ${OUTER} 0 1 1 ${C - OUTER} ${C} Z
      M${C - INNER} ${C}
      A${INNER} ${INNER} 0 1 0 ${C + INNER} ${C}
      A${INNER} ${INNER} 0 1 0 ${C - INNER} ${C} Z"/>
  </g>`,
    note: "letter O with a facet",
  }
}

// B. A four-point spark with an asymmetric signature: the upper-right point is long, the opposite
//    one is short, and the concave curves keep the silhouette from reading as a plus sign.
function optionB(mark) {
  const LONG = 214
  const SHORT = 128
  const WAIST = 34
  const points = [
    [0, -SHORT], // top
    [LONG, 0], // right, long
    [0, SHORT * 0.72], // bottom, shortest
    [-SHORT * 0.86, 0], // left
  ]
  const tip = ([x, y], k = 1) => `${n(C + x * k)},${n(C + y * k)}`
  const between = (a, b, lift) => {
    // Control point pulled toward the centre makes the arms concave.
    const mx = (a[0] + b[0]) / 2
    const my = (a[1] + b[1]) / 2
    return `${n(C + mx * lift)},${n(C + my * lift)}`
  }
  const [top, right, bottom, left] = points
  return {
    body: `
  <path fill="${mark}" d="M${tip(top)}
    Q${between(top, right, WAIST / 100)} ${tip(right)}
    Q${between(right, bottom, WAIST / 100)} ${tip(bottom)}
    Q${between(bottom, left, WAIST / 100)} ${tip(left)}
    Q${between(left, top, WAIST / 100)} ${tip(top)} Z"/>`,
    note: "asymmetric spark",
  }
}

// C. A solid disc with one bold mark cut out of it: a crescent slice, like an eclipse. The green
//    is a single mass, so the shape survives even at 16 px; the white mark carries the character.
function optionC(mark, tile) {
  const R = 176
  const SLICE = 96
  return {
    body: `
  <circle cx="${C}" cy="${C}" r="${R}" fill="${mark}"/>
  <path d="M${C - 8} ${C - 128}
    A132 132 0 0 1 ${C - 8} ${C + 128}"
    fill="none" stroke="${tile}" stroke-width="${SLICE}" stroke-linecap="round"/>`,
    note: "solid disc, eclipse slice",
  }
}

// D. Two circles of different sizes, overlapping, with the intersection knocked out so the two
//    masses stay separate shapes instead of merging into a blob.
function optionD(mark) {
  const R_BIG = 148
  const R_SMALL = 84
  const [sx, sy] = polar(150, -40)
  const circle = (cx, cy, r) => `M${n(cx - r)} ${n(cy)}
    A${r} ${r} 0 1 1 ${n(cx + r)} ${n(cy)}
    A${r} ${r} 0 1 1 ${n(cx - r)} ${n(cy)} Z`
  return {
    body: `
  <path fill-rule="evenodd" fill="${mark}" d="${circle(C - 34, C + 26, R_BIG)} ${circle(sx, sy, R_SMALL)}"/>`,
    note: "two circles, knocked out",
  }
}

// E. A split tile: one solid rounded square, cut once on the diagonal. Two masses, one gesture,
//    and nothing circular in it, which is what keeps it apart from A, C and D at small sizes.
function optionE(mark, tile) {
  const SIDE = 348
  const RADIUS = 92
  const CUT = 48
  const half = SIDE / 2
  return {
    body: `
  <rect x="${n(C - half)}" y="${n(C - half)}" width="${SIDE}" height="${SIDE}" rx="${RADIUS}" fill="${mark}"/>
  <line x1="${n(C - half - 12)}" y1="${n(C + half + 12)}" x2="${n(C + half + 12)}" y2="${n(C - half - 12)}"
    stroke="${tile}" stroke-width="${CUT}"/>`,
    note: "split tile",
  }
}

const OPTIONS = [
  ["a", optionA],
  ["b", optionB],
  ["c", optionC],
  ["d", optionD],
  ["e", optionE],
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

const large = []
for (const [scheme] of [["light"], ["dark"]]) {
  for (const [key] of OPTIONS) {
    const out = new URL(`large-${key}-${scheme}.png`, tmp).pathname
    await $`convert ${new URL(`${key}/orbit-${key}-${scheme}-256.png`, root).pathname}\
      -background "#101010" -fill "#EDEDED" -font DejaVu-Sans -pointsize 20\
      -gravity south -splice 0x34 -annotate +0+8 ${`${key.toUpperCase()} ${scheme}`} ${out}`
    large.push(out)
  }
}
await $`convert ${large} -bordercolor "#101010" -border 8 +append -resize 1440x ${new URL("compare-large.png", root).pathname}`

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
