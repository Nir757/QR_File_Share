const socket = io();
let sessionId = null;
let peerConnection = null;
let dataChannel = null;
let receivedFiles = [];
let fileQueue = [];
let isSendingFile = false;

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    await generateSession();
    setupSocketListeners();
});

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
        const qrImg = document.createElement('img');
        qrImg.src = 'data:image/png;base64,' + data.qr_code;
        document.getElementById('qr-code').appendChild(qrImg);
        
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('qr-container').classList.remove('hidden');
        
        // Join socket room
        socket.emit('pc_join', { session_id: sessionId });
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

function setupSocketListeners() {
    socket.on('peer_connected', () => {
        document.getElementById('qr-container').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
        // setupFileUpload() will be called when data channel opens
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
        alert('Mobile device disconnected');
        location.reload();
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
            socket.emit('ice_candidate', {
                session_id: sessionId,
                candidate: event.candidate
            });
        }
    };
    
    // Create and send offer
    peerConnection.createOffer()
        .then(offer => {
            return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
            socket.emit('webrtc_offer', {
                session_id: sessionId,
                offer: peerConnection.localDescription
            });
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
    
    socket.emit('webrtc_answer', {
        session_id: sessionId,
        answer: peerConnection.localDescription
    });
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        console.log('Data channel opened');
        // Setup file upload handlers once data channel is ready
        setupFileUpload();
    };
    
    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'file') {
                receiveFile(data);
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
                }
            } catch (error) {
                console.error('Error handling data channel message:', error);
            }
        };
    };
}

function receiveFile(data) {
    const fileData = {
        id: Date.now() + Math.random(), // Unique ID for each file
        name: data.name,
        size: data.size,
        type: data.type,
        data: data.data,
        downloaded: false
    };
    
    receivedFiles.push(fileData);
    displayReceivedFile(fileData);
    updateDownloadAllButton();
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
    const pendingFiles = receivedFiles.filter(f => !f.downloaded);
    
    if (pendingFiles.length > 0) {
        if (downloadAllBtn) {
            downloadAllBtn.style.display = 'inline-block';
            downloadAllBtn.textContent = `Download All (${pendingFiles.length})`;
        }
    } else {
        if (downloadAllBtn) {
            downloadAllBtn.style.display = 'none';
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

// Make functions globally accessible
window.acceptFile = acceptFile;
window.rejectFile = rejectFile;

// Setup download all button handler
function setupDownloadAllButton() {
    const downloadAllBtn = document.getElementById('download-all-btn');
    if (downloadAllBtn) {
        // Remove existing listeners and add new one
        const newBtn = downloadAllBtn.cloneNode(true);
        downloadAllBtn.parentNode.replaceChild(newBtn, downloadAllBtn);
        newBtn.addEventListener('click', () => {
            const pendingFiles = receivedFiles.filter(f => !f.downloaded);
            pendingFiles.forEach(file => {
                acceptFile(file.id.toString());
            });
        });
    }
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
function setupFileUpload() {
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('file-upload-area');
    const browseBtn = document.getElementById('browse-btn');
    
    if (!fileInput || !uploadArea) return;
    
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
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            Array.from(files).forEach(file => {
                queueFile(file);
            });
            fileInput.value = ''; // Reset input
            processFileQueue(); // Start processing queue
        }
    });
    
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
}

async function processFileQueue() {
    if (isSendingFile || fileQueue.length === 0) {
        return;
    }
    
    if (!dataChannel || dataChannel.readyState !== 'open') {
        console.log('Data channel not ready, waiting...');
        setTimeout(processFileQueue, 500);
        return;
    }
    
    // Wait for buffer to clear if it's getting full
    if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold || dataChannel.bufferedAmount > 1024 * 1024) {
        console.log('Buffer full, waiting...', dataChannel.bufferedAmount);
        setTimeout(processFileQueue, 100);
        return;
    }
    
    isSendingFile = true;
    const file = fileQueue.shift();
    
    await sendFile(file);
    
    // Small delay between files to prevent buffer overflow
    setTimeout(() => {
        isSendingFile = false;
        processFileQueue(); // Process next file
    }, 100);
}

async function sendFile(file) {
    return new Promise((resolve, reject) => {
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
                
                // Wait for buffer to be ready
                while (dataChannel.bufferedAmount > 512 * 1024) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                // Send file
                dataChannel.send(JSON.stringify(fileData));
                console.log('File sent:', file.name, 'Size:', file.size);
                
                // Update status to sent
                updateFileStatus(file.name, 'sent');
                resolve();
            } catch (error) {
                console.error('Error sending file:', error);
                updateFileStatus(file.name, 'error');
                reject(error);
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

const sendingFiles = {}; // Track sending files by name

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

