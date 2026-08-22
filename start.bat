@echo off
setlocal enabledelayedexpansion

title VanailaChat - Starting AI Workspace...
chcp 65001 >nul

cd /d "%~dp0"

echo.
echo  ======================================================
echo   VanailaChat - Automated Setup ^& Launcher (Windows)
echo   Self-Hosted AI Workspace for Local ^& Cloud Models
echo  ======================================================
echo.

:: ── 1. Check Desktop Shortcut Flag ───────────────────────────────────────────
if "%~1"=="--shortcut" (
    echo [INFO] Creating Desktop Shortcut...
    cscript //nologo scripts\create-shortcut.vbs
    echo [OK] Shortcut created on your Desktop!
    pause
    exit /b 0
)

:: ── 2. Check Node.js ─────────────────────────────────────────────────────────
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Node.js is not found in your PATH!
    echo [INFO] Attempting to install Node.js LTS via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        echo.
        echo [OK] Node.js installed. Please restart this script to reload PATH variables.
        pause
        exit /b 0
    ) else (
        echo [ERROR] winget is not available. Please install Node.js 20+ manually:
        echo https://nodejs.org/en/download
        start https://nodejs.org/en/download
        pause
        exit /b 1
    )
)

for /f "tokens=1 delims=." %%a in ('node -v') do set "NODE_VER=%%a"
set "NODE_MAJOR=%NODE_VER:v=%"

if %NODE_MAJOR% lss 20 (
    echo [WARNING] Detected Node.js %NODE_VER%. Node.js 20 or newer is strongly recommended.
) else (
    echo [OK] Node.js %NODE_VER% detected.
)

:: ── 3. Check / Configure pnpm ────────────────────────────────────────────────
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] pnpm not found. Setting up pnpm via corepack / npm...
    call corepack enable >nul 2>nul
    call corepack prepare pnpm@latest --activate >nul 2>nul
    where pnpm >nul 2>nul
    if !errorlevel! neq 0 (
        call npm install -g pnpm >nul 2>nul
    )
)

where pnpm >nul 2>nul
if %errorlevel% equ 0 (
    set "PM=pnpm"
    echo [OK] Package manager: pnpm
) else (
    set "PM=npm"
    echo [INFO] Using npm as fallback package manager.
)

:: ── 4. Setup .env file ───────────────────────────────────────────────────────
if not exist .env (
    if exist .env.example (
        echo [INFO] Creating .env from .env.example...
        copy /y .env.example .env >nul
        echo [OK] .env created.
    ) else (
        type nul > .env
    )
)

:: ── 5. Install Dependencies ──────────────────────────────────────────────────
if not exist node_modules (
    echo [INFO] Installing project dependencies with %PM%...
    call %PM% install
    if !errorlevel! neq 0 (
        echo [ERROR] Dependency installation failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed successfully.
) else (
    echo [OK] Dependencies already installed.
)

:: ── 6. Check Ollama (Optional) ───────────────────────────────────────────────
where ollama >nul 2>nul
if %errorlevel% equ 0 (
    curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
    if !errorlevel! neq 0 (
        echo [INFO] Starting local Ollama server in background...
        start /b ollama serve >nul 2>nul
    )
    echo [OK] Ollama local service ready.
) else (
    echo [INFO] Ollama not found (Cloud providers work out-of-the-box).
)

:: ── 7. Open Browser in Background ────────────────────────────────────────────
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5173"

:: ── 8. Start Application ─────────────────────────────────────────────────────
echo.
echo ======================================================
echo  VanailaChat is starting!
echo  URL: http://localhost:5173
echo  (Your browser will open automatically in a few seconds)
echo  Press Ctrl+C to stop the server at any time.
echo ======================================================
echo.

call %PM% run dev

if %errorlevel% neq 0 (
    pause
)
