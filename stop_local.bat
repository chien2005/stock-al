@echo off
chcp 65001 >nul
title Dừng VN Stock Bot
echo =======================================================
echo    Dừng VN Stock Bot local (Port 3000)
echo =======================================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Đang tắt process PID: %%a...
    taskkill /F /PID %%a >nul 2>&1
)
echo Hoàn tất! Server đã được dừng.
pause
