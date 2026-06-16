#!/usr/bin/env bash
# Build the pure-python pdf-cmap-fix wheel into web/wheels/ so it can be served
# same-origin and installed in the browser via micropip. Run once locally; CI
# runs it before deploying to GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."

# Pinned, validated commit of pdf-cmap-fix (bundles the legacy tiblegenc tables).
# e67f309 = main with: synthesize ToUnicode for legacy fonts that ship none,
# recover Gen_-prefixed Chogyal CFF subsets (MT<byte> glyph names), and
# shape-based identification of obfuscated-name CFF faces (needs numpy, loaded
# by the worker via loadPackage).
PIN=e67f30986ba48c8215b4c45c5edd9cd7db29ad6e
OUT=web/wheels

mkdir -p "$OUT"
rm -f "$OUT"/pdf_cmap_fix-*.whl
python3 -m pip wheel "git+https://github.com/OpenPecha/pdf-cmap-fix.git@${PIN}" \
  --no-deps -w "$OUT"

echo "→ wheel built in $OUT:"
ls -1 "$OUT"
