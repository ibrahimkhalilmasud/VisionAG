@echo off
cd /d "%~dp0"
title VisionAG Fix and Reinstall
color 0E
cls
echo.
echo  ============================================
echo       VisionAG  Fabric Inventory v1.0
echo       FIX: Reinstalling packages...
echo  ============================================
echo.

:: Check Node.js
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Node.js is not installed!
  echo  Download from: https://nodejs.org  (LTS version)
  echo.
  pause
  exit /b 1
)

echo  Node.js found:
node --version
echo.

:: Remove broken node_modules
echo  Removing old/broken node_modules...
IF EXIST "node_modules" (
  rmdir /s /q "node_modules"
  echo  Done.
) ELSE (
  echo  node_modules not found, skipping.
)
echo.

:: Fresh install
echo  Installing packages fresh (takes ~30 seconds)...
echo.
call npm install
IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo  [ERROR] npm install failed.
  echo  Make sure you have internet access and try again.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   Install complete! Starting VisionAG...
echo  ============================================
echo.
echo  Default logins:
echo    Admin  ->  admin  / admin123
echo    Staff  ->  staff  / staff123
echo.
echo  App will open at: http://localhost:3000
echo  Press Ctrl+C (or close this window) to stop.
echo  ============================================
echo.

start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

node server.js

echo.
echo  Server stopped.
pause
