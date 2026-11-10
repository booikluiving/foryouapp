#!/usr/bin/env bash
# Bouwt FYVisionMatte.plugin en FYRvmMatte.plugin met de Command Line Tools (geen Xcode nodig).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
SDK_HDR="/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP"
OUT="$HERE/build"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"

bundle() {
  local name="$1"; shift
  local dir="$OUT/$name.plugin/Contents"
  rm -rf "$OUT/$name.plugin"
  mkdir -p "$dir/MacOS"
  clang++ -std=c++17 -fobjc-arc -O2 -arch arm64 -mmacosx-version-min=14.0 -bundle \
    -I"$SDK_HDR" -I"$HERE/src" \
    "$HERE/src/MatteTOP.mm" "$@" \
    -framework Foundation -framework CoreVideo -framework Accelerate \
    -o "$dir/MacOS/$name"
  cat > "$dir/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>$name</string>
<key>CFBundleIdentifier</key><string>nl.foryouniverse.greenscreenlab.$name</string>
<key>CFBundleName</key><string>$name</string>
<key>CFBundlePackageType</key><string>BNDL</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
PLIST
  codesign --force --sign - "$OUT/$name.plugin" >/dev/null
  # een draaiend TD houdt een geladen plug-in vast: elke build ook als eigen versie, het lab kiest de nieuwste
  mkdir -p "$OUT/versies"
  cp -R "$OUT/$name.plugin" "$OUT/versies/$name-$STAMP.plugin"
  echo "gebouwd: $OUT/$name.plugin (versie $STAMP)"
}

bundle FYVisionMatte "$HERE/src/VisionEngine.mm" -framework Vision
bundle FYRvmMatte "$HERE/src/RvmEngine.mm" -framework CoreML
bundle FYKeyMatte "$HERE/src/KeyEngine.mm" "$HERE/src/VisionEngine.mm" "$HERE/src/RvmEngine.mm" -DENGINE_EMBEDDED -framework Vision -framework CoreML
bundle FYKeyCalib "$HERE/src/KeyEngine.mm" "$HERE/src/VisionEngine.mm" "$HERE/src/RvmEngine.mm" -DENGINE_EMBEDDED -DCALIB_PLUGIN -framework Vision -framework CoreML
