const socket = io();
let sessionId = null;
let peerConnection = null;
let dataChannel = null;
let receivedFiles = [];

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
        name: data.name,
        size: data.size,
        type: data.type,
        data: data.data
    };
    
    receivedFiles.push(fileData);
    displayReceivedFile(fileData);
    downloadFile(fileData);
}

function displayReceivedFile(file) {
    const container = document.getElementById('received-files');
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatFileSize(file.size)}</div>
        </div>
    `;
    container.appendChild(fileItem);
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
                sendFile(file);
            });
            fileInput.value = ''; // Reset input
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
                sendFile(file);
            });
        }
    });
}


async function sendFile(file) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        alert('Connection not ready. Please wait...');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const arrayBuffer = e.target.result;
        const base64 = arrayBufferToBase64(arrayBuffer);
        
        const fileData = {
            type: 'file',
            name: file.name,
            size: file.size,
            fileType: file.type,
            data: base64
        };
        
        // Display in file list
        displaySendingFile(file);
        
        // Send file
        dataChannel.send(JSON.stringify(fileData));
    };
    reader.readAsArrayBuffer(file);
}

function displaySendingFile(file) {
    const container = document.getElementById('file-list');
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatFileSize(file.size)}</div>
            <div class="file-progress">
                <div class="file-progress-bar" style="width: 100%"></div>
            </div>
        </div>
    `;
    container.appendChild(fileItem);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

