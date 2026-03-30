@echo off
title Inkwell - Local Dev Server
echo.
echo  ========================================
echo   Inkwell - iPad Stylus Notebook App
echo   by OnBuzz (onbuzz.loxia.ai)
echo  ========================================
echo.

cd /d "%%~dp0"

:: Check if node_modules exists
if not exist "node_modules\" (
    echo  [*] Installing dependencies...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed.
    echo.
)

echo  [*] Starting dev server...
echo  [*] App will open at: http://localhost:3000
echo  [*] Press Ctrl+C to stop the server.
echo.

:: Open browser after short delay
start "" cmd /c "timeout /t 3 /nobreak ^>nul ^&^& start http://localhost:3000"

:: Start Vite dev server
call npx vite --host --port 3000

echo.
echo  Server stopped.
pause
