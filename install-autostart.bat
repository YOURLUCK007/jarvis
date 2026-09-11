@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\Jarvis Desktop.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $shortcut = $ws.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = '%PROJECT_DIR%start-jarvis.bat'; $shortcut.WorkingDirectory = '%PROJECT_DIR%'; $shortcut.WindowStyle = 7; $shortcut.Description = 'Start Jarvis Desktop'; $shortcut.Save()"

if exist "%SHORTCUT%" (
  echo Jarvis will now start automatically when you sign in to Windows.
  echo Shortcut created at:
  echo %SHORTCUT%
) else (
  echo Could not create the startup shortcut.
)
pause