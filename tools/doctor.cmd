@echo off
setlocal
set "SCRIPT=%~dp0doctor.js"
if not exist "%SCRIPT%" set "SCRIPT=C:\Claude playground\Pipiline setupper\tools\doctor.js"
node "%SCRIPT%" %*
