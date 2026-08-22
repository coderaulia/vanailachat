# ==============================================================================
# VanailaChat - PowerShell Setup & Launcher (Windows / cross-platform)
# ==============================================================================

$Host.UI.RawUI.WindowTitle = "VanailaChat - AI Workspace"
$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AppDir

Write-Host ""
Write-Host " ======================================================" -ForegroundColor Cyan
Write-Host "  VanailaChat - Automated Setup & Launcher (PowerShell)" -ForegroundColor Cyan
Write-Host "  Self-Hosted AI Workspace for Local & Cloud Models" -ForegroundColor Cyan
Write-Host " ======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Desktop Shortcut flag
if ($args -contains "--shortcut" -or $args -contains "-s") {
    Write-Host "[INFO] Creating Desktop shortcut..." -ForegroundColor Yellow
    $WshShell = New-Object -ComObject WScript.Shell
    $DesktopPath = [Environment]::GetFolderPath("Desktop")
    $Shortcut = $WshShell.CreateShortcut("$DesktopPath\VanailaChat.lnk")
    $Shortcut.TargetPath = "$AppDir\start.bat"
    $Shortcut.WorkingDirectory = $AppDir
    $Shortcut.Description = "Launch VanailaChat AI Workspace"
    if (Test-Path "$AppDir\public\favicon.ico") {
        $Shortcut.IconLocation = "$AppDir\public\favicon.ico,0"
    }
    $Shortcut.Save()
    Write-Host "[OK] Desktop shortcut created at $DesktopPath\VanailaChat.lnk" -ForegroundColor Green
    exit 0
}

# 2. Check Node.js
try {
    $nodeVer = node -v
    Write-Host "[OK] Node.js $nodeVer detected." -ForegroundColor Green
} catch {
    Write-Host "[WARNING] Node.js is not found!" -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "[INFO] Installing Node.js LTS via winget..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        Write-Host "[OK] Node.js installed. Please restart PowerShell." -ForegroundColor Green
        pause
        exit 0
    } else {
        Write-Host "[ERROR] Please install Node.js 20+ from https://nodejs.org" -ForegroundColor Red
        Start-Process "https://nodejs.org"
        pause
        exit 1
    }
}

# 3. Check pnpm
$pm = "pnpm"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[INFO] Setting up pnpm..." -ForegroundColor Yellow
    try {
        corepack enable
        corepack prepare pnpm@latest --activate
    } catch {
        try {
            npm install -g pnpm
        } catch {
            Write-Host "[INFO] Falling back to npm." -ForegroundColor Yellow
            $pm = "npm"
        }
    }
}

# 4. Setup .env
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Host "[INFO] Creating .env from .env.example..." -ForegroundColor Cyan
        Copy-Item ".env.example" ".env"
        Write-Host "[OK] .env file created." -ForegroundColor Green
    } else {
        New-Item -ItemType File -Path ".env" | Out-Null
    }
}

# 5. Install Dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] Installing dependencies with $pm..." -ForegroundColor Cyan
    & $pm install
    Write-Host "[OK] Dependencies installed." -ForegroundColor Green
} else {
    Write-Host "[OK] Dependencies already installed." -ForegroundColor Green
}

# 6. Check Ollama
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
        Write-Host "[OK] Ollama local service is active." -ForegroundColor Green
    } catch {
        Write-Host "[INFO] Starting local Ollama service..." -ForegroundColor Yellow
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    }
}

# 7. Browser Launch Job
Start-Job -ScriptBlock {
    param($url)
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 600
        try {
            $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($res.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {}
    }
    if ($ready) {
        Start-Process $url
    }
} -ArgumentList "http://localhost:5173" | Out-Null

# 8. Start Application
Write-Host ""
Write-Host " ======================================================" -ForegroundColor Green
Write-Host "  VanailaChat is starting at http://localhost:5173" -ForegroundColor Green
Write-Host "  Browser will open automatically." -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop the server." -ForegroundColor Yellow
Write-Host " ======================================================" -ForegroundColor Green
Write-Host ""

& $pm run dev
