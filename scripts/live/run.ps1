# Runs the live worker and starts it again whenever it stops (ADR 0011). The scheduled task that
# install-task.ps1 registers runs this at log on, with no window; its output goes to worker.log
# in the data folder.

. "$PSScriptRoot\common.ps1"

$root = Get-LiveRoot
$settings = Read-LiveSettings $root
New-Item -ItemType Directory -Force -Path $settings.DataDir | Out-Null
$log = Join-Path $settings.DataDir "worker.log"
$entry = Get-WorkerEntry $root
$envFile = Join-Path $root ".env"
# Past this size the log starts again, keeping the previous one as worker.log.old.
$maxLogBytes = 5MB

Set-Location $root
while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt $maxLogBytes) {
    Move-Item -Force $log "$log.old"
  }
  $started = Get-Date
  Add-Line $log "[$(Get-Date -Format s)] Starting the worker"
  # Through cmd, so node's own UTF-8 output lands in the log unchanged.
  cmd.exe /c "node --env-file=`"$envFile`" `"$entry`" >> `"$log`" 2>&1"
  $code = $LASTEXITCODE
  # Straight back after a crash; slower when it can't even start (bad settings, say), so the log
  # doesn't fill with the same failure.
  $wait = 5
  if (((Get-Date) - $started).TotalSeconds -lt 30) { $wait = 30 }
  Add-Line $log "[$(Get-Date -Format s)] The worker stopped (exit code $code). Starting it again in $wait seconds."
  Start-Sleep -Seconds $wait
}
