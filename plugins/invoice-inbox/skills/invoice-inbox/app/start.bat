@echo off
rem 在背景啟動發票收件匣並開啟網頁（Windows）。停止請執行 stop.bat
cd /d "%~dp0"
netstat -ano | findstr ":3456" | findstr "LISTENING" >nul
if errorlevel 1 (
  start "" /b cmd /c "node server.js >> server.log 2>&1"
  timeout /t 2 >nul
)
start http://localhost:3456
