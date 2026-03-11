@echo off
REM ChaoClaw Command Center — Windows Launcher
REM Starts the server and opens the browser.

setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "NODE=%APP_DIR%node.exe"
set "OPENCLAW_HOME=%USERPROFILE%\.openclaw"
set "CMD_DIR=%OPENCLAW_HOME%\workspace\command-center"
set "SETUP_MARKER=%CMD_DIR%\.setup-done"
set "CMD_PORT=5100"

REM Load .env if exists
if exist "%CMD_DIR%\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%CMD_DIR%\.env") do (
        set "%%A=%%B"
    )
)

REM First run — run setup
if not exist "%SETUP_MARKER%" (
    echo.
    echo  First-run setup required...
    echo.
    powershell -ExecutionPolicy Bypass -File "%APP_DIR%setup.ps1"
    goto :eof
)

REM Normal run — start server + open browser
title ChaoClaw Command Center

REM Kill existing on port
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%CMD_PORT% " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

cd /d "%CMD_DIR%"

echo.
echo  Starting ChaoClaw Command Center...
echo  Port: %CMD_PORT%
echo.

REM Start server in foreground, browser opens after delay
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%CMD_PORT%/cmd/"

"%NODE%" server\index.js
