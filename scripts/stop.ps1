$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $projectRoot '.tools\server-pids.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No recorded servers.'; exit }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
foreach ($processId in @($state.backend, $state.frontend)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot)) {
        try {
            [System.Diagnostics.Process]::GetProcessById($processId).Kill()
            Write-Output "Stopped project process $processId."
        } catch [System.ArgumentException] {
            Write-Output "Project process $processId already stopped."
        }
    }
}
