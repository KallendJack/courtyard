# Updates the live worker to the newest main (ADR 0011). Run it from the live copy when you choose:
#
#   & <live copy>\scripts\live\update.ps1
#
# It refuses when the live copy has changes of its own, isn't on main, or main's newest commit
# isn't passing CI. Otherwise it stops the worker, pulls main, installs the locked package versions
# and builds, then starts the worker and waits for it to answer. If any step fails, it puts the
# previous version back and starts that instead. It never asks anything, so it can run with no
# window, and it writes how it went to live-update.json in the data folder.

param(
  # The task install-task.ps1 registered, if it was given another name.
  [string]$TaskName = "",
  # Skips checking main's CI result, for a live copy whose remote isn't on GitHub.
  [switch]$SkipCiCheck
)

. "$PSScriptRoot\common.ps1"
if (-not $TaskName) { $TaskName = $DefaultTaskName }

$root = Get-LiveRoot
Set-Location $root
$settings = Read-LiveSettings $root
New-Item -ItemType Directory -Force -Path $settings.DataDir | Out-Null
$resultFile = Join-Path $settings.DataDir "live-update.json"
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$from = (git -C $root rev-parse HEAD)
$to = $from

# A version as people read it: the short commit and its first line.
function Get-Version([string]$Commit) {
  return (git -C $root log -1 --format="%h %s" $Commit)
}

# Records how the update went, for the owner and for the app (#35), and ends the script.
function Complete-Update([string]$Outcome, [string]$Message) {
  $result = [ordered]@{
    outcome    = $Outcome
    from       = Get-Version $from
    to         = Get-Version $to
    message    = $Message
    startedAt  = $startedAt
    finishedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $temporary = "$resultFile.tmp"
  [IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  Move-Item -Force $temporary $resultFile
  Write-Host $Message
  if ($Outcome -eq "updated" -or $Outcome -eq "unchanged") { exit 0 }
  exit 1
}

# Runs a command, saying what failed if it did.
function Invoke-Step([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { return "$What failed (exit code $LASTEXITCODE)." }
  return $null
}

# Installs the locked package versions and builds the version that's checked out.
function Install-AndBuild {
  $problem = Invoke-Step "Installing packages" { cmd.exe /c "pnpm install --frozen-lockfile" }
  if (-not $problem) { $problem = Invoke-Step "Building" { cmd.exe /c "pnpm build" } }
  return $problem
}

function Stop-Worker {
  Stop-ScheduledTask -TaskName $TaskName
  Stop-WorkerProcesses $root
  Wait-Health $settings.Port -Seconds 15 -Down | Out-Null
}

function Start-Worker {
  Start-ScheduledTask -TaskName $TaskName
  return (Wait-Health $settings.Port -Seconds 90)
}

# Puts the version that was running back, and starts it. Says what went wrong if that fails too.
function Restore-Previous {
  git -C $root reset --hard $from | Out-Null
  $problem = Install-AndBuild
  if ($problem) { return "Putting back $(Get-Version $from) failed too: $problem Run pnpm install and pnpm build in $root." }
  if (-not (Start-Worker)) { return "The previous version was put back, but the worker didn't answer. See worker.log in the data folder." }
  return $null
}

# Refuses unless every CI check on this commit has passed.
function Assert-CiPassed([string]$Commit) {
  $remote = git -C $root remote get-url origin
  $onGitHub = $remote -match 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$'
  if (-not $onGitHub) {
    Complete-Update "refused" "The live copy's remote isn't on GitHub, so main's CI can't be checked. Run with -SkipCiCheck to update anyway."
  }
  $repository = "$($Matches[1])/$($Matches[2])"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/commits/$Commit/check-runs" `
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

try {
  if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Complete-Update "refused" "There's no '$TaskName' task. Run install-task.ps1 first."
  }
  if ((git -C $root branch --show-current) -ne "main") {
    Complete-Update "refused" "$root isn't on main. The live copy only ever runs main."
  }
  if (git -C $root status --porcelain) {
    Complete-Update "refused" "$root has changes of its own. The live copy only ever runs main as it is on GitHub."
  }
  git -C $root fetch --quiet origin main
  if ($LASTEXITCODE -ne 0) { Complete-Update "refused" "Couldn't fetch main from the live copy's remote." }
  $to = (git -C $root rev-parse origin/main)
  if ($to -eq $from) { Complete-Update "unchanged" "Already on the newest main: $(Get-Version $from)." }
  git -C $root merge-base --is-ancestor $from $to
  if ($LASTEXITCODE -ne 0) {
    Complete-Update "refused" "The live copy has commits that aren't on main. Leaving it as it is."
  }
  if (-not $SkipCiCheck) { Assert-CiPassed $to }

  Write-Host "Updating from $(Get-Version $from) to $(Get-Version $to)."
  Write-Host "The worker restarts: a turn running now is recorded as interrupted."
  Stop-Worker
  $problem = Invoke-Step "Pulling main" { git -C $root merge --ff-only --quiet $to }
  if (-not $problem) { $problem = Install-AndBuild }
  if (-not $problem -and -not (Start-Worker)) {
    Stop-Worker
    $problem = "The new version didn't answer its health check. See worker.log in the data folder."
  }
  if ($problem) {
    $restoreProblem = Restore-Previous
    Complete-Update "failed" "$problem $(if ($restoreProblem) { $restoreProblem } else { "$(Get-Version $from) is still running." })"
  }
  Complete-Update "updated" "Updated to $(Get-Version $to). Courtyard is running."
} catch {
  Complete-Update "failed" "The update stopped unexpectedly: $($_.Exception.Message)"
}
