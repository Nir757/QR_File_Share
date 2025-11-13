# Deploy Flask App to Railway (Second Service)

## Current Setup

You already have:
- ✅ **Service 1**: Signaling Server
  - Root Directory: `signaling-server`
  - URL: `wss://qrfileshare-production.up.railway.app`

You need to add:
- ⏳ **Service 2**: Flask App (this guide)

## Step-by-Step: Add Flask App Service

### Step 1: Add New Service to Same Project

1. Go to Railway dashboard: https://railway.app
2. Open your **existing project** (the one with the signaling server)
3. Click **"+ New"** button (top right)
4. Select **"GitHub Repo"**
5. Choose your `QR_File_Share` repository

### Step 2: Configure the NEW Service

**Important**: This is a DIFFERENT service from your signaling server!

1. **Service Name**: Name it something like "QR File Share Flask" or "Flask App"
2. **Root Directory**: Leave as `.` (root) - DO NOT set to `signaling-server`
3. Railway will auto-detect Python and use `requirements.txt`

### Step 3: Set Environment Variables

In the NEW Flask app service → Variables tab, add:

```
SIGNALING_SERVER_URL=wss://qrfileshare-production.up.railway.app
```

**Note**: Don't set `PUBLIC_APP_URL` yet - wait for Railway to provide the URL first.

### Step 4: Deploy

Railway will automatically:
- Detect Python
- Run `pip install -r requirements.txt`
- Start with `python app.py`
- Provide a public URL (e.g., `https://qrfileshare-flask.up.railway.app`)

### Step 5: Update PUBLIC_APP_URL (After Deployment)

1. Copy your NEW Flask app URL from Railway (e.g., `https://qrfileshare-flask.up.railway.app`)
2. Go to Variables → Add new variable:
   ```
   PUBLIC_APP_URL=https://qrfileshare-flask.up.railway.app
   ```
3. Railway will automatically redeploy

## Your Final Setup

You'll have **TWO services** in the same Railway project:

```
Railway Project: QR File Share
├── Service 1: Signaling Server
│   ├── Root: signaling-server
│   ├── URL: wss://qrfileshare-production.up.railway.app
│   └── Port: 3000 (auto)
│
└── Service 2: Flask App
    ├── Root: . (root)
    ├── URL: https://qrfileshare-flask.up.railway.app (example)
    └── Port: 5000 (auto)
```

## Testing

1. Open your Flask app Railway URL
2. Generate a session
3. QR code should show Railway URL (not local IP)
4. Scan from any network - works!

## Troubleshooting

**"I only see one service"**
- You need to ADD a second service to the same project
- Click "+ New" in your Railway project

**"Which root directory?"**
- Service 1 (Signaling): `signaling-server`
- Service 2 (Flask): `.` (root)

**"QR code still shows local IP"**
- Make sure you're accessing the Railway Flask URL (not localhost)
- Check that `PUBLIC_APP_URL` is set correctly
- Check Railway logs to see what URL is being used

## Cost

Both services count toward your Railway usage, but the free tier ($5 credit, 500 hours) should be enough for personal use.

