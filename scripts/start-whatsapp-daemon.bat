@echo off
setlocal

set "DAEMON_DIR=c:\Users\seang\OneDrive\Documents\ClaudeWork\projects\claude_whatsapp_integration"
set "LOG_DIR=%~dp0..\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%DAEMON_DIR%"
call npm run start >> "%LOG_DIR%\whatsapp-daemon.log" 2>&1
