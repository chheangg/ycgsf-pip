#!/bin/bash
# Put the model server on the RTX 4090 PC over Tailscale and restart it there.
# The restart stops every running copy of Pip first (server/restart_pip.ps1), so only the new code is on the GPU.
# Usage: tools/deploy.sh   (PIP_BOX=user@host for another machine)
set -euo pipefail
cd "$(dirname "$0")/.."
BOX="${PIP_BOX:-hackteam@100.71.218.127}"
HOST="${BOX#*@}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o LogLevel=ERROR "$BOX")

python3 -m py_compile server/app.py server/indoor_workflow.py
stamp=$(date +%Y%m%d-%H%M%S)
"${SSH[@]}" "if exist C:\\ycgsf\\server\\app.py copy /y C:\\ycgsf\\server\\app.py C:\\ycgsf\\server\\app.py.bak-$stamp >nul"
scp -q -o BatchMode=yes -o LogLevel=ERROR server/app.py server/indoor_workflow.py server/requirements.txt "$BOX:C:/ycgsf/server/"
scp -q -o BatchMode=yes -o LogLevel=ERROR server/run_pip.bat server/restart_pip.ps1 "$BOX:C:/Users/hackteam/"
"${SSH[@]}" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\hackteam\\restart_pip.ps1"

printf "waiting for the API"
for _ in $(seq 1 60); do
  curl -sf -m 3 "http://$HOST:8100/health" >/dev/null && break
  printf "."; sleep 3
done
echo
curl -sf -m 600 -X POST "http://$HOST:8100/warmup" && echo
curl -sf -m 5 "http://$HOST:8100/health" && echo
echo "deployed (old app.py kept as app.py.bak-$stamp)"
