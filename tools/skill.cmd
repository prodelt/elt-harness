@echo off
setlocal
set "SCRIPT=%~dp0skill-search.js"
if not exist "%SCRIPT%" set "SCRIPT=C:\Claude playground\Pipiline setupper\tools\skill-search.js"
node "%SCRIPT%" %*
