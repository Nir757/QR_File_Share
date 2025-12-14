"""
Configuration file for QR File Share
Set your cloud Flask app URL here for cross-network mode
"""

# Cloud Flask App URL (for cross-network mode)
# This is the live Koyeb deployment URL
# Leave empty to use local mode only
CLOUD_APP_URL = 'https://qrfileshare.koyeb.app'

# Note: If deploying your own instance, update this URL to match your deployment
# For Koyeb: https://your-service-name.koyeb.app

# Default mode: 'cloud' (cross-network) or 'local' (LAN only)
DEFAULT_MODE = 'cloud'

