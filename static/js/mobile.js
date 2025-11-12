const socket = io();
let sessionId = null;
let peerConnection = null;
let dataChannel = null;
let qrScanner = null;
let receivedFiles = [];
let fileQueue = [];
let isSendingFile = false;
let sendingFiles = {}; // Track sending files by name
let queueProcessingTimeout = null;
let shouldStopQueue = false;

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
sessionId = urlParams.get('session');

window.addEventListener('DOMContentLoaded', () => {
    setupSocketListeners();
    setupFileHandlers();
    
    if (sessionId) {
        // Hide scanner, show connecting state
        document.getElementById('scanner-view').classList.add('hidden');
        document.getElementById('connecting-view').classList.remove('hidden');
        
        // If already connected, join immediately
        if (socket.connected) {
            console.log('Socket already connected, joining session:', sessionId);
            socket.emit('mobile_join', { session_id: sessionId });
        }
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
        alert('PC disconnected');
        location.reload();
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
                handleQRCode(scanResult);
            },
            {
                // Try simpler config first
                highlightScanRegion: true,
                maxScansPerSecond: 10,
                preferredCamera: 'environment', // Use back camera on mobile
                returnDetailedScanResult: false // Try false first - simpler
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
                }
            }
            
            // Stop scanner
            if (qrScanner) {
                qrScanner.stop().catch(err => console.error('Error stopping scanner:', err));
                qrScanner.destroy();
                qrScanner = null;
            }
            
            // Small delay to show feedback, then navigate
            setTimeout(() => {
                window.location.href = url;
            }, 500);
        } else {
            console.warn('QR code URL does not contain session ID');
            alert('Invalid QR code. Please scan the QR code from your computer.\n\nURL: ' + url);
        }
    } catch (error) {
        console.error('Error parsing QR code URL:', error, 'URL:', url);
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
            socket.emit('ice_candidate', {
                session_id: sessionId,
                candidate: event.candidate
            });
        }
    };
}

async function handleOffer(offer) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('webrtc_answer', {
        session_id: sessionId,
        answer: peerConnection.localDescription
    });
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
                console.log('Receiving file:', data.name, 'Size:', data.size);
                receiveFile(data);
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
        updateFileStatus(file.name, 'error');
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
        updateFileStatus(file.name, 'error');
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
            updateFileStatus(file.name, 'error');
            reject(error);
            return;
        }
        
        if (dataChannel.readyState !== 'open') {
            const error = new Error('Data channel not ready. Please wait a moment and try again.');
            console.log('Data channel state:', dataChannel.readyState);
            updateFileStatus(file.name, 'error');
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
            updateFileStatus(file.name, 'error');
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
                
                // Stringify and send
                console.log('Stringifying file data for:', file.name);
                const jsonString = JSON.stringify(fileData);
                console.log('JSON string length:', Math.round(jsonString.length / 1024), 'KB');
                
                // Check if message is too large (WebRTC typically limits to 64KB-256KB)
                if (jsonString.length > 256 * 1024) { // 256KB limit
                    console.error('File too large to send in one message:', file.name, Math.round(jsonString.length / 1024), 'KB');
                    updateFileStatus(file.name, 'error');
                    reject(new Error(`File too large (${Math.round(jsonString.length / 1024)}KB). Maximum size is approximately 200KB.`));
                    return;
                }
                
                // Send file - ensure data channel is still open
                if (dataChannel.readyState !== 'open') {
                    reject(new Error('Data channel closed during send'));
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
                    updateFileStatus(file.name, 'error');
                    reject(sendError);
                }
            } catch (error) {
                console.error('Error processing file:', error);
                updateFileStatus(file.name, 'error');
                reject(error);
            }
        };
        
        reader.readAsArrayBuffer(file);
    });
}

function displaySendingFile(file, status = 'queued') {
    const container = document.getElementById('file-list');
    
    // Check if file already displayed
    if (sendingFiles[file.name]) {
        updateFileStatus(file.name, status);
        return;
    }
    
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item sending-file';
    fileItem.id = `sending-${file.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatFileSize(file.size)}</div>
            <div class="file-status" id="status-${file.name.replace(/[^a-zA-Z0-9]/g, '_')}">Queued...</div>
            <div class="file-progress">
                <div class="file-progress-bar" id="progress-${file.name.replace(/[^a-zA-Z0-9]/g, '_')}" style="width: 0%"></div>
            </div>
        </div>
    `;
    container.appendChild(fileItem);
    sendingFiles[file.name] = fileItem;
    updateFileStatus(file.name, status);
}

function updateFileStatus(fileName, status) {
    const statusId = `status-${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const progressId = `progress-${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const statusEl = document.getElementById(statusId);
    const progressEl = document.getElementById(progressId);
    
    if (statusEl) {
        switch(status) {
            case 'queued':
                statusEl.textContent = 'Queued...';
                statusEl.style.color = '#ffa726';
                if (progressEl) progressEl.style.width = '10%';
                break;
            case 'sending':
                statusEl.textContent = 'Sending...';
                statusEl.style.color = '#667eea';
                if (progressEl) progressEl.style.width = '50%';
                break;
            case 'sent':
                statusEl.textContent = '✓ Sent';
                statusEl.style.color = '#4caf50';
                if (progressEl) progressEl.style.width = '100%';
                break;
            case 'error':
                statusEl.textContent = '✗ Error';
                statusEl.style.color = '#f44336';
                if (progressEl) progressEl.style.width = '100%';
                break;
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

