# Fix Railway Environment Variables

## Issue: Connection Error to Signaling Server

Your environment variables are set incorrectly. Here's how to fix them:

## Current (WRONG) Settings

Based on your Railway dashboard:

```
SIGNALING_SERVER_URL = SIGNALING_SERVER_URL=wss://qrfileshare-production.up.railway.app  ❌ WRONG
PUBLIC_APP_URL = flask-app-production-10c0.up.railway.app  ⚠️ Missing https://
```

## Correct Settings

### Step 1: Fix SIGNALING_SERVER_URL

1. Go to Railway → Your Flask App Service → Variables
2. Find `SIGNALING_SERVER_URL`
3. Click the edit icon (pencil)
4. **Remove the variable name** - the value should be ONLY the URL:

**Correct Value:**
```
wss://qrfileshare-production.up.railway.app
```

**NOT:**
```
SIGNALING_SERVER_URL=wss://qrfileshare-production.up.railway.app  ❌
```

### Step 2: Fix PUBLIC_APP_URL

1. Find `PUBLIC_APP_URL` in Variables
2. Click edit
3. Add `https://` prefix:

**Correct Value:**
```
https://flask-app-production-10c0.up.railway.app
```

**NOT:**
```
flask-app-production-10c0.up.railway.app  ❌ (missing https://)
```

## Final Correct Variables

```
SIGNALING_SERVER_URL = wss://qrfileshare-production.up.railway.app
PUBLIC_APP_URL = https://flask-app-production-10c0.up.railway.app
```

## After Fixing

1. Railway will automatically redeploy
2. Wait for deployment to complete
3. Test again:
   - Open your Flask app URL
   - Generate a session
   - Scan QR code
   - Should connect successfully!

## How to Verify

1. Check Railway logs - should see:
   ```
   Using PUBLIC_APP_URL for QR code: https://flask-app-production-10c0.up.railway.app
   ```

2. Check browser console (on mobile, use debug page):
   - Should see: "Using Node.js WebSocket signaling server: wss://qrfileshare-production.up.railway.app"
   - Should NOT see connection errors

3. Test signaling server directly:
   ```bash
   curl https://qrfileshare-production.up.railway.app/health
   ```
   Should return: `{"status":"ok","sessions":0,"timestamp":"..."}`

