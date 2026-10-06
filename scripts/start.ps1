param([int]$BackendPort = 8000, [int]$FrontendPort = 5173)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$stateFile = Join-Path $runtimeDirectory 'server-pids.json'
if (Test-Path -LiteralPath $stateFile) {
    $previous = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $activeProcesses = @()
    foreach ($processId in @($previous.backend, $previous.frontend)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
        if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot)) { $activeProcesses += $processId }
    }
    if ($activeProcesses.Count -eq 2) {
        Write-Output "Dashboard: http://127.0.0.1:$($previous.frontendPort)"
        Write-Output "API docs:  http://127.0.0.1:$($previous.backendPort)/docs"
        exit
    }
    foreach ($processId in $activeProcesses) {
        try { [System.Diagnostics.Process]::GetProcessById($processId).Kill() }
        catch [System.ArgumentException] { }
    }
}
$portablePython = Join-Path $runtimeDirectory 'python\python.exe'
$virtualPython = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $virtualPython) { $pythonExecutable = $virtualPython }
elseif (Test-Path -LiteralPath $portablePython) { $pythonExecutable = $portablePython }
else { $pythonExecutable = (Get-Command python -ErrorAction Stop).Source }
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$viteExecutable = Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteExecutable)) { throw 'Install frontend dependencies with npm install first.' }

function Find-FreePort([int]$candidate) {
    while ($candidate -lt 65535) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start(); $listener.Stop(); return $candidate }
        catch { $listener.Stop(); $candidate++ }
    }
    throw 'No available port found.'
}

$backendPort = Find-FreePort $BackendPort
$frontendPort = Find-FreePort $FrontendPort
if ($frontendPort -eq $backendPort) { $frontendPort = Find-FreePort ($frontendPort + 1) }
$backendDirectory = Join-Path $projectRoot 'backend'
$frontendDirectory = Join-Path $projectRoot 'frontend'
$backendArguments = '-m uvicorn app.main:app --app-dir "{0}" --host 127.0.0.1 --port {1}' -f $backendDirectory, $backendPort
$backendProcess = Start-Process -FilePath $pythonExecutable -ArgumentList $backendArguments -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'backend.log') -RedirectStandardError (Join-Path $runtimeDirectory 'backend-error.log')
$env:API_PROXY_TARGET = "http://127.0.0.1:$backendPort"
$frontendArguments = '"{0}" --host 127.0.0.1 --port {1} --strictPort' -f $viteExecutable, $frontendPort
$frontendProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $frontendArguments -WorkingDirectory $frontendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'frontend.log') -RedirectStandardError (Join-Path $runtimeDirectory 'frontend-error.log')
@{ backend = $backendProcess.Id; frontend = $frontendProcess.Id; backendPort = $backendPort; frontendPort = $frontendPort } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'server-pids.json')

foreach ($endpoint in @("http://127.0.0.1:$backendPort/health", "http://127.0.0.1:$frontendPort")) {
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break }
        catch { Start-Sleep -Milliseconds 300 }
    }
    if (-not $ready) {
        foreach ($process in @($backendProcess, $frontendProcess)) {
            if (-not $process.HasExited) { $process.Kill() }
        }
        throw "Server did not start: $endpoint. See logs in $runtimeDirectory."
    }
}
Write-Output "Dashboard: http://127.0.0.1:$frontendPort"
Write-Output "API docs:  http://127.0.0.1:$backendPort/docs"
