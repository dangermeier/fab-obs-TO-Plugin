@echo off
echo.
echo  FAB OBS TO Plugin
echo  ==================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed.
    echo  Please download it from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

echo  Checking dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: npm install failed. See error above.
    pause
    exit /b 1
)

echo.
echo  Opening config page in browser...
start "" "http://localhost:3000/config/"

echo  Starting server...
echo  (Keep this window open while streaming)
echo.
node server.js

echo.
echo  Server stopped. Press any key to close.
pause >nul
