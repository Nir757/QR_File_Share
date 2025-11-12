# QR File Share

A web-based file sharing application that allows you to share files between your PC and mobile device by scanning a QR code. **No mobile app download required** - your phone uses the web browser! The PC needs a simple one-time setup.

## Features

- 📱 **No Mobile App**: Works entirely in your phone's web browser - no app store download needed
- 💻 **Easy PC Setup**: Simple launcher handles everything automatically (one-time setup)
- 🔗 **Cross-network**: Share files even when devices are on different networks
- 🎨 **Modern UI**: Beautiful, responsive interface
- ⚡ **Fast**: Uses WebRTC for peer-to-peer file transfer
- ✅ **File Approval**: Choose which files to download or reject

## How It Works

1. **PC Side**: Open the app on your computer - it will display a QR code
2. **Mobile Side**: Scan the QR code with your phone's camera
3. **Connection**: The devices establish a WebRTC connection through a signaling server
4. **File Sharing**: Both devices can send and receive files instantly

## Installation

### PC Setup (One-time)

**Windows Users:**
- Double-click `launcher.bat` - it will automatically install requirements on first launch!

**Mac/Linux Users:**
- Run `python launcher.py` or make it executable: `chmod +x launcher.py && ./launcher.py`

The launcher will:
- ✅ Install all Python requirements automatically on first launch
- ✅ Open the app in your browser automatically
- ✅ Skip installation on subsequent launches (just opens the app)

**Note:** The PC needs Python installed. The mobile device needs nothing - just a web browser!

### Manual PC Setup (Alternative)

If you prefer manual setup:

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Run the server:
```bash
python app.py
```

### Mobile Setup

**No installation needed!** Just scan the QR code with your phone's camera when the PC app is running.

## Usage

### On PC:
1. Open `http://localhost:5000` in your browser
2. Wait for the QR code to appear
3. Once connected, select files and click "Send Files"

### On Mobile:
1. Scan the QR code displayed on your PC
2. Allow camera access when prompted
3. Once connected, select files and click "Send Files"

## Technical Details

- **Backend**: Flask with Flask-SocketIO for WebSocket signaling
- **Frontend**: Vanilla JavaScript with WebRTC API
- **File Transfer**: WebRTC Data Channels for peer-to-peer transfer
- **QR Code**: Python qrcode library for generation, QR-Scanner.js for scanning

## Cross-Network Setup

For devices on different networks to connect:

1. **Option 1: Use your public IP** (requires router port forwarding)
   - Find your public IP: `https://whatismyipaddress.com`
   - Set up port forwarding on your router for port 5000
   - Update `app.py` to use your public IP in QR code generation

2. **Option 2: Use ngrok** (easiest for testing)
   ```bash
   ngrok http 5000
   ```
   - Use the ngrok URL in the QR code generation

3. **Option 3: Deploy to a cloud server** (best for production)
   - Deploy to Heroku, AWS, or similar
   - The app will work across any network

## Notes

- For production use, change the `SECRET_KEY` in `app.py`
- The app uses Google's STUN servers for NAT traversal
- Large files may take time to transfer depending on network speed
- Both devices need to be connected to the internet
- On the same local network, the app works immediately without additional setup

## Requirements

- Python 3.7+
- Modern web browser with WebRTC support
- Camera access on mobile device for QR scanning

