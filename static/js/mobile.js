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
let downloadFolderHandle = null; // Store the selected download folder handle for the session

// Signaling client for cross-network P2P support
let signalingClient = null;

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
sessionId = urlParams.get('session');

window.addEventListener('DOMContentLoaded', () => {
    setupFileHandlers();
    
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
            console.log('Peer connected!');
            document.getElementById('scanner-view').classList.add('hidden');
            document.getElementById('connecting-view').classList.add('hidden');
            document.getElementById('connected-view').classList.remove('hidden');
            initializeWebRTC();
            setupDownloadAllButton();
            updateFolderIndicator();
            if (!('showDirectoryPicker' in window)) {
                const changeFolderBtn = document.getElementById('change-folder-btn');
                if (changeFolderBtn) {
                    changeFolderBtn.style.display = 'none';
                }
            }
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
        console.log('Peer connected!');
        document.getElementById('scanner-view').classList.add('hidden');
        document.getElementById('connecting-view').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
        // Setup button handlers when connected view is shown
        setupDownloadAllButton();
        // Initialize folder indicator and hide button if API not available
        updateFolderIndicator();
        if (!('showDirectoryPicker' in window)) {
            const changeFolderBtn = document.getElementById('change-folder-btn');
            if (changeFolderBtn) {
                changeFolderBtn.style.display = 'none';
            }
        }
        // setupFileInputHandlers() will be called when data channel opens
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
        // Try without returnDetailedScanResult first to see if callback works
        qrScanner = new QrScanner(
            video,
            result => {
                // Prevent processing if already handling a QR code
                if (isProcessingQRCode) {
                    console.log('Already processing QR code, ignoring duplicate scan');
                    return;
                }
                
                console.log('QR Scanner callback triggered!');
                console.log('Result:', result);
                console.log('Result type:', typeof result);
                
                // Handle the result - QrScanner might return the data directly or as an object
                let scanResult = result;
                if (result && typeof result === 'object' && result.data) {
                    scanResult = result.data;
                } else if (typeof result === 'string') {
                    scanResult = result;
                }
                
                console.log('Processed scan result:', scanResult);
                
                // Mark as processing
                isProcessingQRCode = true;
                
                // Process the QR code
                handleQRCode(scanResult);
            },
            {
                // Scanner configuration
                highlightScanRegion: true,
                highlightCodeOutline: true,
                maxScansPerSecond: 5, // Reduce scan rate to prevent duplicates
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
        });
    } catch (error) {
        console.error('Error creating QR Scanner:', error);
        alert('Error initializing QR scanner: ' + error.message);
        video.classList.add('hidden');
        if (startBtn) {
            startBtn.style.display = 'block';
        }
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
                window.location.href = url;
            }, 500);
        } else {
            console.warn('QR code URL does not contain session ID');
            isProcessingQRCode = false; // Reset flag
            alert('Invalid QR code. Please scan the QR code from your computer.\n\nURL: ' + url);
        }
    } catch (error) {
        console.error('Error parsing QR code URL:', error, 'URL:', url);
        isProcessingQRCode = false; // Reset flag
        alert('Invalid QR code format. Please scan again.\n\nError: ' + error.message + '\nURL: ' + url);
    }
}

function initializeWebRTC() {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // Handle incoming data channel
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
    };
    
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
}

async function handleOffer(offer) {
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
        // Set buffer threshold for monitoring
        dataChannel.bufferedAmountLowThreshold = 256 * 1024; // 256KB
        // Setup file upload handlers once data channel is ready
        setupFileInputHandlers();
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

async function downloadFile(file) {
    // Check if File System Access API is available (Android Chrome)
    // We need showDirectoryPicker for folder selection
    if ('showDirectoryPicker' in window || 'showSaveFilePicker' in window) {
        try {
            await downloadFileWithPicker(file);
        } catch (error) {
            // User cancelled or error occurred, fall back to default download
            if (error.name !== 'AbortError') {
                console.error('Error using file picker, falling back to default download:', error);
            }
            downloadFileDefault(file);
        }
    } else {
        // File System Access API not available, use default download
        downloadFileDefault(file);
    }
}

async function downloadFileWithPicker(file) {
    const blob = new Blob([base64ToArrayBuffer(file.data)], { type: file.type });
    
    // If we have a saved folder handle, save directly to that folder
    if (downloadFolderHandle) {
        try {
            await saveFileToFolder(file, blob, downloadFolderHandle);
            return;
        } catch (error) {
            // Folder handle might be invalid (e.g., user revoked permission)
            console.warn('Saved folder handle invalid, prompting for new folder:', error);
            downloadFolderHandle = null;
            // Fall through to prompt for folder selection
        }
    }
    
    // No saved folder or handle invalid, prompt user to select a folder
    try {
        // Use showDirectoryPicker to let user select a folder
        const folderHandle = await window.showDirectoryPicker();
        downloadFolderHandle = folderHandle;
        
        // Save the file to the selected folder
        await saveFileToFolder(file, blob, folderHandle);
        
        // Update folder indicator
        updateFolderIndicator();
    } catch (error) {
        // User cancelled directory picker, fall back to file picker
        if (error.name === 'AbortError') {
            // User cancelled, use default download instead
            throw error;
        }
        // Other error, try file picker as fallback
        const options = {
            suggestedName: file.name,
            types: [{
                description: 'All Files',
                accept: {
                    'application/octet-stream': ['.*']
                }
            }]
        };
        
        const fileHandle = await window.showSaveFilePicker(options);
        await saveFileToFileHandle(file, blob, fileHandle);
    }
}

async function saveFileToFileHandle(file, blob, fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

async function saveFileToFolder(file, blob, folderHandle) {
    // Try to get or create the file in the folder
    const fileHandle = await folderHandle.getFileHandle(file.name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

function downloadFileDefault(file) {
    const blob = new Blob([base64ToArrayBuffer(file.data)], { type: file.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

function clearDownloadFolder() {
    downloadFolderHandle = null;
    updateFolderIndicator();
}

async function changeDownloadFolder() {
    // Check if File System Access API is available
    if (!('showDirectoryPicker' in window)) {
        alert('Folder selection is not available in this browser. Please use Chrome on Android.');
        return;
    }
    
    try {
        const folderHandle = await window.showDirectoryPicker();
        downloadFolderHandle = folderHandle;
        updateFolderIndicator();
        // Show success message
        const indicator = document.getElementById('download-folder-indicator');
        if (indicator) {
            const originalText = indicator.textContent;
            indicator.textContent = 'Folder selected!';
            indicator.style.color = '#4caf50';
            setTimeout(() => {
                updateFolderIndicator();
            }, 2000);
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error selecting folder:', error);
            alert('Error selecting folder. Please try again.');
        }
        // User cancelled, do nothing
    }
}

// Make functions globally accessible
window.clearDownloadFolder = clearDownloadFolder;
window.changeDownloadFolder = changeDownloadFolder;

function updateFolderIndicator() {
    const indicator = document.getElementById('download-folder-indicator');
    if (indicator) {
        if (downloadFolderHandle) {
            indicator.textContent = 'Custom folder selected';
            indicator.style.color = '#4caf50';
        } else {
            indicator.textContent = 'Default download location';
            indicator.style.color = '#666';
        }
    }
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
function setupFileInputHandlers() {
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('file-upload-area');
    const browseBtn = document.getElementById('browse-btn');
    
    if (!fileInput || !uploadArea) {
        console.error('File input or upload area not found');
        return;
    }
    
    // Click on upload area to trigger file picker
    uploadArea.addEventListener('click', (e) => {
        if (e.target !== browseBtn) {
            fileInput.click();
        }
    });
    
    // Browse button click
    if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
    }
    
    // Handle file selection - queue files for sending
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            Array.from(files).forEach(file => {
                queueFile(file);
            });
            // Clear the input so the same file can be selected again
            fileInput.value = '';
            // Start processing queue if not already processing
            if (!isSendingFile && fileQueue.length > 0) {
                processFileQueue();
            }
        }
    });
    
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
    
    // Hide connected view, show connecting view (or scanner if no session)
    document.getElementById('connected-view').classList.add('hidden');
    if (sessionId) {
        document.getElementById('connecting-view').classList.remove('hidden');
    } else {
        document.getElementById('scanner-view').classList.remove('hidden');
    }
    
    // Setup button handlers
    setupDisconnectionHandlers();
}

function cleanupConnections() {
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

