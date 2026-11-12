#!/usr/bin/env bash
# Install full clinical anatomy data (all 2234 parts) into public/models/
# Usage:
#   1. Download clinical-chunks-full.zip
#   2. Place it in the project root
#   3. Run: bash scripts/install-clinical-data.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/clinical-chunks-full.zip"
DEST="$ROOT/public/models"

if [[ ! -f "$ZIP" ]]; then
  echo "Missing $ZIP"
  echo "Download clinical-chunks-full.zip and place it in the project root, then re-run."
  exit 1
fi

mkdir -p "$DEST"
unzip -o "$ZIP" -d "$DEST"
echo "Installed clinical chunks into $DEST"
ls "$DEST"/c*.json | wc -l
echo "Done. Restart the dev server (npm run dev)."
