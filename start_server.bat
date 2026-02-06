@echo off
echo ============================================
echo   YouTube News Extracter Server
echo ============================================
echo.

REM Kill any existing Node processes on port 3010
echo Checking for existing processes on port 3010...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3010 ^| findstr LISTENING') do (
    echo Killing process %%a
    taskkill /F /PID %%a 2>nul
)

echo.
echo Starting server...
echo Press Ctrl+C to stop.
echo.

cd /d "%~dp0"
node server.js

echo.
echo Server stopped.
pause
