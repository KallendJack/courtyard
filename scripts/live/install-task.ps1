# Sets up the live worker to start by itself (ADR 0011). Run once, in the live copy, as the owner:
#
#   & <live copy>\scripts\live\install-task.ps1
#
# It registers a scheduled task that runs the worker as you when you log on, with no window, and
# starts it now. Running it again replaces the task. No administrator window needed.

param(
  # Another name, only to try a second live copy alongside the real one.
  [string]$TaskName = ""
)

. "$PSScriptRoot\common.ps1"
if (-not $TaskName) { $TaskName = $DefaultTaskName }

$root = Get-LiveRoot
$settings = Read-LiveSettings $root

if ((git -C $root branch --show-current) -ne "main") {
  throw "$root isn't on main. The live copy only ever runs main."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js isn't on the PATH."
}
if (-not (Test-Path (Join-Path $root "apps\web\dist\index.html"))) {
  throw "The web app isn't built. In $root, run: pnpm install --frozen-lockfile, then pnpm build."
}

# Replacing the task stops the worker it runs; a worker that answers after that is something else.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName
  Stop-WorkerProcesses $root
  Wait-Health $settings.Port -Seconds 15 -Down | Out-Null
}
if (Test-Health $settings.Port) {
  throw "Something already answers on port $($settings.Port), most likely a worker started by hand. Stop it first."
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$run = Join-Path $PSScriptRoot "run.ps1"
# conhost --headless runs it with no window at all, not even a flash at log on.
$action = New-ScheduledTaskAction -Execute "conhost.exe" -WorkingDirectory $root `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$run`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# As the owner, so the worker finds their Claude Code login (ADR 0003); no password is stored.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
# No time limit, on battery too; run.ps1 restarts the worker itself, and the task restarts run.ps1.
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $taskSettings -Description "Courtyard's live worker (ADR 0011). Set up by $run." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$log = Join-Path $settings.DataDir "worker.log"
if (Wait-Health $settings.Port -Seconds 60) {
  Write-Host "Courtyard's worker is running on port $($settings.Port), and starts by itself when you log on."
  Write-Host "Its log: $log"
} else {
  throw "The task is set up, but the worker didn't answer within a minute. See $log"
}
