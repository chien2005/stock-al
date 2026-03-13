@echo off
title VN Stock Bot
echo.
echo   ======================================
echo   VN STOCK TRACKER ^& TELEGRAM NOTIFIER
echo   ======================================
echo.
echo   Starting bot...
echo.

cd /d "%~dp0"
node src/index.js

pause
