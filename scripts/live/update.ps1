# Updates the live worker to the newest main (ADR 0011). Run it from the live copy when you choose:
#
#   & <live copy>\scripts\live\update.ps1
#
# It refuses when the live copy has changes of its own, isn't on main, or main's newest commit
# isn't passing CI. Otherwise it shuts the worker down, pulls main, installs the locked package
# versions and builds, then starts the worker and waits for it to answer. If any step fails, it
# puts the previous version back and starts that instead. It never asks anything, so it can run
# with no window, and it records how it went in live-update.json in the data folder: "running"
# while it runs, then "updated", "unchanged", "refused" or "failed".

param(
  # The task install-task.ps1 registered, if it was given another name.
  [string]$TaskName = "",
  # Skips checking main's CI result, for a live copy whose remote isn't on GitHub.
  [switch]$SkipCiCheck
)

. "$PSScriptRoot\common.ps1"
$TaskName = Resolve-TaskName $TaskName

$root = Get-LiveRoot
$settings = Read-LiveSettings $root
New-Item -ItemType Directory -Force -Path $settings.DataDir | Out-Null
$resultFile = Join-Path $settings.DataDir "live-update.json"
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
# Set once the worker is shut down, so a failure from then on puts the previous version back.
$workerDown = $false

# Runs git in the live copy and returns what it prints, read as UTF-8 so commit titles in any
# language come through. Whether it worked is in $LASTEXITCODE: its messages are dropped, because
# Windows PowerShell turns them into errors when output is captured.
function Invoke-Git {
  $ErrorActionPreference = "Continue"
  $encoding = [Console]::OutputEncoding
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  try { & git -C $root @args 2>$null } finally { [Console]::OutputEncoding = $encoding }
}

# Runs a command through cmd, saying what failed if it did. cmd joins its messages to its output,
# so PowerShell never sees them as errors, and it all goes to the screen: left in the function's
# output it would be returned as if it were the problem.
function Invoke-Step([string]$What, [string]$Command) {
  cmd.exe /c "$Command 2>&1" | Out-Host
  if ($LASTEXITCODE -ne 0) { return "$What failed (exit code $LASTEXITCODE)." }
  return $null
}

# A version: its full commit, and how people read it (the short commit and its first line).
function Get-Version([string]$Commit) {
  return [ordered]@{
    commit = Invoke-Git rev-parse $Commit
    title  = Invoke-Git log -1 --format="%h %s" $Commit
  }
}

function Write-Result([string]$Outcome, [string]$Message) {
  $result = [ordered]@{
    outcome    = $Outcome
    from       = Get-Version $from
    to         = Get-Version $to
    message    = $Message
    startedAt  = $startedAt
    finishedAt = $(if ($Outcome -eq "running") { $null } else { (Get-Date).ToUniversalTime().ToString("o") })
  }
  $temporary = "$resultFile.tmp"
  [IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  Move-Item -Force $temporary $resultFile
}

# Records how the update went, for the owner and for the app (#35), and ends the script.
function Complete-Update([string]$Outcome, [string]$Message) {
  Write-Result $Outcome $Message
  Write-Host $Message
  Pop-Location
  # Run from an open PowerShell window, the script ends but the window doesn't, so the lock is
  # let go of here rather than when the process ends.
  $script:lock.Dispose()
  if ($Outcome -eq "updated" -or $Outcome -eq "unchanged") { exit 0 }
  exit 1
}

# Installs the locked package versions and builds the version that's checked out.
function Install-AndBuild {
  $problem = Invoke-Step "Installing packages" "pnpm install --frozen-lockfile"
  if (-not $problem) { $problem = Invoke-Step "Building" "pnpm build" }
  return $problem
}

# Shuts the worker down. Installing over a running worker can fail on Windows, which keeps files
# in use locked, so every update does this first.
function Stop-Worker {
  $script:workerDown = $true
  return (Stop-LiveWorker $root $TaskName $settings.Port)
}

function Start-Worker {
  Start-ScheduledTask -TaskName $TaskName
  return (Wait-Health $settings.Port -Seconds 90)
}

# Puts the version that was running back, and starts it. Says how that went.
function Restore-Previous {
  Stop-Worker | Out-Null
  Invoke-Git reset --hard --quiet $from | Out-Null
  $problem = Install-AndBuild
  # Started whatever happened: a worker that half works beats one that's off.
  $answered = Start-Worker
  $was = (Get-Version $from).title
  if ($problem) { return "Putting back $was failed too: $problem Run pnpm install and pnpm build in $root." }
  if (-not $answered) { return "$was was put back, but the worker didn't answer. See worker.log in the data folder." }
  return "$was is still running."
}

# Refuses unless every CI check on this commit has passed.
function Assert-CiPassed([string]$Commit) {
  $remote = Invoke-Git remote get-url origin
  $onGitHub = "$remote" -match 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$'
  if (-not $onGitHub) {
    Complete-Update "refused" "The live copy's remote isn't on GitHub, so main's CI can't be checked. Run with -SkipCiCheck to update anyway."
  }
  $repository = "$($Matches[1])/$($Matches[2])"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/commits/$Commit/check-runs?per_page=100" `
      -Headers @{ "User-Agent" = "courtyard-live-update"; Accept = "application/vnd.github+json" }
  } catch {
    Complete-Update "refused" "Couldn't ask GitHub whether main is passing CI: $($_.Exception.Message)"
  }
  if ($runs.total_count -eq 0) {
    Complete-Update "refused" "Main's newest commit has no CI result yet. Try again in a few minutes."
  }
  if (@($runs.check_runs | Where-Object { $_.status -ne "completed" }).Count -gt 0) {
    Complete-Update "refused" "CI is still running on main's newest commit. Try again in a few minutes."
  }
  $failed = @($runs.check_runs | Where-Object { @("success", "skipped", "neutral") -notcontains $_.conclusion })
  if ($failed.Count -gt 0) {
    Complete-Update "refused" "Main's newest commit is failing CI ($(($failed | ForEach-Object { $_.name }) -join ', ')), so the live app stays as it is."
  }
}

# One update at a time: the lock is held until Complete-Update lets it go.
try {
  $lock = [IO.File]::Open((Join-Path $settings.DataDir "live-update.lock"), "OpenOrCreate", "ReadWrite", "None")
} catch {
  Write-Host "Another update is running. Wait for it to finish."
  exit 1
}

# pnpm and git run in the live copy; the caller's shell is put back where it was at the end.
Push-Location $root
$from = Invoke-Git rev-parse HEAD
$to = $from

try {
  if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Complete-Update "refused" "There's no '$TaskName' task. Run install-task.ps1 first."
  }
  if ((Invoke-Git branch --show-current) -ne "main") {
    Complete-Update "refused" "$root isn't on main. The live copy only ever runs main."
  }
  if (Invoke-Git status --porcelain) {
    Complete-Update "refused" "$root has changes of its own. The live copy only ever runs main as it is on GitHub."
  }
  Invoke-Git fetch --quiet origin main | Out-Null
  if ($LASTEXITCODE -ne 0) { Complete-Update "refused" "Couldn't fetch main from the live copy's remote." }
  $to = Invoke-Git rev-parse origin/main
  if ($to -eq $from) { Complete-Update "unchanged" "Already on the newest main: $((Get-Version $from).title)." }
  Invoke-Git merge-base --is-ancestor $from $to | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Complete-Update "refused" "The live copy has commits that aren't on main. Leaving it as it is."
  }
  if (-not $SkipCiCheck) { Assert-CiPassed $to }

  Write-Result "running" "Updating."
  Write-Host "Updating from $((Get-Version $from).title) to $((Get-Version $to).title)."
  Write-Host "The worker restarts: a turn running now is recorded as interrupted."
  if (-not (Stop-Worker)) {
    # Nothing has changed yet. The task goes back on, and its worker starts once the port is free.
    Start-ScheduledTask -TaskName $TaskName
    Complete-Update "failed" "Something else still answers on port $($settings.Port), so the update stopped without changing anything. Shut that down, then try again."
  }
  $problem = Invoke-Step "Pulling main" "git merge --ff-only --quiet $to"
  if (-not $problem) { $problem = Install-AndBuild }
  if (-not $problem -and -not (Start-Worker)) {
    $problem = "The new version didn't answer its health check. See worker.log in the data folder."
  }
  if ($problem) { Complete-Update "failed" "$problem $(Restore-Previous)" }
  Complete-Update "updated" "Updated to $((Get-Version $to).title). Courtyard is running."
} catch {
  $message = "The update stopped unexpectedly: $($_.Exception.Message)"
  if ($workerDown) { $message = "$message $(Restore-Previous)" }
  Complete-Update "failed" $message
}
