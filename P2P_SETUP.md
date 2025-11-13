# P2P Outside-LAN Setup Guide

This guide explains how to set up peer-to-peer file sharing that works across different networks using the Node.js WebSocket signaling server.

## Overview

Your QR File Share app now supports two signaling modes:

1. **LAN Mode (Existing)**: Uses Flask-SocketIO - works when devices are on the same network
2. **Cross-Network Mode (New)**: Uses Node.js WebSocket server - works when devices are on different networks

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   PC/Web    │◄───────►│  Signaling       │◄───────►│  Mobile/Web │
│  (Browser)  │  WebRTC │  Server (Railway)│  WebRTC │  (Browser)  │
└─────────────┘         └──────────────────┘         └─────────────┘
      │                         │                            │
      │                         │                            │
      └─────────────────────────┴────────────────────────────┘
                    (Signaling only - no file data)
```

The signaling server only relays connection setup messages. Once connected, files transfer directly peer-to-peer.

## Quick Start

### Step 1: Deploy Signaling Server to Railway

1. **Go to Railway**: https://railway.com/new/github
2. **Connect your GitHub repository**
3. **Create new service**:
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - **Root Directory**: `signaling-server`
   - Railway will auto-detect Node.js and run `npm install` + `npm start`
4. **Get your URL**: Railway provides a URL like `https://your-app.up.railway.app`
5. **Your WebSocket URL**: `wss://your-app.up.railway.app`

### Step 2: Configure Flask App

Add the signaling server URL to your Flask app:

```python
# In app.py, add at the top
import os

# Get signaling server URL from environment variable
SIGNALING_SERVER_URL = os.environ.get('SIGNALING_SERVER_URL', '')

@app.route('/')
def index():
    return render_template('pc.html', 
        signaling_server_url=SIGNALING_SERVER_URL)

@app.route('/mobile')
def mobile():
    return render_template('mobile.html',
        signaling_server_url=SIGNALING_SERVER_URL)
```

### Step 3: Update Templates

Add this script tag in both `pc.html` and `mobile.html` (before the main script):

```html
<script>
    // Pass signaling server URL to JavaScript
    window.SIGNALING_SERVER_URL = '{{ signaling_server_url or "" }}';
</script>
```

### Step 4: Update JavaScript Files

See `INTEGRATION_EXAMPLE.md` for detailed code examples. The key changes:

1. Use `SignalingClient` when `SIGNALING_SERVER_URL` is set
2. Fall back to Socket.IO when not set (backward compatible)

### Step 5: Set Environment Variable

**For local testing:**
```bash
export SIGNALING_SERVER_URL='ws://localhost:3000'
```

**For production (Railway URL):**
```bash
export SIGNALING_SERVER_URL='wss://your-signaling-server.up.railway.app'
```

**Or set in Railway/Heroku dashboard:**
- Go to your Flask app service
- Add environment variable: `SIGNALING_SERVER_URL=wss://your-signaling-server.up.railway.app`

## Testing

### Local Testing

1. **Start signaling server locally:**
   ```bash
   cd signaling-server
   npm install
   npm start
   ```
   Server runs on `http://localhost:3000`

2. **Start Flask app:**
   ```bash
   export SIGNALING_SERVER_URL='ws://localhost:3000'
   python app.py
   ```

3. **Test connection:**
   - Open `http://localhost:5000` on PC
   - Scan QR code with mobile device
   - Files should transfer peer-to-peer

### Cross-Network Testing

1. **Deploy signaling server** to Railway (see Step 1)
2. **Set `SIGNALING_SERVER_URL`** to Railway URL
3. **Deploy Flask app** (or run locally with Railway URL)
4. **Test with devices on different networks:**
   - PC on home WiFi
   - Mobile on cellular data
   - Both connect via Railway signaling server

## How It Works

1. **PC generates session** → Creates QR code with session ID
2. **Mobile scans QR code** → Gets session ID
3. **Both connect to signaling server** → Join same session
4. **Signaling server matches peers** → Notifies both when connected
5. **WebRTC negotiation** → Offers/answers/ICE candidates relayed via signaling server
6. **Direct P2P connection established** → Files transfer directly (no server involved)

## Troubleshooting

### Signaling Server Issues

**Check server is running:**
```bash
curl https://your-signaling-server.up.railway.app/health
```

**Check Railway logs:**
- Railway dashboard → Your service → Logs
- Look for connection messages

### Connection Issues

**Browser console errors:**
- Check WebSocket URL is correct (`wss://` for HTTPS)
- Verify `SIGNALING_SERVER_URL` is set correctly
- Check for CORS errors (shouldn't happen with WebSocket)

**No peer connection:**
- Verify both devices are using same signaling server
- Check session IDs match
- Look for errors in browser console

### WebRTC Connection Issues

**ICE candidates not exchanging:**
- Check STUN servers are accessible (Google's STUN servers are used)
- Some networks block WebRTC - try different network
- Check firewall settings

**Connection timeout:**
- WebRTC may fail if both peers are behind strict NATs
- Consider adding TURN server for better connectivity

## Advanced Configuration

### Using Custom STUN/TURN Servers

Update WebRTC configuration in `pc.js` and `mobile.js`:

```javascript
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Add TURN server for better connectivity
        {
            urls: 'turn:your-turn-server.com:3478',
            username: 'your-username',
            credential: 'your-password'
        }
    ]
};
```

### Adding Authentication

To restrict access to signaling server, modify `server.js`:

```javascript
wss.on('connection', (ws, req) => {
    // Check authentication token
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (token !== 'your-secret-token') {
        ws.close(1008, 'Unauthorized');
        return;
    }
    // ... rest of connection handling
});
```

## Cost Considerations

- **Railway Free Tier**: 500 hours/month, $5 credit
- **Signaling server**: Very lightweight, minimal resources
- **File transfer**: Peer-to-peer (no server bandwidth used)
- **Estimated cost**: Free tier should be sufficient for personal use

## Security Notes

- Signaling server only relays connection setup messages
- File data never touches the signaling server
- WebRTC connections are encrypted end-to-end
- Consider adding authentication for production use

## Next Steps

- See `INTEGRATION_EXAMPLE.md` for code integration details
- See `signaling-server/DEPLOYMENT.md` for deployment details
- See `signaling-server/README.md` for server API documentation

