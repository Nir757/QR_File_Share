# Deploying QR File Share to Koyeb

This guide will walk you through deploying your QR File Share application to Koyeb.

## Overview

Your application consists of TWO services that need to be deployed separately:
1. **Flask App** (Python) - Main web application
2. **Signaling Server** (Node.js) - WebRTC signaling server

## Prerequisites

- Koyeb account (free tier works)
- Your code pushed to a Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Deploy the Signaling Server (Node.js)

### 1.1 Create the Signaling Server Service

1. Log into your **Koyeb Dashboard**: https://app.koyeb.com/
2. Click **"Create Service"**
3. Choose **"GitHub"** (or your Git provider)
4. Select your **QrFileShare** repository
5. Click **"Next"**

### 1.2 Configure the Signaling Server

Fill in these settings:

**Builder**: `Buildpack`

**Build and deployment settings**:
- **Root directory**: `signaling-server`
- **Build command**: `npm install`
- **Run command**: `npm start`

**Instance**:
- **Type**: `Nano` (free tier - 512MB RAM)
- **Regions**: Choose closest to your users

**Service name**: `qrfileshare-signaling`

**Exposed ports**:
- Port: `8000` (Koyeb default)
- Protocol: `HTTP`

**Environment Variables**: None needed for signaling server

### 1.3 Deploy

1. Click **"Deploy"**
2. Wait for deployment to complete (2-3 minutes)
3. **IMPORTANT**: Copy the deployment URL - it will look like:
   - `https://qrfileshare-signaling-YOUR-ORG.koyeb.app`
4. **Save this URL** - you'll need it for the Flask app!

---

## Step 2: Deploy the Flask App (Python)

### 2.1 Create the Flask App Service

1. In Koyeb Dashboard, click **"Create Service"** again
2. Choose **"GitHub"** (or your Git provider)
3. Select your **QrFileShare** repository
4. Click **"Next"**

### 2.2 Configure the Flask App

Fill in these settings:

**Builder**: `Buildpack`

**Build and deployment settings**:
- **Root directory**: `/` (leave as root - NOT signaling-server)
- **Build command**: Leave empty
- **Run command**: `python app.py`

**Instance**:
- **Type**: `Nano` (free tier - 512MB RAM)
- **Regions**: Choose the SAME region as signaling server

**Service name**: `qrfileshare`

**Exposed ports**:
- Port: `8000` (Koyeb default)
- Protocol: `HTTP`

**Environment Variables** (Click "Add Variable" for each):

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `PORT` | `8000` | Koyeb default port |
| `SECRET_KEY` | `your-secret-key-here` | Generate with: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `PUBLIC_APP_URL` | `https://qrfileshare-YOUR-ORG.koyeb.app` | **WAIT**: You'll get this AFTER deployment |
| `SIGNALING_SERVER_URL` | `wss://qrfileshare-signaling-YOUR-ORG.koyeb.app` | Use URL from Step 1.3 (change `https` to `wss`) |
| `TURN_USERNAME` | `your-metered-username` | Get from https://www.metered.ca dashboard |
| `TURN_PASSWORD` | `your-metered-password` | Get from https://www.metered.ca dashboard |
| `FLASK_DEBUG` | `False` | Keep as False for production |

**IMPORTANT NOTES**:
- For `SIGNALING_SERVER_URL`: Take the URL from Step 1.3 and replace `https://` with `wss://`
  - Example: `wss://qrfileshare-signaling-my-org.koyeb.app`
- For `PUBLIC_APP_URL`: You'll update this in Step 2.4 after first deployment

### 2.3 First Deployment

1. Click **"Deploy"**
2. Wait for deployment to complete (3-5 minutes)
3. Once deployed, copy the Flask app URL:
   - `https://qrfileshare-YOUR-ORG.koyeb.app`

### 2.4 Update PUBLIC_APP_URL

Now that you have the Flask app URL:

1. Go to your Flask service in Koyeb
2. Click **"Settings"** tab
3. Scroll to **"Environment Variables"**
4. Find `PUBLIC_APP_URL`
5. Click **"Edit"**
6. Update the value to: `https://qrfileshare-YOUR-ORG.koyeb.app` (your actual URL)
7. Click **"Save"**
8. The service will automatically redeploy (takes 2-3 minutes)

---

## Step 3: Update Local Configuration (Optional)

If you want to run the app locally and use the cloud servers:

1. Open `config.py` in your project
2. Update `CLOUD_APP_URL` to your Flask app URL:
   ```python
   CLOUD_APP_URL = 'https://qrfileshare-YOUR-ORG.koyeb.app'
   ```
3. Save the file

---

## Step 4: Test Your Deployment

### 4.1 Test the Signaling Server

1. Open in browser: `https://qrfileshare-signaling-YOUR-ORG.koyeb.app/health`
2. You should see: `{"status":"ok","sessions":0,"timestamp":"..."}`
3. ✅ If you see this, signaling server is working!

### 4.2 Test the Flask App

1. Open in browser: `https://qrfileshare-YOUR-ORG.koyeb.app`
2. You should see the QR File Share interface
3. Click to generate a QR code
4. Scan with your phone
5. ✅ Test file transfer!

---

## Troubleshooting

### Issue: "Session not found" error on mobile

**Solution**: Make sure `SIGNALING_SERVER_URL` is set correctly and uses `wss://` (not `https://`)

### Issue: QR code doesn't load

**Solution**: 
1. Check that `PUBLIC_APP_URL` is set correctly in Flask app environment variables
2. Make sure the URL matches your actual Koyeb deployment URL

### Issue: Files won't transfer

**Solution**:
1. Verify both TURN credentials are set correctly
2. Check signaling server is running: visit `/health` endpoint
3. Make sure PC and mobile are both connecting to the cloud app

### Issue: Service won't start

**Solution**:
1. Check Koyeb logs: Service → Logs tab
2. Verify all environment variables are set
3. For Flask app: Make sure `PORT=8000`
4. For Signaling server: Check `npm install` completed successfully

---

## Environment Variables Summary

### Flask App Variables:
```
PORT=8000
SECRET_KEY=your-secret-key-here
PUBLIC_APP_URL=https://qrfileshare-YOUR-ORG.koyeb.app
SIGNALING_SERVER_URL=wss://qrfileshare-signaling-YOUR-ORG.koyeb.app
TURN_USERNAME=your-metered-username
TURN_PASSWORD=your-metered-password
FLASK_DEBUG=False
```

### Signaling Server Variables:
```
(No environment variables needed - uses PORT automatically from Koyeb)
```

---

## Cost

- **Free Tier**: Both services can run on Koyeb's free tier (Nano instances)
- **No credit card required** for free tier

---

## Next Steps

1. ✅ Both services deployed
2. ✅ Test the application
3. 🎉 Share the URL with anyone, anywhere!

Your app is now accessible from anywhere in the world at:
- **https://qrfileshare-YOUR-ORG.koyeb.app**

---

## Additional Notes

### Custom Domain (Optional)
You can add a custom domain in Koyeb:
1. Service → Settings → Domains
2. Click "Add Domain"
3. Follow DNS configuration instructions

### Monitoring
- View logs: Service → Logs
- View metrics: Service → Metrics
- Health checks run automatically

### Scaling
If you need more resources:
1. Service → Settings → Instance
2. Upgrade to Small/Medium instance
3. Click "Update Service"

