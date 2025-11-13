# Debugging Guide - Cross-Network Connection Issues

## Problem: Phone Can't Connect from Different Network

When scanning QR code from a different network, the phone tries to load a local IP address (like `http://192.168.1.100:5000`) which is not accessible from outside your LAN.

## Solutions

### Option 1: Use ngrok (Quick Testing)

1. **Install ngrok**: https://ngrok.com/download

2. **Start your Flask app**:
   ```bash
   python app.py
   ```

3. **In another terminal, start ngrok**:
   ```bash
   ngrok http 5000
   ```

4. **Copy the ngrok URL** (e.g., `https://abc123.ngrok.io`)

5. **Set environment variable**:
   ```bash
   export PUBLIC_APP_URL='https://abc123.ngrok.io'
   ```

6. **Restart Flask app** - QR codes will now use the ngrok URL

### Option 2: Deploy Flask App to Railway (Production)

1. **Create a new Railway service** for your Flask app
2. **Set Root Directory** to `.` (root of your repo)
3. **Set Build Command**: `pip install -r requirements.txt`
4. **Set Start Command**: `python app.py`
5. **Add Environment Variables**:
   - `SIGNALING_SERVER_URL=wss://qrfileshare-production.up.railway.app`
   - `PUBLIC_APP_URL=https://your-flask-app.up.railway.app` (Railway will provide this)
6. **Deploy** - QR codes will use the Railway URL

### Option 3: Use Public IP with Port Forwarding (Advanced)

1. **Find your public IP**: https://whatismyipaddress.com
2. **Set up port forwarding** on your router (port 5000)
3. **Set environment variable**:
   ```bash
   export PUBLIC_APP_URL='http://YOUR_PUBLIC_IP:5000'
   ```

## Debug Page

Access the debug page to troubleshoot:
- **URL**: `http://localhost:5000/debug` (or your public URL)
- **With session**: `http://localhost:5000/debug?session=YOUR_SESSION_ID`

The debug page shows:
- ✅ Connection status
- ✅ Signaling server connection test
- ✅ Session information
- ✅ Environment variables
- ✅ Console logs

## Mobile Debugging

### View Console on Mobile

**Chrome (Android)**:
1. Connect phone via USB
2. Enable USB debugging
3. Open `chrome://inspect` on desktop Chrome
4. Click "Inspect" on your device

**Safari (iOS)**:
1. Enable Web Inspector: Settings > Safari > Advanced > Web Inspector
2. Connect iPhone to Mac via USB
3. Open Safari on Mac > Develop > [Your iPhone] > [Your Page]

**Alternative - Remote Debugging**:
- Use the debug page (`/debug`) - it shows logs on screen
- Check the "Console Logs" section

## Common Issues

### Issue: "Failed to connect to signaling server"

**Check**:
1. Is Railway signaling server running? Test: `curl https://qrfileshare-production.up.railway.app/health`
2. Is `SIGNALING_SERVER_URL` set correctly?
3. Check browser console for WebSocket errors

**Fix**:
- Verify Railway deployment is active
- Check Railway logs for errors
- Ensure WebSocket URL uses `wss://` (not `ws://`) for HTTPS sites

### Issue: "Phone can't load the page"

**Check**:
1. What URL is in the QR code? (Check PC console or debug page)
2. Is it a local IP? (e.g., `192.168.x.x`)
3. Is `PUBLIC_APP_URL` set?

**Fix**:
- Set `PUBLIC_APP_URL` environment variable
- Use ngrok for testing
- Deploy Flask app to Railway for production

### Issue: "Connection works but files don't transfer"

**Check**:
1. Are both devices using the same signaling server?
2. Check browser console for WebRTC errors
3. Are STUN servers accessible?

**Fix**:
- Verify both devices show "Using Node.js WebSocket signaling server" in console
- Check for firewall blocking WebRTC
- Try different network (some networks block P2P)

## Testing Checklist

- [ ] Railway signaling server is running (`/health` endpoint works)
- [ ] `SIGNALING_SERVER_URL` is set in Flask app
- [ ] `PUBLIC_APP_URL` is set (for cross-network)
- [ ] QR code contains public URL (not local IP)
- [ ] Both devices can access the Flask app URL
- [ ] Browser console shows "Using Node.js WebSocket signaling server"
- [ ] WebSocket connection succeeds (check debug page)
- [ ] Session IDs match on both devices

## Quick Test

1. **PC**: Open `http://localhost:5000`
2. **Check console**: Should see "Using Node.js WebSocket signaling server: wss://..."
3. **Check QR code URL**: Should be public URL (not `192.168.x.x`)
4. **Mobile**: Scan QR code
5. **Mobile debug**: Open `/debug?session=YOUR_SESSION_ID` on mobile
6. **Check both**: Connection status should be "✅ Connected"

