from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import qrcode
import io
import base64
import uuid
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Store active sessions
sessions = {}

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
    
    # Create QR code with session URL
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(f"{request.host_url}mobile?session={session_id}")
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
    if session_id in sessions:
        join_room(session_id)
        sessions[session_id]['mobile_connected'] = True
        sessions[session_id]['mobile_sid'] = request.sid
        emit('mobile_ready', {'session_id': session_id})
        
        # If PC is already connected, notify both
        if sessions[session_id]['pc_connected']:
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

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)

