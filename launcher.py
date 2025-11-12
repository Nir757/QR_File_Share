#!/usr/bin/env python3
"""
QR File Share Launcher
First launch: Installs requirements and opens the app
Subsequent launches: Just opens the app
"""

import os
import sys
import subprocess
import webbrowser
import time
from pathlib import Path

def check_requirements_installed():
    """Check if requirements are already installed"""
    try:
        import flask
        import flask_socketio
        import qrcode
        import Pillow
        return True
    except ImportError:
        return False

def install_requirements():
    """Install requirements from requirements.txt"""
    print("Installing requirements...")
    script_dir = Path(__file__).parent.absolute()
    requirements_file = script_dir / "requirements.txt"
    
    if not requirements_file.exists():
        print(f"Error: requirements.txt not found at {requirements_file}")
        return False
    
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", str(requirements_file)
        ])
        print("Requirements installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error installing requirements: {e}")
        return False

def run_app():
    """Run the Flask app"""
    script_dir = Path(__file__).parent.absolute()
    app_file = script_dir / "app.py"
    
    if not app_file.exists():
        print(f"Error: app.py not found at {app_file}")
        return
    
    print("Starting QR File Share...")
    print("The app will open in your browser automatically.")
    print("Press Ctrl+C to stop the server.\n")
    
    # Change to script directory
    os.chdir(script_dir)
    
    # Run the app
    try:
        subprocess.run([sys.executable, "app.py"])
    except KeyboardInterrupt:
        print("\n\nServer stopped.")

def main():
    """Main launcher function"""
    print("=" * 50)
    print("QR File Share Launcher")
    print("=" * 50)
    
    # Check if requirements are installed
    if not check_requirements_installed():
        print("First launch detected. Installing requirements...")
        if not install_requirements():
            print("Failed to install requirements. Please install manually:")
            print(f"  pip install -r {Path(__file__).parent / 'requirements.txt'}")
            input("Press Enter to exit...")
            return
        print("\nRequirements installed! Starting app...\n")
    else:
        print("Requirements already installed. Starting app...\n")
    
    # Run the app
    run_app()

if __name__ == "__main__":
    main()

