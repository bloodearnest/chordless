#!/bin/bash
# Run from this directory (the justfile does)
# Generate the iOS startup images (apple-touch-startup-image): iOS ignores the manifest for its
# splash screen and wants one exact-size PNG per device and orientation. Navy with the glyph
# centred, the same in light and dark (the navy is deliberate). The <link> tags go into
# ../src/index.html between the splash markers.
set -euo pipefail

OUT=../public/icons/splash
BG="#2c3e50"
mkdir -p "$OUT"
rm -f "$OUT"/*.png

# The glyph once, large; each image resizes it
GLYPH=$(mktemp --suffix=.png)
trap 'rm -f "$GLYPH"' EXIT
convert -density 600 -background none favicon-base.svg -resize 600x600 "$GLYPH"

# CSS width x height (portrait) @ device pixel ratio
DEVICES="
440x956@3 402x874@3 430x932@3 393x852@3 428x926@3 390x844@3 375x812@3 414x896@3 414x896@2
414x736@3 375x667@2 320x568@2
1032x1376@2 1024x1366@2 834x1210@2 834x1194@2 834x1112@2 820x1180@2 810x1080@2 768x1024@2 744x1133@2
"

TAGS=""
for d in $DEVICES; do
  size=${d%@*}; dpr=${d#*@}; w=${size%x*}; h=${size#*x}
  for orient in portrait landscape; do
    if [ $orient = portrait ]; then cw=$w; ch=$h; else cw=$h; ch=$w; fi
    pw=$((cw * dpr)); ph=$((ch * dpr))
    file="$OUT/${pw}x${ph}.png"
    if [ ! -f "$file" ]; then
      short=$((pw < ph ? pw : ph))
      glyph=$((short / 4))
      convert -size ${pw}x${ph} "xc:$BG" \( "$GLYPH" -resize ${glyph}x${glyph} \) -gravity center -composite -strip -colors 16 "PNG8:$file"
    fi
    TAGS+="    <link rel=\"apple-touch-startup-image\" media=\"(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orient})\" href=\"/icons/splash/${pw}x${ph}.png\" />"$'\n'
  done
done

# Swap the block between the markers in index.html
TAGS="$TAGS" perl -0pi -e '
  my $t = $ENV{TAGS};
  s{(<!-- splash:start.*?-->\n).*?(    <!-- splash:end -->)}{$1$t$2}s
' ../src/index.html

echo "Generated $(ls "$OUT" | wc -l) startup images and updated src/index.html"
