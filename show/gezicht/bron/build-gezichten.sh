#!/usr/bin/env bash
# Bouwt FYGezichten.plugin (TD, gezichtskaders voor de ondertitel) en het testprogramma proef-gezichten.
# Elke build is een eigen versie in ~/ForYou/voorhoofd/plugins/versies: een draaiend TD houdt een geladen plug-in vast.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
SDK_HDR="/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP"
OUT="${FY_PLUGIN_MAP:-$HOME/ForYou/voorhoofd/plugins}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FLAGS=(-std=c++17 -fobjc-arc -O2 -arch arm64 -mmacosx-version-min=14.0)
name=FYGezichten
plug="$OUT/versies/$name-$STAMP.plugin"
dir="$plug/Contents"
mkdir -p "$dir/MacOS"
clang++ "${FLAGS[@]}" -bundle -I"$SDK_HDR" "$HERE/GezichtenTOP.mm" \
  -framework Foundation -framework Vision -framework CoreVideo -o "$dir/MacOS/$name"
cat > "$dir/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>$name</string>
<key>CFBundleIdentifier</key><string>nl.foryouniverse.$name</string>
<key>CFBundleName</key><string>$name</string>
<key>CFBundlePackageType</key><string>BNDL</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
PLIST
codesign --force --sign - "$plug" >/dev/null
echo "gebouwd: $plug"
clang++ "${FLAGS[@]}" "$HERE/proef-gezichten.mm" -framework Foundation -framework Vision -framework CoreVideo \
  -framework CoreGraphics -framework ImageIO -o "$OUT/../proef-gezichten"
echo "testprogramma: $OUT/../proef-gezichten"
