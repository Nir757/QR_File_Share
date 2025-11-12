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

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

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
    return render_template('pc.html')

@app.route('/mobile')
def mobile():
    """Mobile side - QR scanner"""
    return render_template('mobile.html')

@app.route('/api/generate-session', methods=['POST'])
def generate_session():
    """Generate a new session and QR code"""
    session_id = str(uuid.uuid4())
    
    # Get the base URL - use local IP if accessing via localhost
    host_url = request.host_url
    if '127.0.0.1' in host_url or 'localhost' in host_url:
        local_ip = get_local_ip()
        if local_ip:
            # Replace localhost/127.0.0.1 with actual IP
            host_url = f"http://{local_ip}:5000/"
        else:
            # If we can't get IP, show a message (handled in frontend)
            return jsonify({
                'error': 'Could not determine local IP address. Please access this page using your local IP address directly.'
            }), 500
    
    # Create QR code with session URL
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(f"{host_url}mobile?session={session_id}")
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
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
        'qr_code': qr_code_data
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
    # Only open browser if not in reloader subprocess (prevents double opening in debug mode)
    if os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        # Open browser in a separate thread
        threading.Thread(target=open_browser, daemon=True).start()
    
    print("\n" + "="*50)
    print("QR File Share Server Starting...")
    print("="*50)
    print(f"Server will open automatically in your browser")
    print(f"If it doesn't open, visit: http://127.0.0.1:5000")
    print(f"Local IP: http://{get_local_ip()}:5000" if get_local_ip() else "Could not determine local IP")
    print("="*50 + "\n")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)

