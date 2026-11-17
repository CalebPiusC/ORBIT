# Orbit icon candidates

Three candidates, drawn from one geometry. **Pending: none of these is in use yet.** The repository
README carried the previous ring mark for a few hours and has been cleared until one of these is
chosen; `brand/icons/orbit-icon-*.{svg,png}` is the old ring and stays where it is, unreferenced.

| | Description | Strong at | Weak at |
| --- | --- | --- | --- |
| **A** | Solid planet, elliptical band tilted 24°, small satellite on the band's right end | 64 px and up: the only one that clearly says *orbit* | 16 px: the band thins out to a diagonal smear |
| **B** | Bold ring, no centre dot, satellite clear of the upper-right edge | 32 px and up, and it still reads at 16 px | Says *planet and moon* more than *orbit* |
| **C** | Thick letter O, small gap at the top, dot in the gap | Monogram use, 64 px and up | Under 64 px the dot merges and the O reads as a C or a keyhole |

Recommended: **B**, because the launcher and browser tab render at 16–32 px far more often than the
splash screen renders at 512 px, and B is the only candidate that survives there without redraw rules.
A is the better large mark if the brand needs the orbit reading and small sizes can be handled by a
separate simplified glyph.

## What is in here

For each of `a/`, `b/`, `c/`:

- `orbit-<option>-light.svg` — dark green `#006400` mark on the light tile `#F2F4EF`
- `orbit-<option>-dark.svg` — light green `#9FE0A0` mark on the dark green tile `#006400`
- PNG renders at 16, 32, 64, 128, 256 and 512 px for both colourways

Two review sheets:

- `compare-large.png` — all six marks at 256 px, labelled
- `compare-small.png` — each option at 16 and 32 px, actual size beside a pixel blow-up

## Geometry

One 512×512 canvas with a 114 corner radius, matching `../generate.sh`, so the candidates and the old
mark sit on the same grid. Every number below is in 512 units.

| | Ring / band | Stroke | Body | Satellite |
| --- | --- | --- | --- | --- |
| A | ellipse 196 × 66, rotated −24° | 34 | circle r 92 | r 20 at the band's 10° point, on a 32 halo |
| B | circle r 138 | 56 | none | r 48, centred 224 from the middle at −50° |
| C | circle r 118 | 90 | — | r 26, in a 44° gap centred at the top |

The satellite in B clears the ring's outer edge by 10 units, which is why it stays a separate shape
instead of fusing into a lump. The dot in C is centred in its gap with roughly 12 units of clearance
either side; below 64 px that clearance is under half a pixel, which is what the small sheet shows.

## Re-rendering

```bash
cd brand/icons/options
bun add @resvg/resvg-js   # only for this script; not a repository dependency
bun run generate.mjs      # icons and both contact sheets
```

`generate.mjs` needs ImageMagick (`convert`) for the sheets, the same tool `../generate.sh` uses. PNGs
are rendered from the vector at each size rather than downscaled from 512, so 16 and 32 px are as clean
as the shapes allow.
