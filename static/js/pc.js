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

// Mode: 'railway' (cross-network) or 'local' (LAN)
let currentMode = 'railway'; // Default to cross-network

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    // Check if we're on Railway URL or localhost
    if (window.location.hostname.includes('railway.app') || window.location.hostname.includes('ngrok.io')) {
        currentMode = 'railway';
    } else {
        currentMode = 'local';
    }
    updateModeUI();
    await generateSession();
    initializeSignaling();
});

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
            document.getElementById('qr-container').classList.add('hidden');
            document.getElementById('connected-view').classList.remove('hidden');
            initializeWebRTC();
            // Setup file upload handlers immediately (they'll be ready when data channel opens)
            // Reset flag in case of reconnection
            fileUploadSetup = false;
            setupFileUpload();
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
        document.getElementById('qr-container').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
        // Setup file upload handlers immediately (they'll be ready when data channel opens)
        // Reset flag in case of reconnection
        fileUploadSetup = false;
        setupFileUpload();
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
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // Create data channel for file transfer
    dataChannel = peerConnection.createDataChannel('files', { ordered: true });
    setupDataChannel();
    
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

async function handleOffer(offer) {
    if (!peerConnection) {
        initializeWebRTC();
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
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
    dataChannel.onopen = () => {
        console.log('Data channel opened');
        // Setup file upload handlers once data channel is ready
        setupFileUpload();
        // Start processing queue if there are files waiting
        if (fileQueue.length > 0) {
            processFileQueue();
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
    
    dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
    };
    
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
    container.appendChild(fileItem);
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
    
    // Show "no files" message if all files are processed
    const noFilesMsg = document.getElementById('no-files-message');
    if (receivedFiles.length === 0 && noFilesMsg) {
        noFilesMsg.style.display = 'block';
    } else if (noFilesMsg) {
        noFilesMsg.style.display = 'none';
    }
}

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
            fileInput.click();
        }
    });
    
    // Browse button click
    if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            fileInput.click();
        });
    }
    
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
}

async function processFileQueue() {
    // Check if queue should be stopped
    if (shouldStopQueue) {
        console.log('Queue processing stopped by user');
        shouldStopQueue = false;
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
        console.log('Data channel not initialized, waiting...');
        if (queueProcessingTimeout) clearTimeout(queueProcessingTimeout);
        queueProcessingTimeout = setTimeout(processFileQueue, 500);
        return;
    }
    
    if (dataChannel.readyState !== 'open') {
        console.log('Data channel not ready, state:', dataChannel.readyState, 'waiting...');
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

function handleDisconnection(message) {
    console.log('Disconnection detected:', message);
    
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
}

function cleanupConnections() {
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
            initializeSignaling();
        }
    }, 1000);
    
    reconnectCountdown = countdownInterval;
}

