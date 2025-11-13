# Quick Start - P2P Outside-LAN Support

## 🚀 5-Minute Setup

### 1. Deploy Signaling Server (2 minutes)

```bash
# Option A: Railway (Recommended)
# 1. Go to https://railway.com/new/github
# 2. Connect your repo
# 3. Create service, set root directory to "signaling-server"
# 4. Copy the Railway URL (e.g., https://your-app.up.railway.app)

# Option B: Local Testing
cd signaling-server
npm install
npm start
# Server runs on ws://localhost:3000
```

### 2. Update Flask App (1 minute)

Add to `app.py`:

```python
import os

SIGNALING_SERVER_URL = os.environ.get('SIGNALING_SERVER_URL', '')

@app.route('/')
def index():
    return render_template('pc.html', signaling_server_url=SIGNALING_SERVER_URL)

@app.route('/mobile')
def mobile():
    return render_template('mobile.html', signaling_server_url=SIGNALING_SERVER_URL)
```

### 3. Update Templates (1 minute)

Add to both `pc.html` and `mobile.html` (before `</head>`):

```html
<script>
    window.SIGNALING_SERVER_URL = '{{ signaling_server_url or "" }}';
</script>
```

### 4. Set Environment Variable (1 minute)

```bash
# For Railway deployment:
export SIGNALING_SERVER_URL='wss://your-app.up.railway.app'

# For local testing:
export SIGNALING_SERVER_URL='ws://localhost:3000'
```

### 5. Update JavaScript (See INTEGRATION_EXAMPLE.md)

The `signaling-client.js` is already included. You need to modify `pc.js` and `mobile.js` to use it when `SIGNALING_SERVER_URL` is set.

## ✅ Verification

1. **Check signaling server:**
   ```bash
   curl https://your-app.up.railway.app/health
   ```

2. **Test connection:**
   - Open app on PC
   - Scan QR code with mobile
   - Check browser console for "Using Node.js signaling server"

## 📁 File Structure

```
qrfileshare/
├── signaling-server/          # Node.js WebSocket server
│   ├── server.js             # Main server file
│   ├── package.json          # Dependencies
│   └── DEPLOYMENT.md         # Deployment guide
├── static/js/
│   └── signaling-client.js   # Frontend signaling client
├── templates/
│   ├── pc.html               # Updated with signaling client
│   └── mobile.html           # Updated with signaling client
├── INTEGRATION_EXAMPLE.md    # Code integration examples
└── P2P_SETUP.md             # Detailed setup guide
```

## 🔧 How It Works

1. **PC** → Generates session → Shows QR code
2. **Mobile** → Scans QR → Gets session ID
3. **Both** → Connect to signaling server → Join session
4. **Signaling** → Matches peers → Starts WebRTC negotiation
5. **WebRTC** → Direct P2P connection → Files transfer peer-to-peer

## 🐛 Troubleshooting

**Server not connecting?**
- Check Railway URL is correct
- Verify `SIGNALING_SERVER_URL` is set
- Check Railway logs

**No peer connection?**
- Verify both use same signaling server
- Check browser console for errors
- Ensure session IDs match

**Files not transferring?**
- WebRTC connection may be blocked
- Check STUN servers are accessible
- Try different network

## 📚 More Info

- **Detailed Setup**: See `P2P_SETUP.md`
- **Code Examples**: See `INTEGRATION_EXAMPLE.md`
- **Server Docs**: See `signaling-server/README.md`
- **Deployment**: See `signaling-server/DEPLOYMENT.md`

