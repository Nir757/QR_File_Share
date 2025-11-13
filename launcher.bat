@echo off
REM QR File Share Launcher for Windows
REM First launch: Installs requirements and opens the app
REM Subsequent launches: Just opens the app

cd /d "%~dp0"

REM Check if requirements are installed
python -c "import flask, flask_socketio, qrcode, PIL" 2>nul
if errorlevel 1 (
    echo Installing requirements...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Failed to install requirements. Please install manually:
        echo   pip install -r requirements.txt
        pause
        exit /b 1
    )
    echo Requirements installed!
)

REM Run the app
python app.py
pause

