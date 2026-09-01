@echo off
setlocal EnableExtensions DisableDelayedExpansion
set /p "SLACK_BOT_TOKEN=Slack Bot Token: "
if not defined SLACK_BOT_TOKEN exit /b 1
node "%~dp0slack-sync-server.js"
