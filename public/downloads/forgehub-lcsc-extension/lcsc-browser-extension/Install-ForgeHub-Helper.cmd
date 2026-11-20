@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-ForgeHub-Helper.ps1"
if errorlevel 1 goto failed
echo.
echo Installation completed. Refresh ForgeHub.
goto done
:failed
echo.
echo Installation failed. Send this window's error to your administrator.
:done
pause
