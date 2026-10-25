@echo off
rem Pip on the 4090: two llama.cpp servers (brain Qwen3-14B :8101, see+talk Qwen2.5-VL-7B :8103) + the Pip API (:8100).
rem --cache-ram 0 on the brain: saving idle slots to RAM stalled it 4-9 s per new request (18 s replies, 2026-10-25).
rem Started by the "pip-server" scheduled task. Logs in C:\Users\hackteam\pip*.log
cd /d C:\llama
start "" /b llama-server.exe -m models\Qwen3-14B-Q4_K_M.gguf --host 127.0.0.1 --port 8101 -ngl 99 -c 12288 --jinja -fa on --cache-ram 0 >> C:\Users\hackteam\pip-brain.log 2>&1
start "" /b llama-server.exe -m models\Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf --mmproj models\mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf --host 127.0.0.1 --port 8103 -ngl 99 -c 8192 --jinja -fa on >> C:\Users\hackteam\pip-see.log 2>&1
cd /d C:\ycgsf
set PYTHONUNBUFFERED=1
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
:api
rem If the API ever exits, log it and start it again after 3 s (the model servers keep running).
C:\Users\hackteam\ycgsf-venv\Scripts\python.exe -m uvicorn server.app:app --host 0.0.0.0 --port 8100 >> C:\Users\hackteam\pip.log 2>&1
echo %date% %time% API exited with code %errorlevel%, restarting >> C:\Users\hackteam\pip.log
timeout /t 3 /nobreak >nul
goto api
