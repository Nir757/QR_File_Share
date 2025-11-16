@echo off
REM QR File Share Launcher for Windows
REM First launch: Installs requirements and opens the app
REM Subsequent launches: Just opens the app

cd /d "%~dp0"

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ==================================================
    echo ERROR: Python is not installed or not in PATH
    echo ==================================================
    echo.
    echo Please install Python 3.7 or higher:
    echo   1. Download from: https://www.python.org/downloads/
    echo   2. During installation, check "Add Python to PATH"
    echo   3. Run this launcher again after installation
    echo.
    echo Alternatively, you can run manually:
    echo   pip install -r requirements.txt
    echo   python app.py
    echo.
    pause
    exit /b 1
)

REM Check if requirements are installed
python -c "import flask, flask_socketio, qrcode, PIL" 2>nul
if errorlevel 1 (
    echo Installing requirements...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
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

