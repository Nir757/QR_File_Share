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
        alert('Failed to generate QR code. Please refresh the page.');
    }
}

function setupSocketListeners() {
    socket.on('peer_connected', () => {
        document.getElementById('qr-container').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
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

// File sending
document.getElementById('send-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('file-input');
    if (fileInput.files.length > 0) {
        Array.from(fileInput.files).forEach(file => {
            sendFile(file);
        });
    }
});

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

