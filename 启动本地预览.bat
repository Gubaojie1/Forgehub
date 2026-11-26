@echo off
setlocal
cd /d "%~dp0" || goto failed
node "tools\start-local-preview.cjs" %*
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo ForgeHub preview failed. Check the error above.
pause
exit /b 1
