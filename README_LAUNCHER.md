# QR File Share - PC Launcher

## Quick Start

### Windows Users

1. **Double-click `launcher.bat`** to start the app
   - First time: It will automatically install all requirements
   - After that: It will just open the app

2. **Create Desktop Shortcut** (Optional):
   - Right-click `launcher.bat`
   - Select "Create shortcut"
   - Drag the shortcut to your desktop
   - Rename it to "QR File Share"

### Mac/Linux Users

1. **Make launcher executable**:
   ```bash
   chmod +x launcher.py
   ```

2. **Run the launcher**:
   ```bash
   ./launcher.py
   ```

   Or double-click `launcher.py` if your system supports it.

## How It Works

- **First Launch**: The launcher checks if Python packages are installed. If not, it automatically installs them from `requirements.txt`
- **Subsequent Launches**: The launcher skips installation and directly opens the web app
- **Automatic Browser**: The app automatically opens in your default browser

## Troubleshooting

If the launcher doesn't work:

1. Make sure Python is installed and in your PATH
2. Try running manually:
   ```bash
   python launcher.py
   ```
3. Or install requirements manually:
   ```bash
   pip install -r requirements.txt
   python app.py
   ```

