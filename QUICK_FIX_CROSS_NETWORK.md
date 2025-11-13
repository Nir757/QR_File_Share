# Quick Fix: Cross-Network Connection

## The Problem

QR code contains a local IP address (like `http://192.168.1.100:5000`) which only works on the same network.

## Quick Solution: Use ngrok

### Step 1: Install ngrok
Download from: https://ngrok.com/download

### Step 2: Start Flask App
```bash
python app.py
```

### Step 3: Start ngrok (in another terminal)
```bash
ngrok http 5000
```

### Step 4: Copy the ngrok URL
You'll see something like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:5000
```

### Step 5: Set Environment Variable
```bash
# Windows PowerShell
$env:PUBLIC_APP_URL='https://abc123.ngrok.io'

# Windows CMD
set PUBLIC_APP_URL=https://abc123.ngrok.io

# Mac/Linux
export PUBLIC_APP_URL='https://abc123.ngrok.io'
```

### Step 6: Restart Flask App
Stop and restart `python app.py`

### Step 7: Test
1. Open `http://localhost:5000` on PC
2. Check the QR code URL - should now show the ngrok URL
3. Scan with phone from different network - should work!

## Debug Page

If something doesn't work, open the debug page:
- **PC**: `http://localhost:5000/debug`
- **Mobile**: `https://your-ngrok-url.ngrok.io/debug?session=YOUR_SESSION_ID`

The debug page shows:
- ✅ Connection status
- ✅ Signaling server test
- ✅ Session info
- ✅ Console logs (visible on screen!)

## What Changed

1. ✅ Added `PUBLIC_APP_URL` environment variable support
2. ✅ QR code now uses public URL when set
3. ✅ Added `/debug` page for troubleshooting
4. ✅ Better error messages on mobile

## Next Steps

For production, deploy Flask app to Railway instead of using ngrok.

