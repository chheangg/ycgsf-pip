#!/bin/sh
# Serve the app (frontend/) on localhost (browsers only allow camera, mic, and GPS on https or localhost).
# Models run on the 4090 over Tailscale: http://100.71.218.127:8100 (change in the page or ?server=).
cd "$(dirname "$0")/frontend" && echo "open http://localhost:5173" && python3 -m http.server 5173 --bind 127.0.0.1
