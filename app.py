from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import qrcode
import io
import base64
import uuid
import os
import socket
import webbrowser
import threading
import time
import sys
import subprocess
from pathlib import Path

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Get signaling server URL from environment variable (for cross-network P2P support)
# Set this to your Railway signaling server URL, e.g., 'wss://your-app.up.railway.app'
# Leave empty to use Socket.IO (existing LAN mode)
_signaling_url_raw = os.environ.get('SIGNALING_SERVER_URL', 'wss://qrfileshare-production.up.railway.app')
# Clean up if someone accidentally included the variable name in the value
if 'SIGNALING_SERVER_URL=' in _signaling_url_raw:
    SIGNALING_SERVER_URL = _signaling_url_raw.split('SIGNALING_SERVER_URL=')[-1].strip()
    print(f"⚠️  WARNING: SIGNALING_SERVER_URL contained variable name. Cleaned to: {SIGNALING_SERVER_URL}")
else:
    SIGNALING_SERVER_URL = _signaling_url_raw

# Public URL for Flask app (for cross-network access)
# Set this if you deploy Flask app to Railway/Heroku, or use ngrok
# Example: 'https://your-flask-app.up.railway.app' or 'https://abc123.ngrok.io'
# Leave empty to use local IP (LAN only)
_public_url_raw = os.environ.get('PUBLIC_APP_URL', '')
# Ensure it has https:// prefix if it's a Railway URL
if _public_url_raw and not _public_url_raw.startswith('http://') and not _public_url_raw.startswith('https://'):
    if '.railway.app' in _public_url_raw or '.ngrok.io' in _public_url_raw:
        PUBLIC_APP_URL = 'https://' + _public_url_raw
        print(f"⚠️  Added https:// prefix to PUBLIC_APP_URL: {PUBLIC_APP_URL}")
    else:
        PUBLIC_APP_URL = _public_url_raw
else:
    PUBLIC_APP_URL = _public_url_raw

# Store active sessions
sessions = {}

def get_local_ip():
    """Get the local IP address of this machine"""
    try:
        # Connect to a remote address to determine local IP
        # This doesn't actually send data, just determines the route
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        # Fallback: try to get hostname IP
        try:
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            if ip.startswith("127."):
                return None
            return ip
        except Exception:
            return None

@app.route('/')
def index():
    """PC side - shows QR code"""
    return render_template('pc.html', 
        signaling_server_url=SIGNALING_SERVER_URL,
        public_app_url=PUBLIC_APP_URL)

@app.route('/mobile')
def mobile():
    """Mobile side - QR scanner"""
    return render_template('mobile.html', signaling_server_url=SIGNALING_SERVER_URL)

@app.route('/debug')
def debug():
    """Debug page for troubleshooting"""
    return render_template('debug.html')

@app.route('/api/health-check')
def health_check():
    """Simple health check endpoint for mode switching"""
    return jsonify({'status': 'ok', 'mode': 'local'})

@app.route('/api/generate-session', methods=['POST'])
def generate_session():
    """Generate a new session and QR code"""
    session_id = str(uuid.uuid4())
    
    # Get the base URL for QR code
    # Priority: PUBLIC_APP_URL > Railway URL (from request) > local IP
    if PUBLIC_APP_URL:
        # Use explicitly set public URL for cross-network access
        host_url = PUBLIC_APP_URL.rstrip('/') + '/'
        print(f"Using PUBLIC_APP_URL for QR code: {host_url}")
    elif request.host_url.startswith('https://') and '.railway.app' in request.host_url:
        # Running on Railway - use Railway URL
        host_url = request.host_url
        print(f"Using Railway URL from request: {host_url}")
    elif '127.0.0.1' in request.host_url or 'localhost' in request.host_url:
        # Running locally - use local IP for LAN access
        local_ip = get_local_ip()
        if local_ip:
            host_url = f"http://{local_ip}:5000/"
            print(f"Using local IP for QR code: {host_url}")
        else:
            # If we can't get IP, show a message (handled in frontend)
            return jsonify({
                'error': 'Could not determine local IP address. Please set PUBLIC_APP_URL environment variable for cross-network access, or access this page using your local IP address directly.'
            }), 500
    else:
        # Use the request host URL (might be a public URL already)
        host_url = request.host_url
        print(f"Using request host URL for QR code: {host_url}")
    
    # Create QR code with session URL
    qr_url = f"{host_url}mobile?session={session_id}"
    
    # Generate QR code with higher quality settings for better phone scanning
    qr = qrcode.QRCode(
        version=None,  # Auto-determine version based on data
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # High error correction (30%)
        box_size=15,  # Larger box size for better scanning (increased from 12)
        border=4,  # Border around QR code
    )
    qr.add_data(qr_url)
    qr.make(fit=True)
    
    # Create image with higher DPI for better quality
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Resize image to ensure minimum size for phone cameras (at least 300x300px)
    from PIL import Image
    min_size = 400  # Minimum size in pixels
    if img.size[0] < min_size or img.size[1] < min_size:
        # Calculate scale factor to reach minimum size
        scale = max(min_size / img.size[0], min_size / img.size[1])
        new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    
    qr_code_data = base64.b64encode(buffer.getvalue()).decode()
    
    sessions[session_id] = {
        'pc_connected': False,
        'mobile_connected': False,
        'pc_sid': None,
        'mobile_sid': None
    }
    
    return jsonify({
        'session_id': session_id,
        'qr_code': qr_code_data,
        'qr_url': qr_url  # Return URL for display
    })

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    # Clean up session if client disconnects
    for session_id, session in sessions.items():
        if session['pc_sid'] == request.sid:
            session['pc_connected'] = False
            session['pc_sid'] = None
            socketio.emit('pc_disconnected', room=session['mobile_sid'])
        elif session['mobile_sid'] == request.sid:
            session['mobile_connected'] = False
            session['mobile_sid'] = None
            socketio.emit('mobile_disconnected', room=session['pc_sid'])

@socketio.on('pc_join')
def handle_pc_join(data):
    session_id = data.get('session_id')
    if session_id in sessions:
        join_room(session_id)
        sessions[session_id]['pc_connected'] = True
        sessions[session_id]['pc_sid'] = request.sid
        emit('pc_ready', {'session_id': session_id})
        
        # If mobile is already connected, notify both
        if sessions[session_id]['mobile_connected']:
            emit('peer_connected', room=session_id)

@socketio.on('mobile_join')
def handle_mobile_join(data):
    session_id = data.get('session_id')
    print(f'Mobile join request for session: {session_id}')
    
    if not session_id:
        print('No session_id provided')
        emit('error', {'message': 'No session ID provided'})
        return
    
    if session_id not in sessions:
        print(f'Session {session_id} not found')
        emit('error', {'message': 'Session not found. Please scan the QR code again.'})
        return
    
    join_room(session_id)
    sessions[session_id]['mobile_connected'] = True
    sessions[session_id]['mobile_sid'] = request.sid
    emit('mobile_ready', {'session_id': session_id})
    print(f'Mobile connected to session {session_id}')
    
    # If PC is already connected, notify both
    if sessions[session_id]['pc_connected']:
        print(f'PC already connected, notifying both peers')
        emit('peer_connected', room=session_id)

@socketio.on('webrtc_offer')
def handle_webrtc_offer(data):
    """Forward WebRTC offer to the other peer"""
    session_id = data.get('session_id')
    offer = data.get('offer')
    socketio.emit('webrtc_offer', {'offer': offer}, room=session_id, include_self=False)

@socketio.on('webrtc_answer')
def handle_webrtc_answer(data):
    """Forward WebRTC answer to the other peer"""
    session_id = data.get('session_id')
    answer = data.get('answer')
    socketio.emit('webrtc_answer', {'answer': answer}, room=session_id, include_self=False)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    """Forward ICE candidate to the other peer"""
    session_id = data.get('session_id')
    candidate = data.get('candidate')
    socketio.emit('ice_candidate', {'candidate': candidate}, room=session_id, include_self=False)

def open_browser():
    """Open the browser after a short delay to allow the server to start"""
    time.sleep(1.5)  # Wait for server to start
    webbrowser.open('http://127.0.0.1:5000')

if __name__ == '__main__':
    # Get port from environment variable (Railway, Heroku, etc.) or default to 5000
    port = int(os.environ.get('PORT', 5000))
    
    
    # Only open browser if not in reloader subprocess (prevents double opening in debug mode)
    # And only if running locally (not on Railway/Heroku)
    if os.environ.get('WERKZEUG_RUN_MAIN') != 'true' and not os.environ.get('PORT'):
        # Open browser in a separate thread
        threading.Thread(target=open_browser, daemon=True).start()
    
    # Debug mode only for local development
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true' and not os.environ.get('PORT')
    
    print("\n" + "="*50)
    print("QR File Share Server Starting...")
    print("="*50)
    if os.environ.get('PORT'):
        print(f"Running on Railway/Cloud - Port: {port}")
        print(f"Public URL will be provided by Railway")
    else:
        print(f"🏠 LAN Mode (Local Network Only)")
        print(f"Running locally - Port: {port}")
        print(f"Server will open automatically in your browser")
        print(f"If it doesn't open, visit: http://127.0.0.1:{port}")
        print(f"Local IP: http://{get_local_ip()}:{port}" if get_local_ip() else "Could not determine local IP")
        print(f"\n💡 Tip: Use 'python launcher.py' to open Railway URL automatically")
    print("="*50 + "\n")
    socketio.run(app, host='0.0.0.0', port=port, debug=debug_mode, allow_unsafe_werkzeug=True)

