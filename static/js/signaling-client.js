/**
 * WebRTC Signaling Client
 * 
 * This module provides a unified interface for connecting to signaling servers.
 * Supports both Flask-SocketIO (for LAN) and Node.js WebSocket server (for cross-network).
 * 
 * Usage:
 *   const signaling = new SignalingClient(signalingServerUrl, sessionId, peerType);
 *   signaling.on('peer_connected', () => { ... });
 *   signaling.sendOffer(offer);
 */

class SignalingClient {
    constructor(serverUrl, sessionId, peerType) {
        this.serverUrl = serverUrl;
        this.sessionId = sessionId;
        this.peerType = peerType; // 'pc' or 'mobile'
        this.ws = null;
        this.socket = null; // For Socket.IO
        this.useSocketIO = false;
        this.eventHandlers = {};
        this.connected = false;
        
        // Determine if we're using Socket.IO or WebSocket
        this.useSocketIO = serverUrl.includes('socket.io') || 
                          (typeof io !== 'undefined' && !serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://'));
    }
    
    /**
     * Connect to the signaling server
     */
    connect() {
        if (this.useSocketIO) {
            this.connectSocketIO();
        } else {
            this.connectWebSocket();
        }
    }
    
    /**
     * Connect using Socket.IO (Flask-SocketIO)
     */
    connectSocketIO() {
        if (typeof io === 'undefined') {
            console.error('Socket.IO library not loaded');
            return;
        }
        
        this.socket = io(this.serverUrl);
        this.useSocketIO = true;
        
        this.socket.on('connect', () => {
            console.log('Socket.IO connected');
            this.connected = true;
            this.emit('connect');
            
            // Join session
            if (this.peerType === 'pc') {
                this.socket.emit('pc_join', { session_id: this.sessionId });
            } else {
                this.socket.emit('mobile_join', { session_id: this.sessionId });
            }
        });
        
        this.socket.on('peer_connected', () => {
            this.emit('peer_connected');
        });
        
        this.socket.on('webrtc_offer', (data) => {
            this.emit('webrtc_offer', data.offer);
        });
        
        this.socket.on('webrtc_answer', (data) => {
            this.emit('webrtc_answer', data.answer);
        });
        
        this.socket.on('ice_candidate', (data) => {
            this.emit('ice_candidate', data.candidate);
        });
        
        this.socket.on('pc_disconnected', () => {
            this.emit('peer_disconnected', 'pc');
        });
        
        this.socket.on('mobile_disconnected', () => {
            this.emit('peer_disconnected', 'mobile');
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('Socket.IO connection error:', error);
            this.emit('error', error);
        });
        
        this.socket.on('disconnect', () => {
            console.log('Socket.IO disconnected');
            this.connected = false;
            this.emit('disconnect');
        });
    }
    
    /**
     * Connect using native WebSocket (Node.js signaling server)
     */
    connectWebSocket() {
        // Ensure URL starts with ws:// or wss://
        let wsUrl = this.serverUrl;
        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
            // Determine protocol based on current page protocol
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            // Extract hostname and port from serverUrl or use current host
            if (wsUrl.startsWith('http://') || wsUrl.startsWith('https://')) {
                const url = new URL(wsUrl);
                wsUrl = `${protocol}//${url.host}`;
            } else {
                // Assume it's just a hostname/port
                wsUrl = `${protocol}//${wsUrl}`;
            }
        }
        
        console.log('Connecting to WebSocket server:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            this.emit('connect');
            
            // Join session
            this.send({
                type: 'join',
                session_id: this.sessionId,
                peer_type: this.peerType
            });
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.emit('error', error);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            this.emit('disconnect');
        };
    }
    
    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
        switch (data.type) {
            case 'joined':
                console.log('Joined session:', data.session_id);
                this.emit('joined', data);
                break;
                
            case 'peer_connected':
                console.log('Peer connected');
                this.emit('peer_connected');
                break;
                
            case 'webrtc_offer':
                this.emit('webrtc_offer', data.offer);
                break;
                
            case 'webrtc_answer':
                this.emit('webrtc_answer', data.answer);
                break;
                
            case 'ice_candidate':
                this.emit('ice_candidate', data.candidate);
                break;
                
            case 'pc_disconnected':
                this.emit('peer_disconnected', 'pc');
                break;
                
            case 'mobile_disconnected':
                this.emit('peer_disconnected', 'mobile');
                break;
                
            case 'error':
                console.error('Signaling server error:', data.message);
                this.emit('error', new Error(data.message));
                break;
                
            default:
                console.warn('Unknown message type:', data.type);
        }
    }
    
    /**
     * Send a message to the signaling server
     */
    send(data) {
        if (this.useSocketIO && this.socket) {
            // Map to Socket.IO events
            if (data.type === 'webrtc_offer') {
                this.socket.emit('webrtc_offer', {
                    session_id: this.sessionId,
                    offer: data.offer
                });
            } else if (data.type === 'webrtc_answer') {
                this.socket.emit('webrtc_answer', {
                    session_id: this.sessionId,
                    answer: data.answer
                });
            } else if (data.type === 'ice_candidate') {
                this.socket.emit('ice_candidate', {
                    session_id: this.sessionId,
                    candidate: data.candidate
                });
            }
        } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('Cannot send message: not connected');
        }
    }
    
    /**
     * Send WebRTC offer
     */
    sendOffer(offer) {
        this.send({
            type: 'webrtc_offer',
            session_id: this.sessionId,
            offer: offer
        });
    }
    
    /**
     * Send WebRTC answer
     */
    sendAnswer(answer) {
        this.send({
            type: 'webrtc_answer',
            session_id: this.sessionId,
            answer: answer
        });
    }
    
    /**
     * Send ICE candidate
     */
    sendIceCandidate(candidate) {
        this.send({
            type: 'ice_candidate',
            session_id: this.sessionId,
            candidate: candidate
        });
    }
    
    /**
     * Event emitter methods
     */
    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);
    }
    
    off(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
        }
    }
    
    emit(event, ...args) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => {
                try {
                    handler(...args);
                } catch (error) {
                    console.error('Error in event handler:', error);
                }
            });
        }
    }
    
    /**
     * Disconnect from signaling server
     */
    disconnect() {
        if (this.useSocketIO && this.socket) {
            this.socket.disconnect();
        } else if (this.ws) {
            this.ws.close();
        }
        this.connected = false;
    }
}

