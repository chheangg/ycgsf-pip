#!/bin/bash
# Copy Pip's trip recordings off the iPhone (plugged in by USB) into ./trips, then draw a picture of each.
# Usage: tools/pull_trip.sh
set -e
cd "$(dirname "$0")/.."
DEV=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /connected/ {print $3; exit}')
[ -z "$DEV" ] && { echo "No iPhone connected. Plug it in and unlock it."; exit 1; }
mkdir -p trips
xcrun devicectl device copy from --device "$DEV" --domain-type appDataContainer --domain-identifier com.ycgsf.pip \
  --source Documents/trips --destination trips >/dev/null
for d in trips/*/; do python3 tools/trip_report.py "$d"; done
