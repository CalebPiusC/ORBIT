#!/usr/bin/env bash
# Draws the Orbit mark and every icon size from one geometry, so the SVGs and the PNGs cannot drift.
# Needs ImageMagick 6 (`convert`). Run from the repository root:  bash brand/icons/generate.sh
set -euo pipefail

cd "$(dirname "$0")"

DARK="#006400"        # brand green: the icon and brand moments only
LIGHT_TILE="#F2F4EF"  # tile behind the dark green mark
LIGHT_MARK="#9FE0A0"  # mark on the dark green tile
SIZES=(16 32 64 128 256 512)

# 512-viewBox geometry, drawn at 4x and downsampled so edges stay clean at 16 px.
# Tile 512x512, corner 114. Ring centreline radius 138, stroke 52 (so the ring spans 112..164).
# Dot radius 54.
M=4
W=$((512 * M))
R_TILE=$((114 * M))
R_RING=$((138 * M))
R_DOT=$((54 * M))
SW=$((52 * M))
CX=$((256 * M))
CY=$((256 * M))

tile() { # $1 output  $2 tile colour  $3 mark colour
  convert -size "${W}x${W}" xc:none \
    -fill "$2" -draw "roundrectangle 0,0,$((W - 1)),$((W - 1)),$R_TILE,$R_TILE" \
    -fill none -stroke "$3" -strokewidth "$SW" \
    -draw "circle $CX,$CY $CX,$((CY - R_RING))" \
    -fill "$3" -stroke none \
    -draw "circle $CX,$CY $CX,$((CY - R_DOT))" \
    -filter Lanczos -resize 512x512 \
    "$1"
}

mark() { # mark only, on transparent
  convert -size "${W}x${W}" xc:none \
    -fill none -stroke "$1" -strokewidth "$SW" \
    -draw "circle $CX,$CY $CX,$((CY - R_RING))" \
    -fill "$1" -stroke none \
    -draw "circle $CX,$CY $CX,$((CY - R_DOT))" \
    -filter Lanczos -resize 512x512 \
    "$2"
}

tile /tmp/orbit-light-512.png "$LIGHT_TILE" "$DARK"
tile /tmp/orbit-dark-512.png "$DARK" "$LIGHT_MARK"
mark "$DARK" /tmp/orbit-mark-512.png

for size in "${SIZES[@]}"; do
  convert /tmp/orbit-light-512.png -filter Lanczos -resize "${size}x${size}" -depth 8 -strip "orbit-icon-light-${size}.png"
  convert /tmp/orbit-dark-512.png -filter Lanczos -resize "${size}x${size}" -depth 8 -strip "orbit-icon-dark-${size}.png"
done
convert /tmp/orbit-mark-512.png -filter Lanczos -resize 512x512 -depth 8 -strip "orbit-mark.png"

# ---- SVG: the same numbers, as text ----
read -r -d '' LIGHT_SVG <<'SVG' || true
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Orbit">
  <title>Orbit</title>
  <rect width="512" height="512" rx="114" fill="#F2F4EF"/>
  <circle cx="256" cy="256" r="138" fill="none" stroke="#006400" stroke-width="52"/>
  <circle cx="256" cy="256" r="54" fill="#006400"/>
</svg>
SVG
printf '%s\n' "$LIGHT_SVG" > orbit-icon-light.svg

read -r -d '' DARK_SVG <<'SVG' || true
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Orbit">
  <title>Orbit</title>
  <rect width="512" height="512" rx="114" fill="#006400"/>
  <circle cx="256" cy="256" r="138" fill="none" stroke="#9FE0A0" stroke-width="52"/>
  <circle cx="256" cy="256" r="54" fill="#9FE0A0"/>
</svg>
SVG
printf '%s\n' "$DARK_SVG" > orbit-icon-dark.svg

read -r -d '' MARK_SVG <<'SVG' || true
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Orbit">
  <title>Orbit</title>
  <circle cx="256" cy="256" r="138" fill="none" stroke="#006400" stroke-width="52"/>
  <circle cx="256" cy="256" r="54" fill="#006400"/>
</svg>
SVG
printf '%s\n' "$MARK_SVG" > orbit-mark.svg

# ---- preview sheet: both variants down the size ladder, on the working screen's dark background ----
PW=1400; PH=1440
convert -size ${PW}x${PH} xc:'#111113' /tmp/pv.png
label() { convert /tmp/pv.png -font DejaVu-Sans -fill "$1" -pointsize "$2" -annotate "$3" "$4" /tmp/pv.png; }
cap()   { convert /tmp/pv.png -font DejaVu-Sans-Mono -fill '#6b6b73' -pointsize 18 -annotate "$1" "$2" /tmp/pv.png; }
label '#f5f5f5' 40 '+70+86'  'Orbit mark — icon variants'
label '#8a8a93' 22 '+70+126' "A: ${DARK} on ${LIGHT_TILE}     B: ${LIGHT_MARK} on ${DARK}     512 / 256 / 128 / 64 / 32 / 16 px"

row() { # $1=stem  $2=label  $3=top
  local y=$3
  label '#d4d4d8' 26 "+70+$((y - 22))" "$2"
  convert /tmp/pv.png "$1-512.png" -geometry +70+${y}   -composite /tmp/pv.png
  convert /tmp/pv.png "$1-256.png" -geometry +650+${y}  -composite /tmp/pv.png
  convert /tmp/pv.png "$1-128.png" -geometry +946+${y}  -composite /tmp/pv.png
  convert /tmp/pv.png "$1-64.png"  -geometry +1114+${y} -composite /tmp/pv.png
  convert /tmp/pv.png "$1-32.png"  -geometry +1218+${y} -composite /tmp/pv.png
  convert /tmp/pv.png "$1-16.png"  -geometry +1290+${y} -composite /tmp/pv.png
  cap "+70+$((y + 540))" '512'
  cap "+650+$((y + 284))" '256'
  cap "+946+$((y + 156))" '128'
  cap "+1114+$((y + 92))" '64'
  cap "+1218+$((y + 60))" '32'
  cap "+1290+$((y + 44))" '16'
  convert "$1-16.png" -filter point -resize 224x224 /tmp/zoom.png
  convert /tmp/pv.png /tmp/zoom.png -geometry +650+$((y + 330)) -composite /tmp/pv.png
  cap "+900+$((y + 380))" '16 px, zoomed 14x'
}

row orbit-icon-light 'A — dark green mark on a light tile' 180
row orbit-icon-dark  'B — lighter green mark on the dark green tile' 812
convert /tmp/pv.png -depth 8 -strip orbit-icon-preview.png

echo "wrote $(ls orbit-icon-*.png orbit-mark.png orbit-*.svg | wc -l) files"
