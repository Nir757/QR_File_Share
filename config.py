"""
Configuration file for QR File Share
Set your Railway Flask app URL here for cross-network mode
"""

# Railway Flask App URL (for cross-network mode)
# Set this to your Railway Flask app URL, e.g., 'https://flask-app-production-10c0.up.railway.app'
# Leave empty to use local mode
RAILWAY_APP_URL = 'https://flask-app-production-10c0.up.railway.app'

# Note: Update this URL to match your actual Railway Flask app URL
# You can find it in Railway dashboard → Your Flask App Service → Settings → Domains

# Default mode: 'railway' (cross-network) or 'local' (LAN only)
DEFAULT_MODE = 'railway'

