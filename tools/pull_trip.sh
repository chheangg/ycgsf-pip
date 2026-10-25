#!/bin/bash
# Copy a trip recording from the 4090 PC (the phone uploads each trip there, see Trip in ios/Pip/PipWebView.swift)
# into trips/ here, then write its report (tools/trip_report.py). No cable or phone needed.
# Usage: tools/pull_trip.sh            the newest trip
#        tools/pull_trip.sh list       the trips on the PC, newest first
#        tools/pull_trip.sh <trip>     that trip, e.g. 20261025-134501
# PIP_BOX=user@host for another machine, as in tools/deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
BOX="${PIP_BOX:-hackteam@100.71.218.127}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o LogLevel=ERROR "$BOX")

trips=$("${SSH[@]}" "dir /b /o-n C:\\ycgsf\\trips" | tr -d '\r')
[ -n "$trips" ] || { echo "no trips on $BOX yet"; exit 1; }
if [ "${1:-}" = list ]; then echo "$trips"; exit 0; fi
trip="${1:-$(echo "$trips" | head -1)}"
mkdir -p trips
# A trip still being recorded keeps growing: copying again replaces the old copy.
rm -rf "trips/$trip"
scp -r -q -o BatchMode=yes -o LogLevel=ERROR "$BOX:C:/ycgsf/trips/$trip" trips/
python3 tools/trip_report.py "trips/$trip"
