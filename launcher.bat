@echo off
REM QR File Share Launcher for Windows
REM First launch: Installs requirements and opens the app
REM Subsequent launches: Just opens the app

cd /d "%~dp0"
python launcher.py
pause

