#!/bin/sh
# Builds dist/start-tab-<version>.zip for upload to the Chrome Web Store.
set -eu
cd "$(dirname "$0")/.."
version=$(python3 -c "import json; print(json.load(open('src/manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/start-tab-$version.zip"
(cd src && zip -qr "../dist/start-tab-$version.zip" . -x '.*')
echo "dist/start-tab-$version.zip"
