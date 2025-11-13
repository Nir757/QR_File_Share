# Integration Example - Using the Node.js Signaling Server

This guide shows how to integrate the Node.js WebSocket signaling server with your existing QR File Share app.

## Option 1: Use Signaling Client (Recommended)

The `signaling-client.js` provides a unified interface that works with both Socket.IO (existing) and WebSocket (new).

### Step 1: Update Your Flask App

Add signaling server URL configuration:

```python
# In app.py
import os

# Get signaling server URL from environment or use default
SIGNALING_SERVER_URL = os.environ.get('SIGNALING_SERVER_URL', '')
# Example: SIGNALING_SERVER_URL = 'wss://your-signaling-server.up.railway.app'

@app.route('/')
def index():
    return render_template('pc.html', 
        signaling_server_url=SIGNALING_SERVER_URL)

@app.route('/mobile')
def mobile():
    return render_template('mobile.html',
        signaling_server_url=SIGNALING_SERVER_URL)
```

### Step 2: Update Templates

The templates already include `signaling-client.js`. Add a script tag to pass the URL:

```html
<!-- In pc.html and mobile.html, before the main script -->
<script>
    // Configure signaling server URL
    window.SIGNALING_SERVER_URL = '{{ signaling_server_url or "" }}';
</script>
```

### Step 3: Update JavaScript Files

Modify `pc.js` to use the signaling client when a URL is provided:

```javascript
// At the top of pc.js, after existing variables
let signalingClient = null;

// Replace the existing socket initialization
function initializeSignaling() {
    // Check if we should use the Node.js signaling server
    if (window.SIGNALING_SERVER_URL && window.SIGNALING_SERVER_URL.trim() !== '') {
        console.log('Using Node.js signaling server:', window.SIGNALING_SERVER_URL);
        signalingClient = new SignalingClient(
            window.SIGNALING_SERVER_URL,
            sessionId,
            'pc'
        );
        
        // Set up event handlers
        signalingClient.on('peer_connected', () => {
            document.getElementById('qr-container').classList.add('hidden');
            document.getElementById('connected-view').classList.remove('hidden');
            initializeWebRTC();
        });
        
        signalingClient.on('webrtc_offer', async (offer) => {
            await handleOffer(offer);
        });
        
        signalingClient.on('webrtc_answer', async (answer) => {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        });
        
        signalingClient.on('ice_candidate', async (candidate) => {
            if (candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        });
        
        signalingClient.on('peer_disconnected', () => {
            alert('Mobile device disconnected');
            location.reload();
        });
        
        signalingClient.connect();
    } else {
        // Fall back to existing Socket.IO implementation
        console.log('Using Socket.IO signaling (existing implementation)');
        setupSocketListeners();
    }
}

// Update generateSession to call initializeSignaling
async function generateSession() {
    // ... existing code ...
    
    // After generating session, initialize signaling
    initializeSignaling();
    
    // If using Socket.IO, still emit pc_join
    if (!signalingClient) {
        socket.emit('pc_join', { session_id: sessionId });
    }
}

// Update initializeWebRTC to use signalingClient
function initializeWebRTC() {
    // ... existing WebRTC configuration ...
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            if (signalingClient) {
                signalingClient.sendIceCandidate(event.candidate);
            } else {
                socket.emit('ice_candidate', {
                    session_id: sessionId,
                    candidate: event.candidate
                });
            }
        }
    };
    
    // Create and send offer
    peerConnection.createOffer()
        .then(offer => {
            return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
            if (signalingClient) {
                signalingClient.sendOffer(peerConnection.localDescription);
            } else {
                socket.emit('webrtc_offer', {
                    session_id: sessionId,
                    offer: peerConnection.localDescription
                });
            }
        })
        .catch(error => console.error('Error creating offer:', error));
}

// Update handleOffer to use signalingClient
async function handleOffer(offer) {
    // ... existing code ...
    
    if (signalingClient) {
        signalingClient.sendAnswer(peerConnection.localDescription);
    } else {
        socket.emit('webrtc_answer', {
            session_id: sessionId,
            answer: peerConnection.localDescription
        });
    }
}
```

Apply similar changes to `mobile.js`.

## Option 2: Direct WebSocket Integration (Advanced)

If you prefer to integrate WebSocket directly without the signaling client:

```javascript
// Connect to WebSocket signaling server
const ws = new WebSocket('wss://your-signaling-server.up.railway.app');

ws.onopen = () => {
    // Join session
    ws.send(JSON.stringify({
        type: 'join',
        session_id: sessionId,
        peer_type: 'pc' // or 'mobile'
    }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
        case 'peer_connected':
            // Initialize WebRTC
            break;
        case 'webrtc_offer':
            // Handle offer
            break;
        case 'webrtc_answer':
            // Handle answer
            break;
        case 'ice_candidate':
            // Handle ICE candidate
            break;
    }
};

// Send offer
ws.send(JSON.stringify({
    type: 'webrtc_offer',
    session_id: sessionId,
    offer: peerConnection.localDescription
}));
```

## Testing

1. **Deploy signaling server** to Railway (see `signaling-server/DEPLOYMENT.md`)
2. **Set environment variable** in your Flask app:
   ```bash
   export SIGNALING_SERVER_URL='wss://your-signaling-server.up.railway.app'
   ```
3. **Test locally**:
   - Start Flask app: `python app.py`
   - Start signaling server: `cd signaling-server && npm start`
   - Set `SIGNALING_SERVER_URL='ws://localhost:3000'` in Flask app
4. **Test cross-network**:
   - Deploy signaling server to Railway
   - Set `SIGNALING_SERVER_URL` to Railway URL
   - Test with devices on different networks

## Backward Compatibility

The existing Socket.IO implementation continues to work. The signaling client automatically detects which server to use:

- If `SIGNALING_SERVER_URL` is set → Uses WebSocket signaling server
- If not set → Uses existing Socket.IO implementation

This allows gradual migration and testing.

