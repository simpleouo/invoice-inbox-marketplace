@echo off
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do taskkill /f /pid %%p
