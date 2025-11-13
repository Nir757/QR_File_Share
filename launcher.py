#!/usr/bin/env python3
"""
QR File Share Launcher
First launch: Installs requirements and opens the app
Subsequent launches: Just opens the app
Opens Railway URL by default for cross-network support
"""

import os
import sys
import subprocess
import webbrowser
import time
from pathlib import Path

# Try to import config, fall back to defaults if not available
try:
    from config import RAILWAY_APP_URL, DEFAULT_MODE
except ImportError:
    RAILWAY_APP_URL = ''
    DEFAULT_MODE = 'railway'

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
    
    # Ask user which mode they want
    print("\n📋 Select Mode:")
    print("  1. 🌐 Cross-Network Mode (Railway) - Works from anywhere")
    print("  2. 🏠 LAN Mode (Local) - Same network only")
    
    # Check if Railway URL is configured
    if not RAILWAY_APP_URL:
        print("\n⚠️  Warning: Railway URL not configured in config.py")
        print("   Cross-Network Mode will not be available.")
        print("   Set RAILWAY_APP_URL in config.py to enable it.\n")
        choice = '2'  # Force LAN mode if Railway not configured
    else:
        choice = input("\nEnter choice (1 or 2) [default: 1]: ").strip() or '1'
    
    # Validate choice
    if choice not in ['1', '2']:
        print("Invalid choice. Defaulting to Cross-Network Mode.")
        choice = '1'
    
    # Handle Railway mode
    if choice == '1' and RAILWAY_APP_URL:
        print(f"\n🌐 Cross-Network Mode")
        print(f"Opening Railway app: {RAILWAY_APP_URL}")
        print("\nOpening browser...")
        time.sleep(1)
        webbrowser.open(RAILWAY_APP_URL)
        print("\n✅ Browser opened! The app is running on Railway.")
        print("You can close this window.\n")
        input("Press Enter to exit...")
        return
    
    # Handle LAN mode
    if choice == '2' or (choice == '1' and not RAILWAY_APP_URL):
        print("\n🏠 LAN Mode (Local Network Only)")
        print("Starting local server...\n")
        
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

