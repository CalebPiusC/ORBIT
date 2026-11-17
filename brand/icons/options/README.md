# Orbit icon candidates

Five candidates, drawn from one geometry. **Pending: none of these is in use yet.** The repository
README carries no mark until one is chosen; `brand/icons/orbit-icon-*.{svg,png}` is the old ring and
stays where it is, unreferenced.

The old ring — concentric circle and centre dot — is retired: at 16 px it reads as a target, and the
brief is now an app icon in the spirit of the Claude and GitHub marks, not a picture of an orbit.

| | What it is | Reads at 16 px | Ownable |
| --- | --- | --- | --- |
| **A** | Heavy letter O with one 45° facet cut from the upper-right corner | Poorly: the facet is under a pixel, so it falls back to a donut | Medium |
| **B** | Four-point spark, asymmetric: the right point is the longest, the bottom the shortest | Yes, the silhouette survives | Medium — the sparkle is everywhere in AI branding |
| **C** | Solid disc with a crescent cut out of it, like an eclipse | Borderline: the cut blurs into a "G" | High |
| **D** | Big circle and small circle overlapping, intersection knocked out | Yes: two distinct masses | High |
| **E** | One rounded square, split once on the diagonal | Yes, the cleanest of the five | High |

Recommended: **E**. It is the only candidate whose idea still reads at 16 px without knowing what to
look for, it has no circular "target" risk, it contains no borrowed AI-sparkle language, and the
diagonal echoes a slash — a terminal gesture — which suits a product whose whole surface is a prompt.
**B** is the runner-up if you want a star; **D** third.

## What is in here

For each of `a/`, `b/`, `c/`, `d/`, `e/`:

- `orbit-<option>-light.svg` — dark green `#006400` mark on the light tile `#F2F4EF`
- `orbit-<option>-dark.svg` — light green `#9FE0A0` mark on the dark green tile `#006400`
- PNG renders at 16, 32, 64, 128, 256 and 512 px for both colourways

Two review sheets:

- `compare-large.png` — all ten marks (five options, both colourways) at 256 px, labelled
- `compare-small.png` — each option at 16 and 32 px, actual size beside a pixel blow-up

## Geometry

One 512×512 canvas with a 114 corner radius, matching `../generate.sh`, so every candidate sits on
the same grid. Numbers are in 512 units.

| | Shape |
| --- | --- |
| A | ring, outer radius 172, inner 98; the corner beyond the line (300, 0)–(512, 212) is masked away |
| B | four-point star on radii 128 / 214 / 92 / 110, arms pulled concave toward the centre |
| C | disc radius 176, crescent 132 radius by 96 stroke cut in the tile colour, rounded caps |
| D | circles radius 148 and 84, centres 184 apart, `fill-rule: evenodd` so the lens is a hole |
| E | rounded square 348 with radius 92, 48-wide diagonal cut in the tile colour |

The marks that knock out (C, D, E) cut in the tile colour rather than using transparency, so the PNG
renders stay correct on both tiles without needing a mask per colourway.

## Re-rendering

```bash
cd brand/icons/options
bun add @resvg/resvg-js   # only for this script; not a repository dependency
bun run generate.mjs      # icons and both contact sheets
```

`generate.mjs` needs ImageMagick (`convert`) for the sheets, the same tool `../generate.sh` uses. PNGs
are rendered from the vector at each size rather than downscaled from 512, so 16 and 32 px are as
clean as the shapes allow.
