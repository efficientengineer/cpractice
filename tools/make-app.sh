#!/bin/zsh
# Builds "C Practice.app", which opens the tools/cpractice.command menu in Terminal, installs it into
# /Applications (Launchpad and Spotlight find it there) and puts a shortcut to it on the Desktop.
# The app points at this checkout, so re-run this after moving the repo.
# Usage: tools/make-app.sh [install-dir]   (default /Applications, or ~/Applications if not writable)
set -e
repo="${0:A:h:h}"
dest="${1:-/Applications}"
[[ -w "$dest" ]] || dest="$HOME/Applications"
mkdir -p "$dest"
app="$dest/C Practice.app"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>C Practice</string>
  <key>CFBundleDisplayName</key><string>C Practice</string>
  <key>CFBundleIdentifier</key><string>local.cpractice.launcher</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
EOF
cat > "$app/Contents/MacOS/launcher" <<EOF
#!/bin/sh
exec open -a Terminal "$repo/tools/cpractice.command"
EOF
chmod +x "$app/Contents/MacOS/launcher" "$repo/tools/cpractice.command"

tmp=$(mktemp -d)
if swift "$repo/tools/appicon.swift" "$tmp/icon.png" 2>/dev/null; then
  mkdir "$tmp/AppIcon.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$tmp/icon.png" --out "$tmp/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$tmp/icon.png" --out "$tmp/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$tmp/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"
else
  echo "Could not draw the icon (swift failed); the app will use the default icon."
fi
rm -rf "$tmp"
touch "$app"

ln -sfn "$app" "$HOME/Desktop/C Practice"
echo "Installed $app and a Desktop shortcut."
