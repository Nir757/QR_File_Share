/**
 * WebRTC Signaling Server
 * 
 * This server facilitates peer-to-peer connections by relaying WebRTC signaling messages
 * (offers, answers, and ICE candidates) between peers in the same session.
 * 
 * Compatible with Railway and other cloud hosting platforms that set PORT environment variable.
 */

const WebSocket = require('ws');
const http = require('http');

// Get port from environment variable (Railway, Heroku, etc.) or default to 3000
const PORT = process.env.PORT || 3000;

// Store active sessions and their connected peers
// Structure: { sessionId: { peers: Set<ws>, pcPeer: ws, mobilePeer: ws } }
const sessions = new Map();

// Create HTTP server (required for WebSocket upgrade)
const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            sessions: sessions.size,
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    // Default response
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('WebRTC Signaling Server');
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server,
    // Enable CORS for WebSocket connections
    perMessageDeflate: false,
    clientTracking: true
});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    console.log(`[${new Date().toISOString()}] New WebSocket connection`);
    
    let sessionId = null;
    let peerType = null; // 'pc' or 'mobile'
    
    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`[${new Date().toISOString()}] Received message:`, data.type);
            
            switch (data.type) {
                case 'join':
                    handleJoin(ws, data);
                    break;
                    
                case 'webrtc_offer':
                    handleOffer(ws, data);
                    break;
                    
                case 'webrtc_answer':
                    handleAnswer(ws, data);
                    break;
                    
                case 'ice_candidate':
                    handleIceCandidate(ws, data);
                    break;
                    
                case 'ping':
                    // Respond to ping with pong to keep connection alive
                    sendMessage(ws, { type: 'pong' });
                    break;
                    
                default:
                    console.warn(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
            sendError(ws, 'Invalid message format');
        }
    });
    
    // Handle connection close
    ws.on('close', () => {
        console.log(`[${new Date().toISOString()}] WebSocket disconnected`);
        if (sessionId) {
            cleanupSession(sessionId, ws);
        }
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error);
        if (sessionId) {
            cleanupSession(sessionId, ws);
        }
    });
    
    /**
     * Handle peer joining a session
     */
    function handleJoin(ws, data) {
        const { session_id, peer_type } = data;
        
        if (!session_id || !peer_type) {
            sendError(ws, 'Missing session_id or peer_type');
            return;
        }
        
        if (peer_type !== 'pc' && peer_type !== 'mobile') {
            sendError(ws, 'Invalid peer_type. Must be "pc" or "mobile"');
            return;
        }
        
        sessionId = session_id;
        peerType = peer_type;
        
        // Get or create session
        let session = sessions.get(sessionId);
        if (!session) {
            session = {
                peers: new Set(),
                pcPeer: null,
                mobilePeer: null
            };
            sessions.set(sessionId, session);
        }
        
        // Add peer to session
        session.peers.add(ws);
        
        // Store peer by type
        if (peerType === 'pc') {
            session.pcPeer = ws;
        } else {
            session.mobilePeer = ws;
        }
        
        // Store session info on WebSocket
        ws.sessionId = sessionId;
        ws.peerType = peerType;
        
        console.log(`[${new Date().toISOString()}] Peer joined: session=${sessionId}, type=${peerType}`);
        
        // Notify peer that they've joined
        sendMessage(ws, {
            type: 'joined',
            session_id: sessionId,
            peer_type: peerType
        });
        
        // If both peers are connected, notify them
        if (session.pcPeer && session.mobilePeer) {
            console.log(`[${new Date().toISOString()}] Both peers connected for session ${sessionId}`);
            sendMessage(session.pcPeer, { type: 'peer_connected' });
            sendMessage(session.mobilePeer, { type: 'peer_connected' });
        }
    }
    
    /**
     * Handle WebRTC offer - forward to the other peer
     */
    function handleOffer(ws, data) {
        const { session_id, offer } = data;
        
        if (!session_id || !offer) {
            sendError(ws, 'Missing session_id or offer');
            return;
        }
        
        const session = sessions.get(session_id);
        if (!session) {
            sendError(ws, 'Session not found');
            return;
        }
        
        // Forward offer to the other peer (exclude sender)
        session.peers.forEach(peer => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                sendMessage(peer, {
                    type: 'webrtc_offer',
                    offer: offer
                });
            }
        });
    }
    
    /**
     * Handle WebRTC answer - forward to the other peer
     */
    function handleAnswer(ws, data) {
        const { session_id, answer } = data;
        
        if (!session_id || !answer) {
            sendError(ws, 'Missing session_id or answer');
            return;
        }
        
        const session = sessions.get(session_id);
        if (!session) {
            sendError(ws, 'Session not found');
            return;
        }
        
        // Forward answer to the other peer (exclude sender)
        session.peers.forEach(peer => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                sendMessage(peer, {
                    type: 'webrtc_answer',
                    answer: answer
                });
            }
        });
    }
    
    /**
     * Handle ICE candidate - forward to the other peer
     */
    function handleIceCandidate(ws, data) {
        const { session_id, candidate } = data;
        
        if (!session_id) {
            sendError(ws, 'Missing session_id');
            return;
        }
        
        const session = sessions.get(session_id);
        if (!session) {
            sendError(ws, 'Session not found');
            return;
        }
        
        // Forward ICE candidate to the other peer (exclude sender)
        session.peers.forEach(peer => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                sendMessage(peer, {
                    type: 'ice_candidate',
                    candidate: candidate
                });
            }
        });
    }
    
    /**
     * Clean up session when a peer disconnects
     */
    function cleanupSession(sessionId, ws) {
        const session = sessions.get(sessionId);
        if (!session) return;
        
        // Remove peer from session
        session.peers.delete(ws);
        
        // Clear peer type references
        if (session.pcPeer === ws) {
            session.pcPeer = null;
        }
        if (session.mobilePeer === ws) {
            session.mobilePeer = null;
        }
        
        // Notify other peer about disconnection
        session.peers.forEach(peer => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                const disconnectType = ws.peerType === 'pc' ? 'pc_disconnected' : 'mobile_disconnected';
                sendMessage(peer, { type: disconnectType });
            }
        });
        
        // Remove session if no peers left
        if (session.peers.size === 0) {
            sessions.delete(sessionId);
            console.log(`[${new Date().toISOString()}] Session ${sessionId} removed (no peers)`);
        }
    }
    
    /**
     * Send a message to a WebSocket client
     */
    function sendMessage(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(data));
            } catch (error) {
                console.error('Error sending message:', error);
            }
        }
    }
    
    /**
     * Send an error message to a WebSocket client
     */
    function sendError(ws, message) {
        sendMessage(ws, {
            type: 'error',
            message: message
        });
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] WebRTC Signaling Server started`);
    console.log(`[${new Date().toISOString()}] Listening on port ${PORT}`);
    console.log(`[${new Date().toISOString()}] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log(`[${new Date().toISOString()}] SIGTERM received, closing server...`);
    wss.close(() => {
        server.close(() => {
            console.log(`[${new Date().toISOString()}] Server closed`);
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log(`[${new Date().toISOString()}] SIGINT received, closing server...`);
    wss.close(() => {
        server.close(() => {
            console.log(`[${new Date().toISOString()}] Server closed`);
            process.exit(0);
        });
    });
});

