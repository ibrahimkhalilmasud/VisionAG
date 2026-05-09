@echo off
cd /d "%~dp0"
title VisionAG Fabric Inventory
color 0A
cls
echo.
echo  ============================================
echo       VisionAG  Fabric Inventory v1.0
echo  ============================================
echo.

:: Check Node.js
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Node.js is not installed!
  echo.
  echo  Download from: https://nodejs.org  ^(LTS version^)
  echo  After installing, run START.bat again.
  echo.
  pause
  exit /b 1
)

:: Install dependencies if missing
IF NOT EXIST "node_modules\express\package.json" (
  echo  Installing packages - please wait...
  echo.
  call npm install
  IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERROR] npm install failed. Check internet and try again.
    pause
    exit /b 1
  )
  echo.
)

:: Start
echo  Starting VisionAG...
echo.
echo  Login:  admin / admin123   or   staff / staff123
echo  URL:    http://localhost:3000
echo  Stop:   Press Ctrl+C or close this window
echo  ============================================
echo.

start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

node server.js

echo.
echo  Server stopped.
pause
