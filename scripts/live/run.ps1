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
# Past this size the log starts again when the worker next starts, keeping the previous one as
# worker.log.old. (While the worker runs, it has the log open.)
$maxLogBytes = 5MB

Set-Location $root
while ($true) {
  $started = Get-Date
  # Nothing here may end the loop: it's the only thing that brings the worker back.
  try {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt $maxLogBytes) {
      Move-Item -Force $log "$log.old"
    }
    Add-LogLine $log "[$(Get-Date -Format s)] Starting the worker"
  } catch {
    # The log is busy (open in an editor, say); the worker still starts, writing where it can.
  }
  # Through cmd, so node's own UTF-8 output lands in the log unchanged.
  cmd.exe /c "node --env-file=`"$envFile`" `"$entry`" >> `"$log`" 2>&1"
  $code = $LASTEXITCODE
  # Straight back after a crash; slower when it can't even start (bad settings, say), so the log
  # doesn't fill with the same failure.
  $wait = 5
  if (((Get-Date) - $started).TotalSeconds -lt 30) { $wait = 30 }
  try {
    Add-LogLine $log "[$(Get-Date -Format s)] The worker stopped (exit code $code). Starting it again in $wait seconds."
  } catch {
  }
  Start-Sleep -Seconds $wait
}
