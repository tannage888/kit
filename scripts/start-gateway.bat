@echo off
setlocal

set "GATEWAY_DIR=%~dp0..\gateway"
set "LOG_DIR=%~dp0..\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%GATEWAY_DIR%"
call npm run start >> "%LOG_DIR%\gateway.log" 2>&1
