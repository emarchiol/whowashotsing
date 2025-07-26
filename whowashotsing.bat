@echo off
cd /d %~dp0
:loop
cls
node index.ts
timeout /t 60 /nobreak >nul

goto loop