const socket = io();
let sessionId = null;
let peerConnection = null;
let dataChannel = null;
let qrScanner = null;
let isProcessingQRCode = false; // Prevent multiple QR code processing
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

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
sessionId = urlParams.get('session');

window.addEventListener('DOMContentLoaded', () => {
    setupFileHandlers();
    setupPageVisibilityTracking();
    
    if (sessionId) {
        // Hide scanner, show connecting state
        document.getElementById('scanner-view').classList.add('hidden');
        document.getElementById('connecting-view').classList.remove('hidden');
        
        // Initialize signaling (will use WebSocket or Socket.IO)
        initializeSignaling();
    } else {
        // No session ID - show scanner
        console.log('No session ID in URL, showing scanner');
        // Wait for QrScanner library to load
        waitForQrScanner();
    }
});

// Setup Page Visibility API tracking
function setupPageVisibilityTracking() {
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
    
    // NOTE: File input click tracking is now handled in setupFileInputHandlers only
    // to avoid duplicate event listeners
}

function waitForQrScanner() {
    if (typeof QrScanner !== 'undefined') {
        console.log('QrScanner library loaded');
        return;
    }
    
    // Check every 100ms for up to 5 seconds
    let attempts = 0;
    const maxAttempts = 50;
    const checkInterval = setInterval(() => {
        attempts++;
        if (typeof QrScanner !== 'undefined') {
            console.log('QrScanner library loaded after', attempts * 100, 'ms');
            clearInterval(checkInterval);
        } else if (attempts >= maxAttempts) {
            console.error('QrScanner library failed to load after 5 seconds');
            clearInterval(checkInterval);
            const scannerView = document.getElementById('scanner-view');
            if (scannerView) {
                scannerView.innerHTML = `
                    <p class="subtitle" style="color: #d32f2f;">
                        QR Scanner library failed to load. Please refresh the page.
                    </p>
                `;
            }
        }
    }, 100);
}

// Initialize signaling (Socket.IO or WebSocket)
function initializeSignaling() {
    // Check if we should use the Node.js WebSocket signaling server
    if (window.SIGNALING_SERVER_URL && window.SIGNALING_SERVER_URL.trim() !== '') {
        console.log('Using Node.js WebSocket signaling server:', window.SIGNALING_SERVER_URL);
        signalingClient = new SignalingClient(
            window.SIGNALING_SERVER_URL,
            sessionId,
            'mobile'
        );
        
        // Set up event handlers
        signalingClient.on('peer_connected', () => {
            // Cancel any pending disconnection timeout (connection restored)
            if (disconnectTimeout) {
                clearTimeout(disconnectTimeout);
                disconnectTimeout = null;
            }
            isDisconnected = false;
            
            console.log('Peer connected!');
            document.getElementById('scanner-view').classList.add('hidden');
            document.getElementById('connecting-view').classList.add('hidden');
            document.getElementById('connected-view').classList.remove('hidden');
            initializeWebRTC();
            setupDownloadAllButton();
            // File input handlers will be set up once when data channel opens
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
            handleDisconnection('PC disconnected');
        });
        
        signalingClient.on('error', (error) => {
            console.error('Signaling error:', error);
            document.getElementById('connecting-view').innerHTML = `
                <div style="color: #d32f2f; padding: 20px;">
                    <h3>Connection Error</h3>
                    <p>Failed to connect to signaling server. Please check your network connection.</p>
                </div>
            `;
        });
        
        signalingClient.connect();
    } else {
        // Fall back to existing Socket.IO implementation (LAN mode)
        console.log('Using Socket.IO signaling (LAN mode)');
        setupSocketListeners();
        // Join socket room for Socket.IO
        if (socket.connected) {
            socket.emit('mobile_join', { session_id: sessionId });
        }
    }
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Socket connected');
        // If we have a session ID, try to join
        if (sessionId) {
            socket.emit('mobile_join', { session_id: sessionId });
        }
    });
    
    socket.on('mobile_ready', (data) => {
        console.log('Mobile ready, session:', data.session_id);
    });
    
    socket.on('peer_connected', () => {
        // Cancel any pending disconnection timeout (connection restored)
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
        isDisconnected = false;
        
        console.log('Peer connected!');
        document.getElementById('scanner-view').classList.add('hidden');
        document.getElementById('connecting-view').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
        // Setup button handlers when connected view is shown
        setupDownloadAllButton();
        // File input handlers will be set up once when data channel opens
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        document.getElementById('connecting-view').innerHTML = `
            <div style="color: #d32f2f; padding: 20px;">
                <h3>Connection Error</h3>
                <p>Failed to connect to server. Please check your network connection.</p>
            </div>
        `;
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
    
    socket.on('pc_disconnected', () => {
        handleDisconnection('PC disconnected');
    });
}

function setupFileHandlers() {
    document.getElementById('start-scanner').addEventListener('click', startScanner);
}

function startScanner() {
    const video = document.getElementById('qr-video');
    const startBtn = document.getElementById('start-scanner');
    
    if (!video) {
        console.error('QR video element not found');
        alert('QR video element not found. Please refresh the page.');
        return;
    }
    
    // Check if QrScanner is available
    if (typeof QrScanner === 'undefined') {
        alert('QR Scanner library not loaded. Please refresh the page.');
        console.error('QrScanner is not defined');
        return;
    }
    
    // Reset processing flag in case it was stuck
    isProcessingQRCode = false;
    
    // Clean up any existing scanner instance
    if (qrScanner) {
        try {
            qrScanner.stop().catch(err => console.error('Error stopping existing scanner:', err));
            qrScanner.destroy();
            qrScanner = null;
        } catch (err) {
            console.error('Error destroying existing scanner:', err);
        }
    }
    
    // Hide the start button and show video
    if (startBtn) {
        startBtn.style.display = 'none';
    }
    video.classList.remove('hidden');
    
    // Set video styles to ensure it's visible
    video.style.width = '100%';
    video.style.maxWidth = '400px';
    video.style.borderRadius = '10px';
    video.style.margin = '20px auto';
    video.style.display = 'block';
    
    console.log('Initializing QR Scanner...');
    
    try {
        // Create QR scanner with proper callback handling
        qrScanner = new QrScanner(
            video,
            result => {
                console.log('QR Scanner callback triggered!');
                console.log('Raw result:', result);
                console.log('Result type:', typeof result);
                
                // Prevent processing if already handling a QR code
                if (isProcessingQRCode) {
                    console.log('Already processing QR code, ignoring duplicate scan');
                    return;
                }
                
                // Handle the result - QrScanner returns the data directly as string when returnDetailedScanResult is false
                let scanResult = null;
                
                if (typeof result === 'string') {
                    scanResult = result;
                } else if (result && typeof result === 'object') {
                    // Handle detailed result object
                    if (result.data) {
                        scanResult = result.data;
                    } else if (result.result) {
                        scanResult = result.result;
                    } else if (result.text) {
                        scanResult = result.text;
                    } else {
                        // Try to extract from object
                        scanResult = JSON.stringify(result);
                    }
                }
                
                if (!scanResult) {
                    console.error('Could not extract scan result from:', result);
                    return;
                }
                
                console.log('Processed scan result:', scanResult);
                
                // Mark as processing
                isProcessingQRCode = true;
                
                // Set a timeout to reset the flag in case processing gets stuck (5 seconds)
                setTimeout(() => {
                    if (isProcessingQRCode) {
                        console.warn('QR processing timeout - resetting flag');
                        isProcessingQRCode = false;
                    }
                }, 5000);
                
                // Process the QR code
                handleQRCode(scanResult);
            },
            {
                // Scanner configuration
                highlightScanRegion: true,
                highlightCodeOutline: true,
                maxScansPerSecond: 10, // Increased from 5 to improve detection
                preferredCamera: 'environment', // Use back camera on mobile
                returnDetailedScanResult: false // Simple string result
            }
        );
        
        console.log('QR Scanner instance created, starting...');
        
        qrScanner.start().then(() => {
            console.log('QR Scanner started successfully');
            // Add a visual indicator that scanning is active
            const scannerView = document.getElementById('scanner-view');
            if (scannerView) {
                const statusText = scannerView.querySelector('.scan-status');
                if (!statusText) {
                    const status = document.createElement('p');
                    status.className = 'scan-status';
                    status.style.color = '#4caf50';
                    status.style.marginTop = '10px';
                    status.style.fontWeight = '600';
                    status.textContent = '📷 Camera active - Point at QR code';
                    scannerView.appendChild(status);
                } else {
                    statusText.textContent = '📷 Camera active - Point at QR code';
                    statusText.style.color = '#4caf50';
                }
            }
        }).catch(err => {
            console.error('Error starting scanner:', err);
            alert('Failed to start camera: ' + (err.message || 'Please allow camera access and try again.'));
            // Reset video visibility on error
            video.classList.add('hidden');
            if (startBtn) {
                startBtn.style.display = 'block';
            }
            // Reset processing flag on error
            isProcessingQRCode = false;
        });
    } catch (error) {
        console.error('Error creating QR Scanner:', error);
        alert('Error initializing QR scanner: ' + error.message);
        video.classList.add('hidden');
        if (startBtn) {
            startBtn.style.display = 'block';
        }
        // Reset processing flag on error
        isProcessingQRCode = false;
    }
}

function handleQRCode(result) {
    console.log('=== QR Code Handler Called ===');
    console.log('QR Code scanned - Full result:', result);
    console.log('Result type:', typeof result);
    if (result && typeof result === 'object') {
        console.log('Result keys:', Object.keys(result));
        console.log('Result stringified:', JSON.stringify(result));
    }
    
    // Handle both detailed result object and plain string
    let url;
    if (typeof result === 'string') {
        url = result.trim();
        console.log('Result is a string:', url);
    } else if (result && typeof result === 'object') {
        // Try different possible properties
        if (result.data) {
            url = typeof result.data === 'string' ? result.data.trim() : result.data;
            console.log('Found URL in result.data:', url);
        } else if (result.result) {
            url = typeof result.result === 'string' ? result.result.trim() : result.result;
            console.log('Found URL in result.result:', url);
        } else if (result.text) {
            url = typeof result.text === 'string' ? result.text.trim() : result.text;
            console.log('Found URL in result.text:', url);
        } else {
            // Try to stringify and parse
            console.log('Trying to extract URL from result object');
            const stringified = JSON.stringify(result);
            const urlMatch = stringified.match(/https?:\/\/[^\s"'}]+/);
            if (urlMatch) {
                url = urlMatch[0];
                console.log('Extracted URL from stringified result:', url);
            }
        }
    }
    
    if (!url) {
        console.error('No URL found in QR code result. Full result:', result);
        isProcessingQRCode = false; // Reset flag
        alert('Could not read QR code. Please try scanning again.\n\nDebug info: ' + JSON.stringify(result).substring(0, 100));
        return;
    }
    
    console.log('Processing URL:', url);
    
    try {
        const urlObj = new URL(url);
        const newSessionId = urlObj.searchParams.get('session');
        
        console.log('Parsed URL:', urlObj.href);
        console.log('Session ID:', newSessionId);
        
        if (newSessionId) {
            console.log('Valid QR code detected, session ID:', newSessionId);
            
            // Show feedback
            const scannerView = document.getElementById('scanner-view');
            if (scannerView) {
                const statusText = scannerView.querySelector('.scan-status');
                if (statusText) {
                    statusText.textContent = '✓ QR Code detected! Connecting...';
                    statusText.style.color = '#4caf50';
                } else {
                    // Create status if it doesn't exist
                    const status = document.createElement('p');
                    status.className = 'scan-status';
                    status.style.color = '#4caf50';
                    status.style.marginTop = '10px';
                    status.style.fontWeight = '600';
                    status.textContent = '✓ QR Code detected! Connecting...';
                    scannerView.appendChild(status);
                }
            }
            
            // Stop scanner immediately
            if (qrScanner) {
                try {
                    qrScanner.stop().catch(err => console.error('Error stopping scanner:', err));
                    qrScanner.destroy();
                    qrScanner = null;
                } catch (err) {
                    console.error('Error destroying scanner:', err);
                }
            }
            
            // Small delay to show feedback, then navigate
            setTimeout(() => {
                // Reset flag before navigation
                isProcessingQRCode = false;
                window.location.href = url;
            }, 500);
        } else {
            console.warn('QR code URL does not contain session ID');
            isProcessingQRCode = false; // Reset flag
            alert('Invalid QR code. Please scan the QR code from your computer.\n\nURL: ' + url);
            // Restart scanner after invalid scan
            if (qrScanner) {
                setTimeout(() => {
                    if (qrScanner && !isProcessingQRCode) {
                        qrScanner.start().catch(err => console.error('Error restarting scanner:', err));
                    }
                }, 1000);
            }
        }
    } catch (error) {
        console.error('Error parsing QR code URL:', error, 'URL:', url);
        isProcessingQRCode = false; // Reset flag
        alert('Invalid QR code format. Please scan again.\n\nError: ' + error.message + '\nURL: ' + url);
        // Restart scanner after error
        if (qrScanner) {
            setTimeout(() => {
                if (qrScanner && !isProcessingQRCode) {
                    qrScanner.start().catch(err => console.error('Error restarting scanner:', err));
                }
            }, 1000);
        }
    }
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
            
            // Warn if no relay candidates (TURN servers not working)
            if (candidateCount.relay === 0) {
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
                console.log(`✅ TURN servers working! Got ${candidateCount.relay} relay candidate(s)`);
            }
        }
    };
    
    // Monitor TURN server errors
    peerConnection.onicegatheringstatechange = () => {
        const state = peerConnection.iceGatheringState;
        console.log('ICE gathering state:', state);
        if (state === 'complete') {
            if (candidateCount.relay === 0) {
                console.error('❌ TURN SERVER ISSUE: No relay candidates after gathering complete');
                console.error('   Possible causes:');
                console.error('   - TURN credentials expired or invalid');
                console.error('   - Firewall blocking TURN server ports (80, 443, 3478)');
                console.error('   - Network blocking UDP/TCP TURN traffic');
                console.error('   - TURN server temporarily unavailable');
            }
        }
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
        }
    };
    
    // Handle incoming data channel
    peerConnection.ondatachannel = (event) => {
        console.log('Received data channel:', event.channel.label);
        dataChannel = event.channel;
        setupDataChannel();
    };
}

async function handleOffer(offer) {
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
    
    // If channel is already open, setup handlers immediately
    if (dataChannel.readyState === 'open') {
        clearTimeout(dataChannelTimeout);
        console.log('Data channel already open');
        dataChannel.bufferedAmountLowThreshold = 256 * 1024; // 256KB
        // Setup handlers only once (guard will prevent duplicates)
        if (!fileInputHandlersSetup) {
            setupFileInputHandlers();
        }
        if (fileQueue.length > 0) {
            processFileQueue();
        }
    }
    
    dataChannel.onopen = () => {
        clearTimeout(dataChannelTimeout);
        console.log('✅ Data channel opened successfully');
        // Set buffer threshold for monitoring
        dataChannel.bufferedAmountLowThreshold = 256 * 1024; // 256KB
        // Setup file upload handlers once data channel is ready (guard will prevent duplicates)
        if (!fileInputHandlersSetup) {
            setupFileInputHandlers();
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
            console.log('Received message on data channel, size:', event.data.length);
            const data = JSON.parse(event.data);
            console.log('Parsed data, type:', data.type);
            
            if (data.type === 'file') {
                // Single message file (small files)
                console.log('Receiving file:', data.name, 'Size:', data.size);
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
            } else {
                console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling data channel message:', error);
            console.error('Message length:', event.data ? event.data.length : 'null');
            console.error('Message preview:', event.data ? event.data.substring(0, 200) : 'null');
            // Try to show user-friendly error
            alert('Error receiving file. The file might be too large or corrupted.');
        }
    };
    
    dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
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

function receiveFile(data) {
    console.log('receiveFile called with:', {
        name: data.name,
        size: data.size,
        fileType: data.fileType,
        type: data.type,
        hasData: !!data.data,
        dataLength: data.data ? data.data.length : 0
    });
    
    // Handle both fileType and type properties for compatibility
    const fileType = data.fileType || data.type || 'application/octet-stream';
    
    if (!data.name) {
        console.error('Received file without name:', data);
        return;
    }
    
    if (!data.data) {
        console.error('Received file without data:', data.name);
        return;
    }
    
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
            console.log('Download all clicked');
            const pendingFiles = receivedFiles.filter(f => !f.downloaded);
            console.log('Pending files:', pendingFiles.length);
            if (pendingFiles.length > 0) {
                pendingFiles.forEach(file => {
                    acceptFile(file.id.toString());
                });
            }
        }
        
        if (e.target.id === 'reject-all-btn' || e.target.closest('#reject-all-btn')) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Reject all clicked');
            const pendingFiles = receivedFiles.filter(f => !f.downloaded);
            console.log('Pending files to reject:', pendingFiles.length);
            if (pendingFiles.length > 0) {
                rejectAllFiles();
            }
        }
    });
    
    buttonHandlersSetup = true;
}

// Setup when DOM is ready (mobile.js already has DOMContentLoaded, so use it)
// This will be called from the existing DOMContentLoaded handler

function downloadFile(file) {
    // Always use default download method - reliable and no permission issues
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

// File sending handlers
let fileInputHandlersSetup = false; // Guard to prevent multiple setups

function setupFileInputHandlers() {
    // Prevent multiple setups
    if (fileInputHandlersSetup) {
        console.log('File input handlers already set up, skipping...');
        return;
    }
    
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('file-upload-area');
    const browseBtn = document.getElementById('browse-btn');
    
    if (!fileInput || !uploadArea) {
        console.error('File input or upload area not found');
        return;
    }
    
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
    
    // Handle file selection - queue files for sending
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
            // Clear the input after a small delay to prevent immediate re-trigger
            setTimeout(() => {
                fileInput.value = '';
                isProcessingChange = false;
            }, 100);
            
            // Start processing queue if not already processing
            if (!isSendingFile && fileQueue.length > 0) {
                processFileQueue();
            }
        } else {
            isProcessingChange = false;
        }
    });
    
    fileInputHandlersSetup = true;
    
    // Setup cancel queue button
    const cancelBtn = document.getElementById('cancel-queue-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (confirm(`Cancel ${fileQueue.length} file(s) in queue?`)) {
                cancelQueue();
            }
        });
    }
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
        if (!dataChannel) {
            const error = new Error('Connection not ready. Please wait for the connection to establish...');
            updateFileStatus(file.name, 'error', error.message);
            reject(error);
            return;
        }
        
        if (dataChannel.readyState !== 'open') {
            const error = new Error('Data channel not ready. Please wait a moment and try again.');
            console.log('Data channel state:', dataChannel.readyState);
            updateFileStatus(file.name, 'error', error.message);
            reject(error);
            return;
        }
        
        // Check file size - warn if very large
        if (file.size > 50 * 1024 * 1024) { // 50MB
            console.warn('Large file detected:', file.name, Math.round(file.size / 1024 / 1024), 'MB');
        }
        
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
                console.log('File read, converting to base64:', file.name, 'Size:', Math.round(arrayBuffer.byteLength / 1024), 'KB');
                
                const base64 = arrayBufferToBase64(arrayBuffer);
                console.log('Base64 conversion complete, length:', base64.length);
                
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
            console.error('Error processing file:', error);
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
    
    // Check if tab is hidden (user might be picking files)
    const timeSincePickerOpened = filePickerOpenTime ? (Date.now() - filePickerOpenTime) : 0;
    const isLikelyPickingFiles = isTabHidden && filePickerOpenTime && timeSincePickerOpened < MAX_FILE_PICKER_TIME;
    
    // Determine delay based on visibility and file picker status
    let delay;
    if (isLikelyPickingFiles) {
        // User is likely picking files - give them plenty of time
        // Use the full remaining time (up to MAX_FILE_PICKER_TIME)
        const remainingTime = MAX_FILE_PICKER_TIME - timeSincePickerOpened;
        delay = Math.max(remainingTime, DISCONNECT_DELAY_HIDDEN);
        console.log(`Tab hidden - delaying disconnection by ${Math.round(delay / 1000)}s (user is picking files)`);
    } else if (isTabHidden) {
        // Tab is hidden but file picker wasn't opened recently, or max time exceeded
        delay = DISCONNECT_DELAY_HIDDEN;
        console.log(`Tab hidden - delaying disconnection by ${Math.round(delay / 1000)}s`);
    } else {
        // Tab is visible - normal delay
        delay = DISCONNECT_DELAY_VISIBLE;
    }
    
    disconnectTimeout = setTimeout(() => {
        // Double-check if user is still picking files before disconnecting
        const currentTimeSincePicker = filePickerOpenTime ? (Date.now() - filePickerOpenTime) : 0;
        const stillPickingFiles = isTabHidden && filePickerOpenTime && currentTimeSincePicker < MAX_FILE_PICKER_TIME;
        
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
        
        // Hide connected view, show connecting view (or scanner if no session)
        document.getElementById('connected-view').classList.add('hidden');
        if (sessionId) {
            document.getElementById('connecting-view').classList.remove('hidden');
        } else {
            // Reset scanner view when showing it again
            resetScannerView();
            document.getElementById('scanner-view').classList.remove('hidden');
        }
        
        // Setup button handlers
        setupDisconnectionHandlers();
    }, delay);
}

function resetScannerView() {
    // Reset scanner view to initial state
    const video = document.getElementById('qr-video');
    const startBtn = document.getElementById('start-scanner');
    const scannerView = document.getElementById('scanner-view');
    
    // Hide video and show start button
    if (video) {
        video.classList.add('hidden');
        video.style.display = 'none';
    }
    
    if (startBtn) {
        startBtn.style.display = 'block';
    }
    
    // Remove status text if exists
    if (scannerView) {
        const statusText = scannerView.querySelector('.scan-status');
        if (statusText) {
            statusText.remove();
        }
    }
    
    // Reset processing flag
    isProcessingQRCode = false;
    
    // Clean up any existing scanner
    if (qrScanner) {
        try {
            qrScanner.stop().catch(err => console.error('Error stopping scanner in reset:', err));
            qrScanner.destroy();
            qrScanner = null;
        } catch (err) {
            console.error('Error destroying scanner in reset:', err);
        }
    }
}

function cleanupConnections() {
    // Clear disconnect timeout if exists
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
    
    // Stop QR scanner if running
    if (qrScanner) {
        try {
            qrScanner.stop().catch(err => console.error('Error stopping scanner:', err));
            qrScanner.destroy();
            qrScanner = null;
        } catch (err) {
            console.error('Error destroying scanner:', err);
        }
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
    
    // Reset file input handlers setup flag so handlers can be set up again
    fileInputHandlersSetup = false;
    
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
            
            // Reinitialize signaling if we have a session ID
            isReconnecting = false;
            isDisconnected = false; // Reset disconnect flag on reconnect
            if (sessionId) {
                // Show connecting view
                document.getElementById('scanner-view').classList.add('hidden');
                document.getElementById('connecting-view').classList.remove('hidden');
                initializeSignaling();
            } else {
                // No session ID, show scanner
                document.getElementById('connecting-view').classList.add('hidden');
                document.getElementById('scanner-view').classList.remove('hidden');
            }
        }
    }, 1000);
    
    reconnectCountdown = countdownInterval;
}

