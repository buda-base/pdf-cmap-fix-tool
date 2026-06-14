#!/usr/bin/env bash
# Build the pure-python pdf-cmap-fix wheel into web/wheels/ so it can be served
# same-origin and installed in the browser via micropip. Run once locally; CI
# runs it before deploying to GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."

# Pinned, validated commit of pdf-cmap-fix (bundles the legacy tiblegenc tables).
PIN=007ef5b8744d4fed8f0c5ddd2eb445b0f8a02600
OUT=web/wheels

mkdir -p "$OUT"
rm -f "$OUT"/pdf_cmap_fix-*.whl
python3 -m pip wheel "git+https://github.com/OpenPecha/pdf-cmap-fix.git@${PIN}" \
  --no-deps -w "$OUT"

echo "→ wheel built in $OUT:"
ls -1 "$OUT"
