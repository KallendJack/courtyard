# Shared by the live scripts (ADR 0011): where the live copy is, its settings, and its health.
# Dot-source it: . "$PSScriptRoot\common.ps1". Written for Windows PowerShell 5.1.

$ErrorActionPreference = "Stop"

# The scheduled task that runs the live worker, unless a script is given another name.
function Resolve-TaskName([string]$Name) {
  if ($Name) { return $Name }
  return "Courtyard worker"
}

# The live copy: the clone of main these scripts sit in.
function Get-LiveRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

# The live copy's settings, from its .env (which git ignores). Only what the scripts need: the
# worker reads the whole file itself. Read the way Node reads it: quotes are taken off, and an
# unquoted value ends at a # comment.
function Read-LiveSettings([string]$Root) {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) {
    throw "There's no .env in $Root. Copy .env.example to .env and fill it in."
  }
  $values = @{}
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim()
      if ($value -match '^"([^"]*)"' -or $value -match "^'([^']*)'") {
        $value = $Matches[1]
      } else {
        $value = ($value -replace '\s+#.*$', '').Trim()
      }
      $values[$name] = $value
    }
  }
  if (-not $values["COURTYARD_DATA_DIR"]) { throw ".env needs COURTYARD_DATA_DIR." }
  $port = 8787
  if ($values["COURTYARD_PORT"]) { $port = [int]$values["COURTYARD_PORT"] }
  # Relative paths are relative to the live copy, where the worker starts.
  $dataDir = $values["COURTYARD_DATA_DIR"]
  if (-not [IO.Path]::IsPathRooted($dataDir)) { $dataDir = Join-Path $Root $dataDir }
  return @{ DataDir = $dataDir; Port = $port }
}

# Whether the worker on this port answers its health check.
function Test-Health([int]$Port) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

# Waits for the health check to answer (or, with -Down, to stop answering).
function Wait-Health([int]$Port, [int]$Seconds = 60, [switch]$Down) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    if ((Test-Health $Port) -ne [bool]$Down) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# Appends a line to a log as UTF-8, which is what the worker's own output is.
function Add-LogLine([string]$Path, [string]$Text) {
  [IO.File]::AppendAllText($Path, "$Text`r`n", (New-Object Text.UTF8Encoding $false))
}

# The worker's entry point in the live copy. run.ps1 starts node with this full path, so the live
# worker's process can be told apart from any other node, a development worker included.
function Get-WorkerEntry([string]$Root) {
  return Join-Path $Root "apps\worker\src\main.ts"
}

# Shuts the live worker down: the task, the run.ps1 loop it started and the worker itself. Ending
# a task ends only its first process, so the loop would otherwise carry on and start the worker
# again. Says whether the port is free afterwards.
function Stop-LiveWorker([string]$Root, [string]$TaskName, [int]$Port) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName
  }
  $loop = Join-Path $Root "scripts\live\run.ps1"
  $entry = Get-WorkerEntry $Root
  # The loops first, so none of them starts the worker again in between.
  foreach ($name in @("powershell.exe", "node.exe")) {
    $match = $loop
    if ($name -eq "node.exe") { $match = $entry }
    Get-CimInstance Win32_Process -Filter "Name = '$name'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($match) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  return (Wait-Health $Port -Seconds 15 -Down)
}
