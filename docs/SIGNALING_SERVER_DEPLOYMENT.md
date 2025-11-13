# Deployment Guide - WebRTC Signaling Server

This guide covers deploying the signaling server to Railway and other cloud platforms.

## Railway Deployment

### Step 1: Prepare Your Repository

1. Make sure your `signaling-server` folder is in your repository root
2. Ensure `package.json` and `server.js` are in the `signaling-server` directory

### Step 2: Deploy to Railway

1. **Go to Railway**: https://railway.com/new/github
2. **Connect your GitHub repository**
3. **Create a new service**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
4. **Configure the service**:
   - **Root Directory**: Set to `signaling-server` (if Railway asks)
   - **Build Command**: `npm install` (usually auto-detected)
   - **Start Command**: `npm start` (usually auto-detected)
5. **Set Environment Variables** (if needed):
   - Railway automatically sets `PORT`, so you don't need to configure it
6. **Deploy**: Railway will automatically deploy your service

### Step 3: Get Your Server URL

After deployment, Railway will provide you with a public URL like:
- `https://your-app-name.up.railway.app`

Your WebSocket URL will be:
- `wss://your-app-name.up.railway.app` (for secure connections)
- `ws://your-app-name.up.railway.app` (for non-secure connections)

### Step 4: Configure Your Frontend

Update your Flask app's configuration to use the signaling server URL:

```python
# In app.py or config file
SIGNALING_SERVER_URL = os.environ.get('SIGNALING_SERVER_URL', 'wss://your-app-name.up.railway.app')
```

Or pass it directly to your frontend templates:

```python
# In your Flask route
return render_template('pc.html', 
    signaling_server_url=os.environ.get('SIGNALING_SERVER_URL', ''))
```

## Alternative: Heroku Deployment

### Step 1: Install Heroku CLI

```bash
# Install Heroku CLI from https://devcenter.heroku.com/articles/heroku-cli
```

### Step 2: Create Heroku App

```bash
cd signaling-server
heroku create your-app-name
```

### Step 3: Deploy

```bash
git subtree push --prefix signaling-server heroku main
```

Or use Heroku Git:

```bash
cd signaling-server
heroku git:remote -a your-app-name
git push heroku main
```

## Environment Variables

The server uses the following environment variables:

- `PORT` - Server port (automatically set by Railway/Heroku)
- No other configuration needed!

## Testing the Deployment

1. **Health Check**:
   ```bash
   curl https://your-app-name.up.railway.app/health
   ```
   
   Should return:
   ```json
   {
     "status": "ok",
     "sessions": 0,
     "timestamp": "2024-01-01T00:00:00.000Z"
   }
   ```

2. **WebSocket Connection Test**:
   Use a WebSocket testing tool or browser console:
   ```javascript
   const ws = new WebSocket('wss://your-app-name.up.railway.app');
   ws.onopen = () => console.log('Connected!');
   ```

## Troubleshooting

### Port Issues
- Railway/Heroku automatically sets `PORT` - don't override it
- The server logs the port on startup - check logs if issues occur

### Connection Issues
- Ensure your Railway service is running (check dashboard)
- Verify the WebSocket URL uses `wss://` for HTTPS sites
- Check browser console for connection errors

### CORS Issues
- The server doesn't enforce CORS (WebSocket connections don't use CORS)
- If you see CORS errors, they're likely from your Flask app, not the signaling server

## Monitoring

### Railway Dashboard
- View logs: Railway dashboard → Your service → Logs
- Monitor metrics: Railway dashboard → Your service → Metrics

### Health Check Endpoint
Monitor server health:
```bash
curl https://your-app-name.up.railway.app/health
```

## Scaling

Railway automatically handles scaling. For high-traffic scenarios:
- Consider using Railway's paid plans for better performance
- Monitor connection counts in your application logs
- Sessions are stored in memory - restart clears all sessions (this is fine for signaling)

## Security Notes

- The signaling server only relays messages - it doesn't store or inspect file data
- WebRTC connections are peer-to-peer after establishment
- Consider adding authentication if you want to restrict access
- Use HTTPS/WSS in production (Railway provides this automatically)

