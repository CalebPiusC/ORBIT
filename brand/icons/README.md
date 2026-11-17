# Orbit icon

The icon is chosen: a planet with a ring, green `#06402B`. It is **not wired into anything yet** — no
README mark, no window, no banner. Those wait for a separate decision.

## Sources

`source.svg` and `source-small.svg` are the drawing as it was handed over. **Do not edit them** — not to
retrace, simplify or tidy. They differ in one way only: the small version has a heavier ring
(stroke 11 against 7, and a wider cut at 20 against 14) so the gap survives 16 and 32 px. Sizes at or
below 32 px use `source-small.svg`; 64 px and up use `source.svg`.

Both files depend on an SVG **mask** (`<mask id="cut">`) to cut the ring's gap out of the planet. A
renderer that ignores masks produces a solid disc, so the generator refuses to run quietly: it renders
the transparent variant, counts the fully transparent pixels inside the planet, and fails if there are
none. Today that count is 1340 at 256 px.

## Deriving icons

```bash
cd brand/icons
bun install
bun run generate
```

`generate.ts` holds every colour in one place:

| | |
| --- | --- |
| `GREEN` | `#06402B` — the mark. Written once, in the generator. |
| `LIGHT` | `#F2F4EF` — the light tile, and the mark on the green tile |
| `WHITE` / `BLACK` | the mono pair |

Each colourway is one of the two sources with `GREEN` **substituted**, which is why the sources
themselves stay untouched: only the colour changes, never the geometry. Tile corners are 22.27 in the
100-unit viewBox — the same 114-in-512 the older marks used — and are laid *behind* the mark, so the
mask's cut stays a hole and shows whatever is behind it: the tile when there is one, transparency when
there is not. The mark's own margins are the drawing's; nothing is rescaled or nudged.

Rasterising is `@resvg/resvg-js`, which implements masks. The two review sheets additionally need
ImageMagick (`convert`); without it the icons are still written and the sheets are skipped.

## Outputs

Five colourways × six sizes, each as SVG and PNG (10 files each, name `orbit-icon-<colourway>-<size>.<ext>`):

| Colourway | Tile | Mark |
| --- | --- | --- |
| `green-on-light` | `#F2F4EF` | `#06402B` |
| `light-on-green` | `#06402B` | `#F2F4EF` |
| `mark-only` | none — transparent | `#06402B` |
| `black-on-white` | `#FFFFFF` | `#000000` |
| `white-on-black` | `#000000` | `#FFFFFF` |

Sizes: 16, 32, 64, 128, 256, 512. The SVG for each size declares that pixel size, so `-16.svg` is the
small-ring geometry at 16 px and `-64.svg` is the regular one.

Two sheets, for review only:

- `icons-actual-size.png` — all five colourways at 16, 32 and 64 px, actual pixels, plus a 6× blow-up of
  each 16 px render
- `icons-256.png` — the same five at 256 px, side by side

## Placeholders — not in use, not to be referenced

Nothing in these two directories is the icon. They are kept only so the history is readable, and no
README, window, banner, favicon or installer should point at them.

- **`placeholders/`** — the earlier generated marks: the ring-and-dot icon (`orbit-icon-light-*`,
  `orbit-icon-dark-*`, `orbit-mark.*`, `orbit-icon-preview.png`) and the ImageMagick script that drew
  them (`placeholders/generate.sh`). Superseded, and the ring read as a generic target at small sizes.
- **`options/`** — the five candidates from the previous round (A letter O with a facet, B spark,
  C eclipse disc, D two circles, E split tile) with their own generator and sheets. Rejected; the
  decision went to the planet.
