# Sets up the live worker to start by itself (ADR 0011). Run once, in the live copy, as the owner:
#
#   & <live copy>\scripts\live\install-task.ps1
#
# It registers a scheduled task that runs the worker as you when you log on, with no window, and
# starts it now, plus a second task, with no trigger, that the app's Update button runs. Running
# it again replaces both. No administrator window needed.

param(
  # Another name, only to try a second live copy alongside the real one.
  [string]$TaskName = ""
)

. "$PSScriptRoot\common.ps1"
$TaskName = Resolve-TaskName $TaskName

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

# Setting it up again shuts down the worker this live copy already runs; anything that still
# answers on the port after that is something else.
if (-not (Stop-LiveWorker $root $TaskName $settings.Port)) {
  throw "Something else answers on port $($settings.Port), most likely a worker started by hand. Shut it down first."
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$run = Join-Path $PSScriptRoot "run.ps1"
# Both scripts are told the task's name when it isn't the usual one.
$forTask = ""
if ($TaskName -ne (Resolve-TaskName "")) { $forTask = " -TaskName `"$TaskName`"" }
# conhost --headless runs it with no window at all, not even a flash at log on.
$action = New-ScheduledTaskAction -Execute "conhost.exe" -WorkingDirectory $root `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$run`"$forTask"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# As the owner, so the worker finds their Claude Code login (ADR 0003); no password is stored.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
# No time limit, on battery too, and one copy at a time. run.ps1 is what restarts the worker: Task
# Scheduler's own restart only covers the task failing to start.
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $taskSettings -Description "Courtyard's live worker (ADR 0011). Set up by $PSCommandPath." -Force | Out-Null

# The update, as its own task with no trigger: the app's Update button asks Task Scheduler to run
# it, so it carries on while the worker it updates shuts down. Its output goes to
# live-update.log in the data folder, through cmd as in run.ps1.
$updateTask = Get-UpdateTaskName $TaskName
$update = Join-Path $PSScriptRoot "update.ps1"
$updateLog = Join-Path $settings.DataDir "live-update.log"
$updateAction = New-ScheduledTaskAction -Execute "conhost.exe" -WorkingDirectory $root `
  -Argument "--headless cmd.exe /c `"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$update`"$forTask >> `"$updateLog`" 2>&1`""
$updateSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $updateTask -Action $updateAction -Principal $principal `
  -Settings $updateSettings -Description "Updates Courtyard's live copy when the app asks (ADR 0011). Set up by $PSCommandPath." -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

$log = Join-Path $settings.DataDir "worker.log"
if (Wait-Health $settings.Port -Seconds 60) {
  Write-Host "Courtyard's worker is running on port $($settings.Port), and starts by itself when you log on."
  Write-Host "Its log: $log"
} else {
  throw "The task is set up, but the worker didn't answer within a minute. See $log"
}
