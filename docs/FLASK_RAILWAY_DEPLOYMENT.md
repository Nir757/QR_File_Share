# Deploy Flask App to Railway

## Quick Deployment Steps

### Step 1: Create New Railway Service

1. Go to Railway dashboard: https://railway.app
2. Click "New Project" (or add to existing project)
3. Select "Deploy from GitHub repo"
4. Choose your `QR_File_Share` repository

### Step 2: Configure Service

1. **Root Directory**: Leave as `.` (root) - Railway will detect Python automatically
2. **Build Command**: `pip install -r requirements.txt` (auto-detected)
3. **Start Command**: `python app.py` (auto-detected)

### Step 3: Set Environment Variables

In Railway dashboard, go to your Flask app service → Variables tab, add:

```
SIGNALING_SERVER_URL=wss://qrfileshare-production.up.railway.app
PUBLIC_APP_URL=https://your-flask-app-name.up.railway.app
```

**Important**: Set `PUBLIC_APP_URL` AFTER Railway provides your app URL (it will be something like `https://your-app-name.up.railway.app`)

### Step 4: Deploy

Railway will automatically:
- Install Python dependencies
- Start your Flask app
- Provide a public URL

### Step 5: Update PUBLIC_APP_URL

1. Copy your Railway Flask app URL (e.g., `https://qrfileshare-flask.up.railway.app`)
2. Go to Variables → Edit `PUBLIC_APP_URL`
3. Set it to your Railway URL
4. Railway will automatically redeploy

## How It Works

1. **Flask App** (Railway) → Generates QR codes with Railway URL
2. **Signaling Server** (Railway) → Handles WebRTC signaling
3. **Both accessible** from anywhere → Cross-network P2P works!

## Testing

1. Open your Railway Flask app URL (e.g., `https://qrfileshare-flask.up.railway.app`)
2. Generate a session - QR code should show Railway URL
3. Scan from any network - should work!

## Troubleshooting

### Port Issues
- Railway automatically sets `PORT` environment variable
- The app now uses `PORT` if set, otherwise defaults to 5000

### QR Code Still Shows Local IP
- Make sure `PUBLIC_APP_URL` is set correctly
- Check Railway logs to see what URL is being used
- Restart the service after setting `PUBLIC_APP_URL`

### Connection Issues
- Verify both services are running (check Railway dashboard)
- Check that `SIGNALING_SERVER_URL` points to your signaling server
- Use `/debug` page to troubleshoot

## Cost

Railway free tier includes:
- $5 credit per month
- 500 hours of usage
- Should be enough for personal use

## Architecture

```
┌─────────────────────────────────────────┐
│         Railway Platform                │
│                                         │
│  ┌──────────────────┐  ┌─────────────┐│
│  │  Flask App       │  │  Signaling  ││
│  │  (Port 5000)     │  │  Server     ││
│  │                  │  │  (Port 3000)││
│  │  Generates QR    │  │  WebSocket  ││
│  │  codes           │  │  signaling ││
│  └──────────────────┘  └─────────────┘│
│           │                    │        │
└───────────┼────────────────────┼────────┘
            │                    │
            │                    │
    ┌───────▼────────┐   ┌───────▼────────┐
    │  PC Browser    │   │ Mobile Browser │
    │  (Anywhere)    │   │  (Anywhere)    │
    └────────────────┘   └────────────────┘
```

Both services on Railway = Full cross-network support! 🚀

