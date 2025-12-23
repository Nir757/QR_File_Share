const socket = io();
let sessionId = null;
let peerConnection = null;
let dataChannel = null;
let receivedFiles = [];
let fileQueue = [];
let isSendingFile = false;
let sendingFiles = {}; // Track sending files by name
let fileErrors = {}; // Store error messages for files
let queueProcessingTimeout = null;
let shouldStopQueue = false;
let receivingChunks = {}; // Track file chunks being received {fileId: {chunks: [], totalChunks, fileName, fileSize, fileType}}
const CHUNK_SIZE = 200 * 1024; // 200KB chunks (safe for WebRTC)

// Signaling client for cross-network P2P support
let signalingClient = null;

// Mode: 'railway' (cloud/cross-network) or 'local' (LAN)
let currentMode = 'railway'; // Default to cross-network (name kept for compatibility)

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    // Check if we're on cloud deployment URL or localhost
    if (window.location.hostname.includes('koyeb.app') || window.location.hostname.includes('railway.app') || window.location.hostname.includes('ngrok.io')) {
        currentMode = 'railway';
    } else {
        currentMode = 'local';
    }
    updateModeUI();
    await generateSession();
    initializeSignaling();
    setupPageVisibilityTracking();
    
    // Setup refresh button handler
    setTimeout(() => {
        const refreshBtn = document.getElementById('refresh-qr-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.textContent = '🔄 Refreshing...';
                try {
                    await refreshQRCode();
                } catch (error) {
                    console.error('Error refreshing QR code:', error);
                    alert('Failed to refresh QR code. Please reload the page.');
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.textContent = '🔄 Refresh QR Code';
                }
            });
        }
    }, 500);
});

// Flag to prevent multiple visibility tracking setups
let visibilityTrackingSetup = false;

// Setup Page Visibility API tracking
function setupPageVisibilityTracking() {
    // Prevent multiple setups (would cause duplicate event listeners)
    if (visibilityTrackingSetup) {
        console.log('Visibility tracking already set up, skipping...');
        return;
    }
    
    // Detect when tab goes to background (user opens file picker)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            isTabHidden = true;
            console.log('Tab hidden - user might be picking files');
        } else {
            isTabHidden = false;
            // Reset file picker time when tab becomes visible again
            if (filePickerOpenTime) {
                const timeHidden = Date.now() - filePickerOpenTime;
                console.log(`Tab visible again after ${Math.round(timeHidden / 1000)}s`);
                filePickerOpenTime = null;
            }
        }
    });
    
    visibilityTrackingSetup = true;
    
    // Note: File input click tracking is handled in setupFileUpload()
    // to avoid duplicate listeners
}

// Update mode UI (display only, no switching)
function updateModeUI() {
    const modeInfo = document.getElementById('mode-info');
    const modeInfoText = document.getElementById('mode-info-text');
    
    if (currentMode === 'railway') {
        // Show current mode in info banner
        if (modeInfoText) modeInfoText.textContent = '🌐 Cross-Network Mode: Works from anywhere';
        if (modeInfo) modeInfo.style.background = '#e3f2fd';
    } else {
        // Show current mode in info banner
        if (modeInfoText) modeInfoText.textContent = '🏠 LAN Mode: Same network only';
        if (modeInfo) modeInfo.style.background = '#fff3e0';
    }
}

async function generateSession() {
    try {
        const response = await fetch('/api/generate-session', {
            method: 'POST'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate session');
        }
        
        const data = await response.json();
        sessionId = data.session_id;
        
        // Display QR code
        const qrCodeDiv = document.getElementById('qr-code');
        qrCodeDiv.innerHTML = ''; // Clear any existing QR code
        const qrImg = document.createElement('img');
        qrImg.src = 'data:image/png;base64,' + data.qr_code;
        qrImg.style.maxWidth = '100%';
        qrImg.style.height = 'auto';
        qrImg.style.minWidth = '250px'; // Ensure minimum size for scanning
        qrImg.alt = 'QR Code - Scan with your phone camera';
        qrCodeDiv.appendChild(qrImg);
        
        // Display URL as fallback (use URL from response if available)
        const mobileUrl = data.qr_url || `${window.location.origin}/mobile?session=${sessionId}`;
        const urlLink = document.getElementById('qr-url-link');
        if (urlLink) {
            urlLink.href = mobileUrl;
            urlLink.textContent = mobileUrl;
        }
        
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('qr-container').classList.remove('hidden');
        
        // Signaling will be initialized after session is generated
    } catch (error) {
        console.error('Error generating session:', error);
        document.getElementById('loading').innerHTML = `
            <div style="color: #d32f2f; padding: 20px;">
                <h3>Error: ${error.message}</h3>
                <p>Please make sure:</p>
                <ul style="text-align: left; display: inline-block;">
                    <li>Your PC and phone are on the same Wi-Fi network</li>
                    <li>Windows Firewall allows connections on port 5000</li>
                    <li>Try accessing this page using your local IP address directly</li>
                </ul>
            </div>
        `;
    }
}

// Refresh QR code function
async function refreshQRCode() {
    // Show loading state
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('qr-container').classList.add('hidden');
    
    // Clean up existing connection if any
    if (signalingClient) {
        signalingClient.disconnect();
        signalingClient = null;
    }
    if (socket) {
        if (socket.connected) {
            socket.disconnect();
        }
        socket.removeAllListeners();
        // Socket.IO will auto-reconnect, but we'll set up listeners in initializeSignaling
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    
    // Reset session
    sessionId = null;
    
    // Generate new session
    await generateSession();
    
    // Reinitialize signaling with new session
    initializeSignaling();
}

// Initialize signaling (Socket.IO or WebSocket)
function initializeSignaling() {
    // Check if we should use the Node.js WebSocket signaling server
    if (window.SIGNALING_SERVER_URL && window.SIGNALING_SERVER_URL.trim() !== '') {
        console.log('Using Node.js WebSocket signaling server:', window.SIGNALING_SERVER_URL);
        signalingClient = new SignalingClient(
            window.SIGNALING_SERVER_URL,
            sessionId,
            'pc'
        );
        
        // Set up event handlers
        signalingClient.on('peer_connected', () => {
            // Cancel any pending disconnection timeout (connection restored)
            if (disconnectTimeout) {
                clearTimeout(disconnectTimeout);
                disconnectTimeout = null;
            }
            isDisconnected = false;
            
            document.getElementById('qr-container').classList.add('hidden');
            document.getElementById('connected-view').classList.remove('hidden');
            initializeWebRTC();
            // File upload handlers will be set up once when data channel opens
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
            handleDisconnection('Mobile device disconnected');
        });
        
        signalingClient.connect();
    } else {
        // Fall back to existing Socket.IO implementation (LAN mode)
        console.log('Using Socket.IO signaling (LAN mode)');
        setupSocketListeners();
        // Join socket room for Socket.IO
        socket.emit('pc_join', { session_id: sessionId });
    }
}

function setupSocketListeners() {
    socket.on('peer_connected', () => {
        // Cancel any pending disconnection timeout (connection restored)
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
        isDisconnected = false;
        
        document.getElementById('qr-container').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
        // File upload handlers will be set up once when data channel opens
    });
    
    socket.on('webrtc_offer', async (data) => {
        await handleOffer(data.offer);
    });
    
    socket.on('webrtc_answer', async (data) => {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    });
    
    socket.on('ice_candidate', async (data) => {
        if (data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });
    
    socket.on('mobile_disconnected', () => {
        handleDisconnection('Mobile device disconnected');
    });
}

function initializeWebRTC() {
    // Get TURN credentials from environment variables (passed from Flask template)
    const turnUsername = window.TURN_USERNAME || '';
    const turnPassword = window.TURN_PASSWORD || '';
    
    // Build iceServers array
    const iceServers = [
        // Google STUN servers
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ];
    
    // Add dedicated TURN servers if credentials are provided
    if (turnUsername && turnPassword) {
        iceServers.push(
            { 
                urls: 'turn:a.relay.metered.ca:443',
                username: turnUsername,
                credential: turnPassword
            },
            { 
                urls: 'turn:a.relay.metered.ca:443?transport=tcp',
                username: turnUsername,
                credential: turnPassword
            },
            { 
                urls: 'turn:a.relay.metered.ca:80',
                username: turnUsername,
                credential: turnPassword
            },
            { 
                urls: 'turn:a.relay.metered.ca:80?transport=tcp',
                username: turnUsername,
                credential: turnPassword
            }
        );
    }
    
    // Public Metered servers as backup (always available)
    iceServers.push(
        { 
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        { 
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    );
    
    const configuration = {
        iceServers: iceServers,
        iceTransportPolicy: 'all', // Use both relay and non-relay candidates
        iceCandidatePoolSize: 10 // Pre-gather more candidates for faster connection
    };
    
    // Log TURN server configuration for debugging
    console.log('🔧 WebRTC Configuration:');
    console.log('   TURN Servers configured:', configuration.iceServers.filter(s => s.urls.includes('turn:')).length);
    if (turnUsername) {
        console.log('   TURN Username (dedicated):', turnUsername);
    } else {
        console.log('   TURN Username (dedicated): Not configured (using public servers only)');
    }
    console.log('   TURN Servers:');
    configuration.iceServers.filter(s => s.urls.includes('turn:')).forEach((server, idx) => {
        console.log(`     ${idx + 1}. ${server.urls} (${server.username || 'no auth'})`);
    });
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // Log ICE candidates for debugging
    let candidateCount = { host: 0, srflx: 0, relay: 0 };
    let turnServerErrors = [];
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // Log candidate type
            const candidate = event.candidate;
            const type = candidate.type || 'unknown';
            candidateCount[type] = (candidateCount[type] || 0) + 1;
            console.log(`ICE candidate (${type}):`, candidate.candidate);
            
            // Check if it's a relay candidate (from TURN server)
            if (type === 'relay') {
                console.log('✅ TURN server working! Got relay candidate:', candidate.candidate);
            }
            
            console.log('Candidate counts:', candidateCount);
            
            if (signalingClient) {
                signalingClient.sendIceCandidate(event.candidate);
            } else {
                socket.emit('ice_candidate', {
                    session_id: sessionId,
                    candidate: event.candidate
                });
            }
        } else {
            // ICE gathering complete
            console.log('✅ ICE gathering complete. Total candidates:', candidateCount);
            
            // Only warn if no relay candidates AND no other candidate types available
            // If we have host or srflx candidates, connection will likely work without TURN
            if (candidateCount.relay === 0) {
                const hasOtherCandidates = (candidateCount.host > 0 || candidateCount.srflx > 0);
                if (!hasOtherCandidates) {
                    // No candidates at all - this is a real problem
                    console.warn('⚠️  WARNING: No relay candidates found! TURN servers may not be working.');
                    console.warn('   This means:');
                    console.warn('   1. TURN credentials might be invalid/expired');
                    console.warn('   2. TURN servers might be blocked by firewall');
                    console.warn('   3. Network might be blocking TURN traffic');
                    console.warn('   Check TURN server credentials at: https://www.metered.ca');
                    if (turnUsername) {
                        console.warn('   Current TURN username:', turnUsername);
                    } else {
                        console.warn('   TURN username not configured in .env file');
                    }
                } else {
                    // Connection will likely work without TURN, just log as info
                    console.log('ℹ️  No TURN relay candidates, but have host/srflx candidates. Connection should work without TURN.');
                }
            } else {
                console.log(`✅ TURN servers working! Got ${candidateCount.relay} relay candidate(s)`);
            }
        }
    };
    
    // Monitor ICE gathering state
    peerConnection.onicegatheringstatechange = () => {
        const state = peerConnection.iceGatheringState;
        console.log('ICE gathering state:', state);
        // Don't show TURN errors here - wait to see if connection succeeds
        // Errors will be shown in oniceconnectionstatechange if connection fails
    };
    
    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log('Peer connection state:', state);
        
        if (state === 'failed' || state === 'disconnected') {
            console.error('❌ Peer connection failed or disconnected');
            // Stop queue processing immediately
            shouldStopQueue = true;
            isSendingFile = false;
            if (queueProcessingTimeout) {
                clearTimeout(queueProcessingTimeout);
                queueProcessingTimeout = null;
            }
            // Clear file queue and show error
            if (fileQueue.length > 0) {
                fileQueue.forEach(file => {
                    updateFileStatus(file.name, 'error', 'Connection failed - WebRTC peer connection failed');
                });
                fileQueue = [];
            }
            // Show disconnection message
            handleDisconnection('WebRTC connection failed. Please try reconnecting.');
        } else if (state === 'connected') {
            console.log('✅ Peer connection established');
            // Reset stop flag when connection is restored
            shouldStopQueue = false;
        }
    };
    
    peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        console.log('ICE connection state:', iceState);
        
        if (iceState === 'failed') {
            console.error('❌ ICE connection failed - may need TURN server or different network');
            
            // Show TURN server errors only if connection failed and no relay candidates were available
            if (candidateCount.relay === 0) {
                console.error('❌ TURN SERVER ISSUE: Connection failed and no relay candidates available');
                console.error('   Possible causes:');
                console.error('   - TURN credentials expired or invalid');
                console.error('   - Firewall blocking TURN server ports (80, 443, 3478)');
                console.error('   - Network blocking UDP/TCP TURN traffic');
                console.error('   - TURN server temporarily unavailable');
                console.error('   - Both devices behind strict NAT/firewall requiring TURN');
                if (turnUsername) {
                    console.error('   Current TURN username:', turnUsername);
                } else {
                    console.error('   TURN username not configured in .env file');
                }
            }
            
            // Stop queue processing
            shouldStopQueue = true;
            if (queueProcessingTimeout) {
                clearTimeout(queueProcessingTimeout);
                queueProcessingTimeout = null;
            }
            // Clear all files in queue and show error
            if (fileQueue.length > 0) {
                fileQueue.forEach(file => {
                    updateFileStatus(file.name, 'error', 'Network connection failed. Both devices may be behind strict firewalls.');
                });
                fileQueue = [];
            }
            // Show disconnection message
            handleDisconnection('WebRTC connection failed. ICE negotiation failed - may need TURN server or different network.');
        } else if (iceState === 'disconnected') {
            console.warn('⚠️  ICE connection disconnected');
            // Stop queue processing
            shouldStopQueue = true;
            if (queueProcessingTimeout) {
                clearTimeout(queueProcessingTimeout);
                queueProcessingTimeout = null;
            }
        } else if (iceState === 'connected' || iceState === 'completed') {
            console.log('✅ ICE connection established');
            // Connection succeeded - if no TURN was used, that's fine
            if (candidateCount.relay === 0 && (candidateCount.host > 0 || candidateCount.srflx > 0)) {
                console.log('ℹ️  Connection established without TURN (using direct/host or STUN-assisted connection)');
            }
        }
    };
    
    // Create data channel for file transfer
    dataChannel = peerConnection.createDataChannel('files', { ordered: true });
    setupDataChannel();
    
    // Create and send offer
    // Explicitly disable audio/video to prevent microphone permission requests
    // We only use data channels for file transfer
    peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
    })
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

async function handleOffer(offer) {
    if (!peerConnection) {
        initializeWebRTC();
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    // Explicitly disable audio/video to prevent microphone permission requests
    // We only use data channels for file transfer
    const answer = await peerConnection.createAnswer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
    });
    await peerConnection.setLocalDescription(answer);
    
    if (signalingClient) {
        signalingClient.sendAnswer(peerConnection.localDescription);
    } else {
        socket.emit('webrtc_answer', {
            session_id: sessionId,
            answer: peerConnection.localDescription
        });
    }
}

function setupDataChannel() {
    if (!dataChannel) {
        console.error('setupDataChannel called but dataChannel is null');
        return;
    }
    
    console.log('Setting up data channel, current state:', dataChannel.readyState);
    
    // Add timeout for data channel opening (30 seconds)
    let dataChannelTimeout = setTimeout(() => {
        if (dataChannel && dataChannel.readyState !== 'open') {
            console.error('❌ Data channel timeout - failed to open within 30 seconds');
            if (fileQueue.length > 0) {
                fileQueue.forEach(file => {
                    updateFileStatus(file.name, 'error', 'Data channel failed to open - connection timeout');
                });
                fileQueue = [];
            }
            handleDisconnection('Data channel failed to open. Connection may be blocked by firewall or NAT.');
        }
    }, 30000); // 30 second timeout
    
    // If channel is already open, setup handlers once
    if (dataChannel.readyState === 'open') {
        clearTimeout(dataChannelTimeout);
        console.log('Data channel already open');
        // Setup handlers only once (guard will prevent duplicates)
        if (!fileUploadSetup) {
            setupFileUpload();
        }
        if (fileQueue.length > 0) {
            processFileQueue();
        }
    }
    
    dataChannel.onopen = () => {
        clearTimeout(dataChannelTimeout);
        console.log('✅ Data channel opened successfully');
        // Setup file upload handlers once data channel is ready (guard will prevent duplicates)
        if (!fileUploadSetup) {
            setupFileUpload();
        }
        // Start processing queue if there are files waiting
        if (fileQueue.length > 0) {
            console.log(`Processing ${fileQueue.length} queued files`);
            processFileQueue();
        }
    };
    
    dataChannel.onerror = (error) => {
        clearTimeout(dataChannelTimeout);
        console.error('❌ Data channel error:', error);
        if (fileQueue.length > 0) {
            fileQueue.forEach(file => {
                updateFileStatus(file.name, 'error', 'Data channel error occurred');
            });
            fileQueue = [];
        }
    };
    
    dataChannel.onclose = () => {
        clearTimeout(dataChannelTimeout);
        console.warn('⚠️  Data channel closed');
        if (fileQueue.length > 0 && dataChannel.readyState === 'closed') {
            fileQueue.forEach(file => {
                updateFileStatus(file.name, 'error', 'Data channel closed before file could be sent');
            });
            fileQueue = [];
        }
    };
    
    // Monitor bufferedAmount to help with queue processing
    dataChannel.onbufferedamountlow = () => {
        console.log('Buffer cleared, checking if we can process next file');
        if (fileQueue.length > 0 && !isSendingFile && !shouldStopQueue) {
            processFileQueue();
        }
    };
    
    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'file') {
                // Single message file (small files)
                receiveFile(data);
            } else if (data.type === 'file_start') {
                // Start of chunked file transfer
                console.log('Starting chunked file transfer:', data.fileName, 'Total chunks:', data.totalChunks);
                receivingChunks[data.fileId] = {
                    chunks: new Array(data.totalChunks),
                    totalChunks: data.totalChunks,
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                    fileType: data.fileType,
                    receivedChunks: 0
                };
            } else if (data.type === 'file_chunk') {
                // Receiving a chunk
                handleFileChunk(data);
            }
        } catch (error) {
            console.error('Error handling data channel message:', error);
        }
    };
    
    // Note: dataChannel.onerror already set above (line ~606)
    // Removed duplicate handler that was overwriting the first one
    
    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'file') {
                    receiveFile(data);
                } else if (data.type === 'file_start') {
                    receivingChunks[data.fileId] = {
                        chunks: new Array(data.totalChunks),
                        totalChunks: data.totalChunks,
                        fileName: data.fileName,
                        fileSize: data.fileSize,
                        fileType: data.fileType,
                        receivedChunks: 0
                    };
                } else if (data.type === 'file_chunk') {
                    handleFileChunk(data);
                }
            } catch (error) {
                console.error('Error handling data channel message:', error);
            }
        };
    };
}

function handleFileChunk(chunkData) {
    const fileId = chunkData.fileId;
    const chunkInfo = receivingChunks[fileId];
    
    if (!chunkInfo) {
        console.error('Received chunk for unknown file:', fileId);
        return;
    }
    
    // Store chunk
    chunkInfo.chunks[chunkData.chunkIndex] = chunkData.data;
    chunkInfo.receivedChunks++;
    
    console.log(`Received chunk ${chunkData.chunkIndex + 1}/${chunkData.totalChunks} for file ${chunkInfo.fileName}`);
    
    // Check if all chunks received
    if (chunkInfo.receivedChunks === chunkInfo.totalChunks) {
        // Reassemble file
        const completeData = chunkInfo.chunks.join('');
        
        const fileData = {
            name: chunkInfo.fileName,
            size: chunkInfo.fileSize,
            fileType: chunkInfo.fileType,
            data: completeData
        };
        
        console.log(`All chunks received for ${chunkInfo.fileName}, reassembling...`);
        receiveFile(fileData);
        
        // Clean up
        delete receivingChunks[fileId];
    }
}

async function sendFileInChunks(file, base64Data, fileMetadata) {
    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
    const fileId = Date.now() + Math.random(); // Unique ID for this file transfer
    
    console.log(`Sending file ${file.name} in ${totalChunks} chunks`);
    
    // Send file start message
    const startMessage = {
        type: 'file_start',
        fileId: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        totalChunks: totalChunks
    };
    
    // Wait for buffer
    while (dataChannel.bufferedAmount > 64 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (shouldStopQueue) {
            throw new Error('Queue cancelled by user');
        }
    }
    
    dataChannel.send(JSON.stringify(startMessage));
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Send chunks
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (shouldStopQueue) {
            throw new Error('Queue cancelled by user');
        }
        
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, base64Data.length);
        const chunkData = base64Data.substring(start, end);
        
        const chunkMessage = {
            type: 'file_chunk',
            fileId: fileId,
            chunkIndex: chunkIndex,
            totalChunks: totalChunks,
            data: chunkData
        };
        
        // Wait for buffer to clear
        while (dataChannel.bufferedAmount > 64 * 1024) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (shouldStopQueue) {
                throw new Error('Queue cancelled by user');
            }
        }
        
        dataChannel.send(JSON.stringify(chunkMessage));
        
        // Update progress
        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        const fileId_clean = file.name.replace(/[^a-zA-Z0-9]/g, '_');
        const progressEl = document.getElementById(`progress-${fileId_clean}`);
        if (progressEl) {
            progressEl.style.width = `${progress}%`;
        }
        
        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`File ${file.name} sent successfully in ${totalChunks} chunks`);
}

function receiveFile(data) {
    // Handle both fileType and type properties for compatibility
    const fileType = data.fileType || data.type || 'application/octet-stream';
    
    const fileData = {
        id: Date.now() + Math.random(), // Unique ID for each file
        name: data.name,
        size: data.size || 0,
        type: fileType,
        data: data.data,
        downloaded: false
    };
    
    console.log('Adding file to receivedFiles:', fileData.name);
    receivedFiles.push(fileData);
    displayReceivedFile(fileData);
    updateDownloadAllButton();
    console.log('Total received files:', receivedFiles.length);
}

function displayReceivedFile(file) {
    const container = document.getElementById('received-files');
    const noFilesMsg = document.getElementById('no-files-message');
    
    if (noFilesMsg) {
        noFilesMsg.style.display = 'none';
    }
    
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item pending-file';
    fileItem.id = `file-${file.id}`;
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatFileSize(file.size)}</div>
        </div>
        <div class="file-actions">
            <button class="btn-accept" onclick="acceptFile('${file.id}')">✓ Accept</button>
            <button class="btn-reject" onclick="rejectFile('${file.id}')">✗ Reject</button>
        </div>
    `;
    // Insert at the top (before first child) so new files appear on top
    if (container.firstChild) {
        container.insertBefore(fileItem, container.firstChild);
    } else {
        container.appendChild(fileItem);
    }
}

function acceptFile(fileId) {
    const file = receivedFiles.find(f => f.id.toString() === fileId.toString());
    if (file && !file.downloaded) {
        downloadFile(file);
        file.downloaded = true;
        updateFileItemUI(fileId, true);
    }
}

function rejectFile(fileId) {
    const fileItem = document.getElementById(`file-${fileId}`);
    if (fileItem) {
        fileItem.style.opacity = '0.5';
        fileItem.querySelector('.file-actions').innerHTML = '<span style="color: #999;">Rejected</span>';
    }
    
    const file = receivedFiles.find(f => f.id.toString() === fileId.toString());
    if (file) {
        file.downloaded = true; // Mark as processed
    }
    
    updateDownloadAllButton();
}

function updateFileItemUI(fileId, accepted) {
    const fileItem = document.getElementById(`file-${fileId}`);
    if (fileItem) {
        if (accepted) {
            fileItem.classList.remove('pending-file');
            fileItem.classList.add('downloaded-file');
            fileItem.querySelector('.file-actions').innerHTML = '<span style="color: #4caf50;">✓ Downloaded</span>';
        }
    }
    updateDownloadAllButton();
}

function updateDownloadAllButton() {
    const downloadAllBtn = document.getElementById('download-all-btn');
    const rejectAllBtn = document.getElementById('reject-all-btn');
    const pendingFiles = receivedFiles.filter(f => !f.downloaded);
    const processedFiles = receivedFiles.filter(f => f.downloaded);
    
    if (pendingFiles.length > 0) {
        if (downloadAllBtn) {
            downloadAllBtn.style.display = 'inline-block';
            downloadAllBtn.textContent = `Download All (${pendingFiles.length})`;
        }
        if (rejectAllBtn) {
            rejectAllBtn.style.display = 'inline-block';
            rejectAllBtn.textContent = `Reject All (${pendingFiles.length})`;
        }
    } else {
        if (downloadAllBtn) {
            downloadAllBtn.style.display = 'none';
        }
        if (rejectAllBtn) {
            rejectAllBtn.style.display = 'none';
        }
    }
    
    // Show/hide "Clear Processed" button based on processed files
    const clearProcessedBtn = document.getElementById('clear-processed-btn');
    if (clearProcessedBtn) {
        if (processedFiles.length > 0) {
            clearProcessedBtn.style.display = 'inline-block';
            clearProcessedBtn.textContent = `Clear Processed (${processedFiles.length})`;
        } else {
            clearProcessedBtn.style.display = 'none';
        }
    }
    
    // Show "no files" message if all files are processed
    const noFilesMsg = document.getElementById('no-files-message');
    if (receivedFiles.length === 0 && noFilesMsg) {
        noFilesMsg.style.display = 'block';
    } else if (noFilesMsg) {
        noFilesMsg.style.display = 'none';
    }
}

// Clear processed files (accepted/rejected)
function clearProcessedFiles() {
    const processedFiles = receivedFiles.filter(f => f.downloaded);
    
    if (processedFiles.length === 0) {
        return;
    }
    
    // Remove processed files from array
    receivedFiles = receivedFiles.filter(f => !f.downloaded);
    
    // Remove processed files from DOM
    processedFiles.forEach(file => {
        const fileItem = document.getElementById(`file-${file.id}`);
        if (fileItem) {
            fileItem.remove();
        }
    });
    
    console.log(`Cleared ${processedFiles.length} processed file(s)`);
    
    // Update buttons and messages
    updateDownloadAllButton();
}

// Make clearProcessedFiles globally accessible
window.clearProcessedFiles = clearProcessedFiles;

function rejectAllFiles() {
    const pendingFiles = receivedFiles.filter(f => !f.downloaded);
    pendingFiles.forEach(file => {
        rejectFile(file.id.toString());
    });
}

// Make rejectAllFiles globally accessible
window.rejectAllFiles = rejectAllFiles;

// Make functions globally accessible
window.acceptFile = acceptFile;
window.rejectFile = rejectFile;

// Setup download all and reject all button handlers using event delegation
let buttonHandlersSetup = false;

function setupDownloadAllButton() {
    // Use event delegation on the connected-view container
    const connectedView = document.getElementById('connected-view');
    if (!connectedView || buttonHandlersSetup) {
        return;
    }
    
    // Use event delegation to handle clicks on buttons
    connectedView.addEventListener('click', (e) => {
        if (e.target.id === 'download-all-btn' || e.target.closest('#download-all-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const pendingFiles = receivedFiles.filter(f => !f.downloaded);
            if (pendingFiles.length > 0) {
                pendingFiles.forEach(file => {
                    acceptFile(file.id.toString());
                });
            }
        }
        
        if (e.target.id === 'reject-all-btn' || e.target.closest('#reject-all-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const pendingFiles = receivedFiles.filter(f => !f.downloaded);
            if (pendingFiles.length > 0) {
                rejectAllFiles();
            }
        }
    });
    
    buttonHandlersSetup = true;
}

// Setup when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDownloadAllButton);
} else {
    setupDownloadAllButton();
}

function downloadFile(file) {
    const blob = new Blob([base64ToArrayBuffer(file.data)], { type: file.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// File upload area setup
let fileUploadSetup = false; // Guard to prevent multiple setups

function setupFileUpload() {
    // Prevent multiple setups
    if (fileUploadSetup) {
        console.log('File upload already set up, skipping...');
        return;
    }
    
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('file-upload-area');
    const browseBtn = document.getElementById('browse-btn');
    
    if (!fileInput || !uploadArea) return;
    
    // Click on upload area to trigger file picker
    uploadArea.addEventListener('click', (e) => {
        if (e.target !== browseBtn && e.target !== fileInput) {
            filePickerOpenTime = Date.now();
            console.log('File picker opened via upload area');
            fileInput.click();
        }
    });
    
    // Browse button click
    if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            filePickerOpenTime = Date.now();
            console.log('File picker opened via browse button');
            fileInput.click();
        });
    }
    
    // Track file input clicks directly
    fileInput.addEventListener('click', () => {
        filePickerOpenTime = Date.now();
        console.log('File picker opened - tracking time');
    });
    
    // File input change - use once flag to prevent multiple triggers
    let isProcessingChange = false;
    fileInput.addEventListener('change', (e) => {
        // Prevent multiple simultaneous change events
        if (isProcessingChange) {
            console.log('Already processing file change, ignoring...');
            return;
        }
        
        isProcessingChange = true;
        const files = e.target.files;
        
        // Clear file picker tracking since user is done picking
        filePickerOpenTime = null;
        
        if (files.length > 0) {
            Array.from(files).forEach(file => {
                queueFile(file);
            });
            // Reset input after a small delay to prevent immediate re-trigger
            setTimeout(() => {
                fileInput.value = '';
                isProcessingChange = false;
            }, 100);
            
            // Start processing queue if not already processing
            if (!isSendingFile && fileQueue.length > 0) {
                processFileQueue();
            }
        } else {
            // User cancelled file selection - already cleared above
            isProcessingChange = false;
        }
    });
    
    fileUploadSetup = true;
    
    // Setup cancel queue button
    const cancelBtn = document.getElementById('cancel-queue-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (confirm(`Cancel ${fileQueue.length} file(s) in queue?`)) {
                cancelQueue();
            }
        });
    }
    
    // Drag and drop handlers
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            Array.from(files).forEach(file => {
                queueFile(file);
            });
            processFileQueue(); // Start processing queue
        }
    });
}


function queueFile(file) {
    fileQueue.push(file);
    displaySendingFile(file, 'queued');
    console.log('File queued:', file.name, 'Total in queue:', fileQueue.length);
    updateCancelButton();
}

function cancelQueue() {
    console.log('Cancelling queue...');
    shouldStopQueue = true;
    
    // Clear the queue
    const cancelledCount = fileQueue.length;
    fileQueue.forEach(file => {
        updateFileStatus(file.name, 'error', 'Cancelled by user');
    });
    fileQueue = [];
    
    // Clear timeout
    if (queueProcessingTimeout) {
        clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = null;
    }
    
    // Reset sending flag
    isSendingFile = false;
    
    console.log(`Cancelled ${cancelledCount} files from queue`);
    updateCancelButton();
}

function updateCancelButton() {
    const cancelBtn = document.getElementById('cancel-queue-btn');
    if (cancelBtn) {
        if (fileQueue.length > 0 || isSendingFile) {
            cancelBtn.style.display = 'inline-block';
            cancelBtn.textContent = `Cancel Queue (${fileQueue.length + (isSendingFile ? 1 : 0)})`;
        } else {
            cancelBtn.style.display = 'none';
        }
    }
    
    // Update view progress button visibility
    const viewProgressBtn = document.getElementById('view-progress-btn');
    if (viewProgressBtn) {
        // Show button if there are files in queue or being sent
        if (fileQueue.length > 0 || isSendingFile || Object.keys(sendingFiles).length > 0) {
            viewProgressBtn.style.display = 'inline-block';
        } else {
            viewProgressBtn.style.display = 'none';
        }
    }
}

// Scroll to sending progress section
function scrollToProgress() {
    const progressSection = document.getElementById('sending-progress-section');
    if (progressSection) {
        progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Make scrollToProgress globally accessible
window.scrollToProgress = scrollToProgress;

async function processFileQueue() {
    // Check if queue should be stopped
    if (shouldStopQueue) {
        console.log('Queue processing stopped');
        return;
    }
    
    // Check if peer connection has failed
    if (peerConnection && (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected')) {
        console.error('❌ Cannot process queue - peer connection failed');
        if (fileQueue.length > 0) {
            fileQueue.forEach(file => {
                updateFileStatus(file.name, 'error', 'Connection failed - cannot send files');
            });
            fileQueue = [];
        }
        return;
    }
    
    // Check if ICE connection has failed
    if (peerConnection && peerConnection.iceConnectionState === 'failed') {
        console.error('❌ Cannot process queue - ICE connection failed');
        if (fileQueue.length > 0) {
            fileQueue.forEach(file => {
                updateFileStatus(file.name, 'error', 'Network connection failed');
            });
            fileQueue = [];
        }
        return;
    }
    
    // If we're currently sending a file, wait for it to finish
    if (isSendingFile) {
        if (queueProcessingTimeout) clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = setTimeout(processFileQueue, 300);
        return;
    }
    
    if (fileQueue.length === 0) {
        console.log('File queue is empty');
        updateCancelButton();
        return;
    }
    
    if (!dataChannel) {
        console.warn('⚠️  Data channel not initialized, waiting...');
        if (queueProcessingTimeout) clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = setTimeout(processFileQueue, 500);
        return;
    }
    
    if (dataChannel.readyState !== 'open') {
        const stateNames = {
            'connecting': 'Connecting',
            'open': 'Open',
            'closing': 'Closing',
            'closed': 'Closed'
        };
        const stateName = stateNames[dataChannel.readyState] || dataChannel.readyState;
        console.warn(`⚠️  Data channel not ready, state: ${stateName} (${dataChannel.readyState}), waiting...`);
        
        // If closed or closing, don't keep retrying - show error
        if (dataChannel.readyState === 'closed' || dataChannel.readyState === 'closing') {
            console.error('❌ Data channel is closed/closing. Connection may be lost.');
            shouldStopQueue = true;
            if (fileQueue.length > 0) {
                fileQueue.forEach(file => {
                    updateFileStatus(file.name, 'error', 'Connection lost - data channel closed');
                });
                fileQueue = [];
            }
            return;
        }
        
        // If peer connection has failed while waiting, stop retrying
        if (peerConnection && (peerConnection.connectionState === 'failed' || peerConnection.iceConnectionState === 'failed')) {
            console.error('❌ Peer connection failed while waiting for data channel');
            shouldStopQueue = true;
            if (fileQueue.length > 0) {
                fileQueue.forEach(file => {
                    updateFileStatus(file.name, 'error', 'Connection failed before data channel could open');
                });
                fileQueue = [];
            }
            return;
        }
        
        if (queueProcessingTimeout) clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = setTimeout(processFileQueue, 500);
        return;
    }
    
    // Wait for buffer to clear - be more conservative
    const maxBufferSize = 128 * 1024; // 128KB max before waiting
    
    if (dataChannel.bufferedAmount > maxBufferSize) {
        console.log('Buffer full, waiting...', Math.round(dataChannel.bufferedAmount / 1024), 'KB');
        if (queueProcessingTimeout) clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = setTimeout(processFileQueue, 500);
        return;
    }
    
    // Get next file from queue
    const file = fileQueue.shift();
    if (!file) {
        updateCancelButton();
        return;
    }
    
    console.log(`Processing file: ${file.name} (${fileQueue.length} remaining in queue)`);
    updateCancelButton();
    
    isSendingFile = true;
    
    try {
        // Wait for buffer to be ready
        let waitCount = 0;
        while (dataChannel.bufferedAmount > 64 * 1024 && waitCount < 200) {
            await new Promise(resolve => setTimeout(resolve, 50));
            waitCount++;
            if (shouldStopQueue) {
                console.log('Queue stopped during buffer wait');
                fileQueue.unshift(file); // Put file back in queue
                isSendingFile = false;
                shouldStopQueue = false;
                updateCancelButton();
                return;
            }
        }
        
        if (waitCount >= 200) {
            console.warn('Buffer wait timeout for file:', file.name);
        }
        
        await sendFile(file);
        console.log('File sent successfully:', file.name);
    } catch (error) {
        console.error('Error sending file:', error);
        const errorMsg = error.message || error.toString() || 'Unknown error occurred';
        updateFileStatus(file.name, 'error', errorMsg);
    } finally {
        isSendingFile = false;
        
        // Wait before processing next file to ensure buffer clears
        if (fileQueue.length > 0 && !shouldStopQueue) {
            if (queueProcessingTimeout) clearTimeout(queueProcessingTimeout);
            queueProcessingTimeout = setTimeout(() => {
                processFileQueue();
            }, 300); // Wait 300ms between files
        } else {
            updateCancelButton();
        }
    }
}

async function sendFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = (error) => {
            console.error('FileReader error:', error);
            const errorMsg = error.message || 'Failed to read file';
            updateFileStatus(file.name, 'error', errorMsg);
            isSendingFile = false;
            reject(error);
        };
        
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                const base64 = arrayBufferToBase64(arrayBuffer);
                
                const fileData = {
                    type: 'file',
                    name: file.name,
                    size: file.size,
                    fileType: file.type,
                    data: base64
                };
                
                // Update status to sending
                updateFileStatus(file.name, 'sending');
                
                // Wait for buffer to be ready - conservative approach
                let waitCount = 0;
                const maxWait = 300; // Max 15 seconds of waiting
                while (dataChannel.bufferedAmount > 64 * 1024 && waitCount < maxWait) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    waitCount++;
                    if (shouldStopQueue) {
                        reject(new Error('Queue cancelled by user'));
                        return;
                    }
                }
                
                if (waitCount >= maxWait) {
                    console.warn('Buffer wait timeout for file:', file.name, 'bufferedAmount:', dataChannel.bufferedAmount);
                }
                
                // Check if file needs chunking
                const base64Length = base64.length;
                const estimatedJsonSize = base64Length + 500; // Add overhead for JSON structure
                
                if (estimatedJsonSize > CHUNK_SIZE) {
                    // File is too large, send in chunks
                    console.log(`File ${file.name} is large (${Math.round(estimatedJsonSize / 1024)}KB), sending in chunks`);
                    await sendFileInChunks(file, base64, fileData);
                    updateFileStatus(file.name, 'sent');
                    resolve();
                } else {
                    // File is small enough, send normally
                    console.log('Stringifying file data for:', file.name);
                    const jsonString = JSON.stringify(fileData);
                    console.log('JSON string length:', Math.round(jsonString.length / 1024), 'KB');
                    
                    // Send file - ensure data channel is still open
                    if (dataChannel.readyState !== 'open') {
                        const errorMsg = 'Data channel closed during send';
                        updateFileStatus(file.name, 'error', errorMsg);
                        reject(new Error(errorMsg));
                        return;
                    }
                    
                    try {
                        dataChannel.send(jsonString);
                        console.log('File sent successfully:', file.name, 'Size:', file.size, 'JSON size:', Math.round(jsonString.length / 1024), 'KB');
                        
                        // Small delay to ensure message is queued
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        // Update status to sent
                        updateFileStatus(file.name, 'sent');
                        resolve();
                    } catch (sendError) {
                        console.error('Error sending data channel message:', sendError);
                        const errorMsg = sendError.message || sendError.toString() || 'Failed to send file over data channel';
                        updateFileStatus(file.name, 'error', errorMsg);
                        reject(sendError);
                    }
                }
            } catch (error) {
                console.error('Error sending file:', error);
                const errorMsg = error.message || error.toString() || 'Unknown error occurred';
                updateFileStatus(file.name, 'error', errorMsg);
                reject(error);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

function displaySendingFile(file, status = 'queued') {
    const container = document.getElementById('file-list');
    const fileId = file.name.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Check if file already displayed
    if (sendingFiles[file.name]) {
        updateFileStatus(file.name, status);
        return;
    }
    
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item sending-file';
    fileItem.id = `sending-${fileId}`;
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatFileSize(file.size)}</div>
            <div class="file-status" id="status-${fileId}">Queued...</div>
            <div class="file-error-detail" id="error-detail-${fileId}" style="display: none;"></div>
            <div class="file-progress">
                <div class="file-progress-bar" id="progress-${fileId}" style="width: 0%"></div>
            </div>
        </div>
    `;
    container.appendChild(fileItem);
    sendingFiles[file.name] = fileItem;
    updateFileStatus(file.name, status);
}

function updateFileStatus(fileName, status, errorMessage = null) {
    const fileId = fileName.replace(/[^a-zA-Z0-9]/g, '_');
    const statusId = `status-${fileId}`;
    const progressId = `progress-${fileId}`;
    const errorDetailId = `error-detail-${fileId}`;
    const statusEl = document.getElementById(statusId);
    const progressEl = document.getElementById(progressId);
    const errorDetailEl = document.getElementById(errorDetailId);
    
    if (statusEl) {
        switch(status) {
            case 'queued':
                statusEl.textContent = 'Queued...';
                statusEl.style.color = '#ffa726';
                statusEl.style.cursor = 'default';
                statusEl.onclick = null;
                if (progressEl) progressEl.style.width = '10%';
                if (errorDetailEl) errorDetailEl.style.display = 'none';
                break;
            case 'sending':
                statusEl.textContent = 'Sending...';
                statusEl.style.color = '#667eea';
                statusEl.style.cursor = 'default';
                statusEl.onclick = null;
                if (progressEl) progressEl.style.width = '50%';
                if (errorDetailEl) errorDetailEl.style.display = 'none';
                break;
            case 'sent':
                statusEl.textContent = '✓ Sent';
                statusEl.style.color = '#4caf50';
                statusEl.style.cursor = 'default';
                statusEl.onclick = null;
                if (progressEl) progressEl.style.width = '100%';
                if (errorDetailEl) errorDetailEl.style.display = 'none';
                break;
            case 'error':
                statusEl.textContent = '✗ Error (click for details)';
                statusEl.style.color = '#f44336';
                statusEl.style.cursor = 'pointer';
                statusEl.style.textDecoration = 'underline';
                if (progressEl) progressEl.style.width = '100%';
                
                // Store error message
                if (errorMessage) {
                    fileErrors[fileName] = errorMessage;
                }
                
                // Make error clickable to expand
                statusEl.onclick = () => {
                    toggleErrorDetail(fileName);
                };
                
                // Show error detail if it exists
                if (errorDetailEl && fileErrors[fileName]) {
                    errorDetailEl.textContent = fileErrors[fileName];
                }
                break;
        }
    }
}

function toggleErrorDetail(fileName) {
    const fileId = fileName.replace(/[^a-zA-Z0-9]/g, '_');
    const errorDetailEl = document.getElementById(`error-detail-${fileId}`);
    const statusEl = document.getElementById(`status-${fileId}`);
    
    if (errorDetailEl && fileErrors[fileName]) {
        if (errorDetailEl.style.display === 'none' || !errorDetailEl.style.display) {
            errorDetailEl.style.display = 'block';
            if (statusEl) {
                statusEl.textContent = '✗ Error (click to hide)';
            }
        } else {
            errorDetailEl.style.display = 'none';
            if (statusEl) {
                statusEl.textContent = '✗ Error (click for details)';
            }
        }
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Disconnection handling
let isReconnecting = false;
let reconnectCountdown = null;
let disconnectTimeout = null;
let isDisconnected = false;

// Page Visibility API - Track when tab is hidden (user picking files)
let isTabHidden = false;
let filePickerOpenTime = null;
const MAX_FILE_PICKER_TIME = 180000; // 3 minutes max for file picking
const DISCONNECT_DELAY_VISIBLE = 3000; // 3 seconds when tab is visible
const DISCONNECT_DELAY_HIDDEN = 10000; // 10 seconds when tab is hidden (but will check max time)

function handleDisconnection(message) {
    // If already showing disconnection, don't show again
    if (isDisconnected) {
        return;
    }
    
    // Clear any existing timeout
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
    }
    
    // Check if user is picking files (prioritize filePickerOpenTime over visibility)
    const timeSincePickerOpened = filePickerOpenTime ? (Date.now() - filePickerOpenTime) : 0;
    const isPickingFiles = filePickerOpenTime && timeSincePickerOpened < MAX_FILE_PICKER_TIME;
    
    // Determine delay based on file picker status
    let delay;
    if (isPickingFiles) {
        // User is picking files - give them plenty of time regardless of tab visibility
        // (Mobile browsers don't always trigger visibilitychange for file pickers)
        const remainingTime = MAX_FILE_PICKER_TIME - timeSincePickerOpened;
        delay = Math.max(remainingTime, DISCONNECT_DELAY_HIDDEN);
        console.log(`File picker open - delaying disconnection by ${Math.round(delay / 1000)}s (${Math.round(remainingTime / 1000)}s remaining)`);
    } else if (isTabHidden) {
        // Tab is hidden but file picker wasn't opened recently
        delay = DISCONNECT_DELAY_HIDDEN;
        console.log(`Tab hidden - delaying disconnection by ${Math.round(delay / 1000)}s`);
    } else {
        // Tab is visible and no file picker - normal delay
        delay = DISCONNECT_DELAY_VISIBLE;
    }
    
    disconnectTimeout = setTimeout(() => {
        // Double-check if user is still picking files before disconnecting
        const currentTimeSincePicker = filePickerOpenTime ? (Date.now() - filePickerOpenTime) : 0;
        const stillPickingFiles = filePickerOpenTime && currentTimeSincePicker < MAX_FILE_PICKER_TIME;
        
        if (stillPickingFiles) {
            // User is still picking files - cancel disconnection and wait more
            console.log('Cancelling disconnection - user still picking files');
            disconnectTimeout = null;
            // Schedule another check
            handleDisconnection(message);
            return;
        }
        
        console.log('Disconnection confirmed after delay:', message);
        isDisconnected = true;
        
        // Clean up existing connections
        cleanupConnections();
        
        // Show disconnection overlay
        const overlay = document.getElementById('disconnection-overlay');
        const messageEl = document.getElementById('disconnection-message');
        if (overlay && messageEl) {
            messageEl.textContent = message;
            overlay.classList.remove('hidden');
        }
        
        // Hide connected view, show QR container
        document.getElementById('connected-view').classList.add('hidden');
        document.getElementById('qr-container').classList.remove('hidden');
        
        // Setup button handlers
        setupDisconnectionHandlers();
    }, delay);
}

function cleanupConnections() {
    // Clear disconnect timeout if exists
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Close data channel
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    
    // Disconnect signaling client if using it
    if (signalingClient) {
        signalingClient.disconnect();
        signalingClient = null;
    }
    
    // Disconnect Socket.IO socket if using it directly (LAN mode)
    if (socket && socket.connected) {
        socket.disconnect();
        // Remove all listeners to prevent duplicate handlers on reconnect
        socket.removeAllListeners();
    }
    
    // Reset file sending state
    fileQueue = [];
    isSendingFile = false;
    shouldStopQueue = false;
    if (queueProcessingTimeout) {
        clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = null;
    }
    
    // Reset file upload setup flag so handlers can be set up again
    fileUploadSetup = false;
    
    // Reset disconnect flag
    isDisconnected = false;
}

function setupDisconnectionHandlers() {
    const reconnectBtn = document.getElementById('reconnect-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const countdownEl = document.getElementById('reconnect-countdown');
    
    if (reconnectBtn) {
        reconnectBtn.onclick = () => {
            if (isReconnecting) return;
            attemptReconnection(countdownEl);
        };
    }
    
    if (reloadBtn) {
        reloadBtn.onclick = () => {
            location.reload();
        };
    }
}

function attemptReconnection(countdownEl) {
    if (isReconnecting) return;
    
    isReconnecting = true;
    const reconnectBtn = document.getElementById('reconnect-btn');
    if (reconnectBtn) {
        reconnectBtn.disabled = true;
        reconnectBtn.textContent = 'Reconnecting...';
    }
    
    // Show countdown (3 seconds delay to prevent race conditions)
    let countdown = 3;
    if (countdownEl) {
        countdownEl.classList.remove('hidden');
        countdownEl.textContent = `Reconnecting in ${countdown} seconds...`;
    }
    
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownEl) {
            if (countdown > 0) {
                countdownEl.textContent = `Reconnecting in ${countdown} seconds...`;
            } else {
                countdownEl.textContent = 'Reconnecting now...';
            }
        }
        
        if (countdown <= 0) {
            clearInterval(countdownInterval);
            
            // Hide overlay
            const overlay = document.getElementById('disconnection-overlay');
            if (overlay) {
                overlay.classList.add('hidden');
            }
            
            // Reset button
            if (reconnectBtn) {
                reconnectBtn.disabled = false;
                reconnectBtn.textContent = 'Reconnect';
            }
            
            if (countdownEl) {
                countdownEl.classList.add('hidden');
            }
            
            // Reinitialize signaling
            isReconnecting = false;
            isDisconnected = false; // Reset disconnect flag on reconnect
            initializeSignaling();
        }
    }, 1000);
    
    reconnectCountdown = countdownInterval;
}

