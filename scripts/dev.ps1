$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$DistIndex = Join-Path $RepoRoot "frontend\dist\index.html"

if (-not (Test-Path $PythonExe)) {
    Write-Error "Virtual environment python not found at $PythonExe"
    exit 1
}

if (-not (Test-Path $DistIndex)) {
    Write-Host "[AIC-GATE] Building frontend bundle..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "[AIC-GATE] Starting FastAPI server at http://127.0.0.1:8000" -ForegroundColor Green
$env:PYTHONPATH = Join-Path $RepoRoot "backend\src"
& $PythonExe -m uvicorn aic_gate.main:app --reload --host 127.0.0.1 --port 8000
