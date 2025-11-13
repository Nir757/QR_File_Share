# QR File Share

A web-based file sharing application that allows you to share files between your PC and mobile device by scanning a QR code. **No mobile app download required** - your phone uses the web browser!

## Features

- 📱 **No Mobile App**: Works entirely in your phone's web browser - no app store download needed
- 🔗 **Cross-Network**: Share files even when devices are on different networks (when configured)
- 🏠 **LAN Mode**: Fast local network sharing when devices are on the same WiFi
- 🎨 **Modern UI**: Beautiful, responsive interface
- ⚡ **Fast**: Uses WebRTC for peer-to-peer file transfer
- ✅ **File Approval**: Choose which files to download or reject
- 🔄 **Smart Reconnection**: Automatic reconnection with delay to prevent race conditions
- 📷 **Reliable QR Scanning**: Improved QR code detection with auto-restart on errors

## How It Works

1. **PC Side**: Run the app on your computer - it will display a QR code
2. **Mobile Side**: Scan the QR code with your phone's camera
3. **Connection**: The devices establish a WebRTC connection
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

### Step 2: Run the App

**Windows Users:**
- Double-click `launcher.bat` - it will automatically install requirements on first launch!

**Mac/Linux Users:**
```bash
pip install -r requirements.txt
python app.py
```

The app will:
- Install dependencies automatically (Windows) or prompt you to install (Mac/Linux)
- Prompt you to choose a mode:
  - **🌐 Cross-Network Mode** - Works from anywhere (requires Railway setup - see [For Developers](#for-developers))
  - **🏠 LAN Mode** - Same network only (works immediately!)
- Auto-select Cross-Network Mode after 5 seconds (or press Enter to choose manually)
- Open your browser automatically
- Display a QR code for your mobile device to scan

### Step 3: Connect Your Mobile Device

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

## Modes

### LAN Mode (Recommended for Local Use)

- Works when both devices are on the same WiFi network
- No additional setup required
- Fast and reliable
- Just select "LAN Mode" when starting the app

### Cross-Network Mode

- Works when devices are on different networks
- Requires Railway deployment (see [For Developers](#for-developers) section)
- Set up once, use from anywhere

## Troubleshooting

### Connection Issues

- **Can't connect on LAN**: Make sure both devices are on the same WiFi network
- **QR code not scanning**: Ensure good lighting and hold phone steady. If it doesn't work, try refreshing the page and scanning again
- **Connection timeout**: Check your internet connection
- **File picker keeps opening**: This has been fixed in recent updates. If it still happens, refresh the page
- **Disconnection issues**: Use the reconnection UI that appears when a peer disconnects - wait for the countdown before reconnecting

### Port Issues

- **Port 5000 already in use**: Change the port in `app.py` or stop the other service
- **Firewall blocking**: Allow Python through your firewall

## Recent Updates (v1.2.0)

### ✅ Improved Cross-Network Connectivity

**Status:** FIXED (as of v1.2.0)

Previous versions had unreliable cross-network connections due to overloaded free TURN servers. This has been **significantly improved** in v1.2.0!

**What Changed:**
- ✅ Replaced unreliable public TURN servers with dedicated Metered credentials
- ✅ Added multiple TURN server configurations (TCP/UDP, ports 80/443)
- ✅ Better NAT traversal success rate
- ✅ Reduced connection timeouts

**Cross-Network Mode should now work reliably** for most users!

### Known Remaining Issues

**If Cross-Network Mode still doesn't work:**

1. **Router WiFi Isolation**
   - Your router may have "AP Isolation" or "Client Isolation" enabled
   - **Solution:** Connect via Ethernet, or disable AP/Client Isolation in router settings

2. **Corporate/Strict Firewalls**
   - Some corporate networks block all WebRTC/TURN traffic
   - **Workaround:** Use LAN Mode when on the same network

3. **VPN Interference**
   - VPNs can interfere with WebRTC connections
   - **Solution:** Disconnect VPN temporarily

**Recommended:**
- ✅ **Try Cross-Network Mode first** - it should work now!
- ✅ **Use LAN Mode as backup** - faster when on same network
- ✅ **Check browser console** - look for "relay" ICE candidates

## Technical Details

- Uses **WebRTC** for peer-to-peer file transfer (end-to-end encrypted)
- **STUN servers**: Google's public STUN for NAT discovery
- **TURN servers**: Metered (dedicated credentials for reliable NAT traversal)
- **Signaling**: Railway-hosted WebSocket server for cross-network mode
- Large files transferred in 200KB chunks for reliability
- See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for full technical details

## Requirements

- Python 3.7+
- Modern web browser with WebRTC support
- Camera access on mobile device for QR scanning

## Documentation

### For Users
- [Architecture Overview](docs/ARCHITECTURE.md) - How everything works, what services are used
- [Troubleshooting Guide](docs/P2P_SETUP.md) - Common issues and solutions

### For Developers
- [Deploy Flask App to Railway](docs/FLASK_RAILWAY_DEPLOYMENT.md)
- [Deploy Signaling Server to Railway](docs/SIGNALING_SERVER_DEPLOYMENT.md)
- [P2P Setup Guide](docs/P2P_SETUP.md)
- [Quick Start P2P](docs/QUICK_START_P2P.md)

## License

This project is open source and available for personal use.
