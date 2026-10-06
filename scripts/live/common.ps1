# Shared by the live scripts (ADR 0011): where the live copy is, its settings, and its health.
# Dot-source it: . "$PSScriptRoot\common.ps1". Written for Windows PowerShell 5.1.

$ErrorActionPreference = "Stop"

# The scheduled task that runs the live worker.
$DefaultTaskName = "Courtyard worker"

# The live copy: the clone of main these scripts sit in.
function Get-LiveRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

# The live copy's settings, from its .env (which git ignores). Only what the scripts need: the
# worker reads the whole file itself.
function Read-LiveSettings([string]$Root) {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) {
    throw "There's no .env in $Root. Copy .env.example to .env and fill it in."
  }
  $values = @{}
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') {
      $values[$Matches[1]] = $Matches[2].Trim('"', "'")
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

# Appends a line to a text file as UTF-8, which is what the worker's own output is.
function Add-Line([string]$Path, [string]$Text) {
  [IO.File]::AppendAllText($Path, "$Text`r`n", (New-Object Text.UTF8Encoding $false))
}

# The worker's entry point in the live copy. run.ps1 starts node with this full path, so the live
# worker's process can be told apart from any other node, a development worker included.
function Get-WorkerEntry([string]$Root) {
  return Join-Path $Root "apps\worker\src\main.ts"
}

# Stops the live worker's node processes, if any are running.
function Stop-WorkerProcesses([string]$Root) {
  $entry = Get-WorkerEntry $Root
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($entry) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
