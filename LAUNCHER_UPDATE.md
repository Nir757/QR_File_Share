# Launcher Update - Railway Auto-Launch

## What Changed

The launcher now **automatically opens the Railway URL** by default for cross-network support!

## How It Works

### Default Behavior (Cross-Network Mode)

1. **Run launcher**: `python launcher.py` or double-click `launcher.bat`
2. **Launcher checks** `config.py`:
   - If `DEFAULT_MODE = 'railway'` and `RAILWAY_APP_URL` is set
   - Opens Railway URL in browser (cross-network mode)
   - No local server needed!

### LAN Mode (If Needed)

1. **Option 1**: Edit `config.py`:
   ```python
   DEFAULT_MODE = 'local'
   ```

2. **Option 2**: Use the mode switcher button in the UI:
   - Click "🌐 Cross-Network" button → switches to "🏠 LAN Mode"
   - Redirects to `http://localhost:5000`
   - Starts local server automatically

## Configuration

Edit `config.py` to set your Railway URL:

```python
RAILWAY_APP_URL = 'https://flask-app-production-10c0.up.railway.app'
DEFAULT_MODE = 'railway'  # or 'local'
```

## UI Features

- **Mode Switcher Button**: Top right corner
  - Shows current mode (🌐 Cross-Network or 🏠 LAN Mode)
  - Click to switch modes
- **Mode Indicator**: Below QR code
  - Shows which mode you're using
  - Color-coded (blue for cross-network, orange for LAN)

## Benefits

✅ **Default to cross-network** - Works from anywhere by default
✅ **Easy switching** - One-click mode toggle
✅ **Visual feedback** - Always know which mode you're using
✅ **No manual URL typing** - Launcher handles everything

## Testing

1. Run `python launcher.py`
2. Should open Railway URL automatically
3. See mode indicator showing "🌐 Cross-Network Mode"
4. Click mode button to switch to LAN if needed

