# Restart Pip: stop the task and EVERY running copy of Pip (run_pip.bat's restart loop, every Python API, both
# llama-servers), wait until the GPU ports are free, then start the task once. Other apps on this PC are left alone.
Stop-ScheduledTask -TaskName 'pip-server' -ErrorAction SilentlyContinue
$pip = { param($p) $p.CommandLine -like '*run_pip.bat*' -or $p.CommandLine -like '*server.app:app*' -or $p.Name -eq 'llama-server.exe' }
for ($i = 0; $i -lt 10; $i++) {
  $left = @(Get-CimInstance Win32_Process | Where-Object { & $pip $_ })
  if (-not $left) { break }
  $left | ForEach-Object { "stopping $($_.ProcessId) $($_.Name)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}
foreach ($port in 8100, 8101, 8103) {
  for ($i = 0; $i -lt 15 -and (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
}
Start-ScheduledTask -TaskName 'pip-server'
"pip restarted"
