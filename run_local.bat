@echo off
chcp 65001 >nul
title VN Stock Bot v2.5.0 - Local Server
echo =======================================================
echo    🇻🇳 VN STOCK BOT v2.5.0 - LOCAL RUN
echo =======================================================
cd /d "%~dp0"

echo [1/2] Kiểm tra port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Đang tắt process cũ chiếm port 3000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/2] Đang khởi chạy server local...
npm start
pause
