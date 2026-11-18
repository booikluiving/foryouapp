#!/usr/bin/env bash
# Bouwt FYVoorhoofd.plugin (TD) en het testprogramma proef, met de Command Line Tools.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
SDK_HDR="/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP"
OUT="$HERE/../plugins"
STAMP="$(date +%Y%m%d-%H%M%S)"
FLAGS=(-std=c++17 -fobjc-arc -O2 -arch arm64 -mmacosx-version-min=14.0)
name=FYVoorhoofd
dir="$OUT/$name.plugin/Contents"
rm -rf "$OUT/$name.plugin"
mkdir -p "$dir/MacOS"
clang++ "${FLAGS[@]}" -bundle -I"$SDK_HDR" -I"$HERE" "$HERE/GezichtTOP.mm" "$HERE/Voorhoofd.mm" \
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
codesign --force --sign - "$OUT/$name.plugin" >/dev/null
# een draaiend TD houdt een geladen plug-in vast: elke build ook als eigen versie
mkdir -p "$OUT/versies"
cp -R "$OUT/$name.plugin" "$OUT/versies/$name-$STAMP.plugin"
echo "gebouwd: $OUT/$name.plugin (versie $STAMP)"
clang++ "${FLAGS[@]}" -I"$HERE" "$HERE/proef.mm" "$HERE/Voorhoofd.mm" -framework Foundation -framework Vision \
  -framework CoreVideo -framework CoreGraphics -framework ImageIO -framework UniformTypeIdentifiers -o "$OUT/../proef"
