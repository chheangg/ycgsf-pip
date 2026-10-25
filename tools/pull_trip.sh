#!/bin/bash
# Copy a trip recording from the 4090 PC (the phone uploads each trip there, see Trip in ios/Pip/PipWebView.swift)
# into trips/ here, then write its report (tools/trip_report.py). No cable or phone needed.
# Usage: tools/pull_trip.sh                  the newest trip with something in it (not an empty app launch)
#        tools/pull_trip.sh list             the trips on the PC, newest first, with their size
#        tools/pull_trip.sh <trip>           that trip, e.g. 20261025-134501
#        tools/pull_trip.sh <trip> --photos  also every camera photo (slow: most of a trip's size)
# PIP_BOX=user@host for another machine, as in tools/deploy.sh.
#
# Why it copies this way (measured 2026-10-25 on a 10-minute trip, 50 MB, 395 files, over a Tailscale relay):
# scp -r took 96 s. One compressed tar stream without the photos took 2.3 s; the photos are 38 MB of JPEGs that
# don't compress, so only the ones next to each MARK are fetched.
set -euo pipefail
cd "$(dirname "$0")/.."
BOX="${PIP_BOX:-hackteam@100.71.218.127}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o LogLevel=ERROR "$BOX")
DIR="C:/ycgsf/trips"          # for tar
WINDIR='C:\ycgsf\trips'       # for cmd.exe, which reads "/" as an option

# One line per trip, newest first: name, MB, photo count (one PowerShell call, so listing stays ~1 s).
list() {
  "${SSH[@]}" "powershell -NoProfile -Command \"Get-ChildItem $DIR -Directory | Sort-Object Name -Descending | ForEach-Object { \$f = @(Get-ChildItem \$_.FullName -Recurse -File); '{0}  {1,6:N1} MB  {2,4} photos' -f \$_.Name, ((\$f | Measure-Object Length -Sum).Sum/1MB), @(\$f | Where-Object Extension -eq '.jpg').Count }\"" | tr -d '\r'
}

if [ "${1:-}" = list ]; then list; exit 0; fi
if [ -n "${1:-}" ] && [ "$1" != --photos ]; then trip="$1"; shift
else
  # An app launch that never got going leaves a near-empty trip; skip those (under 0.1 MB).
  trip=$(list | awk '$2 >= 0.1 { print $1; exit }')
  [ -n "$trip" ] || { echo "no trips with data on $BOX yet"; exit 1; }
fi
mkdir -p trips
if [ "${1:-}" = --photos ]; then
  "${SSH[@]}" "tar -czf - -C $DIR $trip" | tar -xzf - -C trips
else
  "${SSH[@]}" "tar -czf - -C $DIR --exclude photos $trip" | tar -xzf - -C trips
  # The photos taken around each MARK (what the camera saw when something went wrong)
  want=$("${SSH[@]}" "if exist $WINDIR\\$trip\\photos dir /b $WINDIR\\$trip\\photos" | tr -d '\r' | python3 tools/trip_report.py "trips/$trip" --mark-photos)
  if [ -n "$want" ]; then
    "${SSH[@]}" "tar -czf - -C $DIR $(echo "$want" | sed "s#^#$trip/photos/#" | tr '\n' ' ')" | tar -xzf - -C trips
  fi
fi
echo "copied trips/$trip"
python3 tools/trip_report.py "trips/$trip"
