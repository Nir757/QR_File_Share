# QR File Share

A web-based file sharing application that allows you to share files between your PC and mobile device by scanning a QR code. **No mobile app download required** - your phone uses the web browser!

## Features

- 📱 **No Mobile App**: Works entirely in your phone's web browser - no app store download needed
- 🔗 **Cross-Network**: Share files even when devices are on different networks (when configured)
- 🏠 **LAN Mode**: Fast local network sharing when devices are on the same WiFi
- 🎨 **Modern UI**: Beautiful, responsive interface
- ⚡ **Fast**: Uses WebRTC for peer-to-peer file transfer
- ✅ **File Approval**: Choose which files to download or reject

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
- **QR code not scanning**: Ensure good lighting and hold phone steady
- **Connection timeout**: Check your internet connection

### Port Issues

- **Port 5000 already in use**: Change the port in `app.py` or stop the other service
- **Firewall blocking**: Allow Python through your firewall

## Notes

- The app uses Google's STUN servers for NAT traversal
- Large files may take time to transfer depending on network speed
- Both devices need to be connected to the internet (for cross-network mode)

## Requirements

- Python 3.7+
- Modern web browser with WebRTC support
- Camera access on mobile device for QR scanning

## For Developers

If you want to set up cross-network mode or deploy your own instance:

- [Deploy Flask App to Railway](docs/FLASK_RAILWAY_DEPLOYMENT.md)
- [Deploy Signaling Server to Railway](docs/SIGNALING_SERVER_DEPLOYMENT.md)
- [P2P Setup Guide](docs/P2P_SETUP.md)

## License

This project is open source and available for personal use.
