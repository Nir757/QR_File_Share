# QR File Share

A web-based file sharing application that allows you to share files between your PC and mobile device by scanning a QR code. **No mobile app download required** - your phone uses the web browser!

## Features

- 📱 **No Mobile App**: Works entirely in your phone's web browser - no app store download needed
- 🔗 **Cross-Network**: Share files even when devices are on different networks (via Railway)
- 🏠 **LAN Mode**: Fast local network sharing when devices are on the same WiFi
- 🎨 **Modern UI**: Beautiful, responsive interface
- ⚡ **Fast**: Uses WebRTC for peer-to-peer file transfer
- ✅ **File Approval**: Choose which files to download or reject

## How It Works

1. **PC Side**: Run the app on your computer - it will display a QR code
2. **Mobile Side**: Scan the QR code with your phone's camera
3. **Connection**: The devices establish a WebRTC connection through a signaling server
4. **File Sharing**: Both devices can send and receive files instantly

## Quick Start

### Prerequisites

- Python 3.7+ installed on your PC
- Modern web browser with WebRTC support
- Camera access on mobile device for QR scanning

### Step 1: Clone or Download

```bash
git clone https://github.com/Nir757/QR_File_Share.git
cd QR_File_Share/qrfileshare
```

Or download the ZIP file from GitHub and extract it.

### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Run the App

```bash
python app.py
```

When running locally, you'll be prompted to choose a mode:

1. **🌐 Cross-Network Mode (Railway)** - Works from anywhere (default, auto-selects after 5 seconds)
2. **🏠 LAN Mode (Local)** - Same network only

The app will:
- Auto-select Cross-Network Mode after 5 seconds (or press Enter to choose manually)
- Open your browser automatically
- Display a QR code for your mobile device to scan

### Step 4: Connect Your Mobile Device

1. **On Mobile**: Scan the QR code displayed on your PC with your phone's camera
2. **Allow camera access** when prompted
3. **Wait for connection** - both devices will show "Connected" when ready
4. **Share files**: Select files and click "Send Files"

## Usage

### Sending Files from PC to Mobile

1. Drag & drop files onto the app, or click to browse
2. Click "Send Files"
3. Mobile device will receive a notification for each file
4. Approve or reject files on mobile

### Sending Files from Mobile to PC

1. Tap "Select Files" on mobile
2. Choose files from your phone
3. Tap "Send Files"
4. PC will receive files automatically

## Configuration

### Cross-Network Mode Setup

To use cross-network mode (works from anywhere), you need:

1. **Railway Account** (free tier available)
2. **Deploy the Flask app** to Railway (see [docs/FLASK_RAILWAY_DEPLOYMENT.md](docs/FLASK_RAILWAY_DEPLOYMENT.md))
3. **Deploy the signaling server** to Railway (see [docs/SIGNALING_SERVER_DEPLOYMENT.md](docs/SIGNALING_SERVER_DEPLOYMENT.md))
4. **Configure `config.py`**:
   ```python
   RAILWAY_APP_URL = 'https://your-app.up.railway.app'
   ```

### LAN Mode

LAN mode works automatically when both devices are on the same WiFi network. No additional configuration needed!

## Project Structure

```
qrfileshare/
├── app.py                 # Main Flask application
├── config.py              # Configuration (Railway URL, etc.)
├── requirements.txt       # Python dependencies
├── railway.json          # Railway deployment config
├── runtime.txt           # Python version
├── static/               # Frontend assets
│   ├── js/              # JavaScript files
│   ├── css/             # Stylesheets
│   └── images/          # Images
├── templates/            # HTML templates
├── signaling-server/     # Node.js WebSocket signaling server
└── docs/                 # Documentation
```

## Documentation

- [Deploy Flask App to Railway](docs/FLASK_RAILWAY_DEPLOYMENT.md)
- [Deploy Signaling Server to Railway](docs/SIGNALING_SERVER_DEPLOYMENT.md)
- [P2P Setup Guide](docs/P2P_SETUP.md)
- [Quick Start P2P](docs/QUICK_START_P2P.md)

## Technical Details

- **Backend**: Flask with Flask-SocketIO for WebSocket signaling
- **Frontend**: Vanilla JavaScript with WebRTC API
- **File Transfer**: WebRTC Data Channels for peer-to-peer transfer
- **QR Code**: Python qrcode library for generation, QR-Scanner.js for scanning
- **Signaling**: Node.js WebSocket server for cross-network connections

## Troubleshooting

### Connection Issues

- **Can't connect on LAN**: Make sure both devices are on the same WiFi network
- **Can't connect cross-network**: Check that Railway services are running and URLs are correct in `config.py`
- **QR code not scanning**: Ensure good lighting and hold phone steady

### Port Issues

- **Port 5000 already in use**: Change the port in `app.py` or stop the other service
- **Firewall blocking**: Allow Python through your firewall

## Notes

- For production use, change the `SECRET_KEY` in `app.py`
- The app uses Google's STUN servers for NAT traversal
- Large files may take time to transfer depending on network speed
- Both devices need to be connected to the internet (for cross-network mode)

## Requirements

- Python 3.7+
- Modern web browser with WebRTC support
- Camera access on mobile device for QR scanning
- Node.js 14+ (for signaling server deployment)

## License

This project is open source and available for personal use.
