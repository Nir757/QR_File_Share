const socket = io();
let sessionId = null;
let peerConnection = null;
let dataChannel = null;
let qrScanner = null;
let receivedFiles = [];

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
sessionId = urlParams.get('session');

if (!sessionId) {
    alert('No session ID found. Please scan the QR code again.');
}

window.addEventListener('DOMContentLoaded', () => {
    setupSocketListeners();
    setupFileHandlers();
    
    if (sessionId) {
        // Hide scanner, show connecting state
        document.getElementById('scanner-view').classList.add('hidden');
        document.getElementById('connecting-view').classList.remove('hidden');
        socket.emit('mobile_join', { session_id: sessionId });
    }
});

function setupSocketListeners() {
    socket.on('peer_connected', () => {
        document.getElementById('scanner-view').classList.add('hidden');
        document.getElementById('connecting-view').classList.add('hidden');
        document.getElementById('connected-view').classList.remove('hidden');
        initializeWebRTC();
        // Setup file handlers after connection is established
        setupFileInputHandlers();
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
    video.classList.remove('hidden');
    
    qrScanner = new QrScanner(
        video,
        result => {
            handleQRCode(result);
        },
        {
            returnDetailedScanResult: true,
            highlightScanRegion: true
        }
    );
    
    qrScanner.start().catch(err => {
        console.error('Error starting scanner:', err);
        alert('Failed to start camera. Please allow camera access.');
    });
}

function handleQRCode(result) {
    const url = result.data;
    const urlObj = new URL(url);
    const newSessionId = urlObj.searchParams.get('session');
    
    if (newSessionId) {
        sessionId = newSessionId;
        qrScanner.stop();
        qrScanner.destroy();
        document.getElementById('qr-video').classList.add('hidden');
        socket.emit('mobile_join', { session_id: sessionId });
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
}

function receiveFile(data) {
    const fileData = {
        name: data.name,
        size: data.size,
        type: data.fileType,
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

// File sending handlers
function setupFileInputHandlers() {
    const fileInput = document.getElementById('file-input');
    const sendBtn = document.getElementById('send-btn');
    
    if (!fileInput || !sendBtn) {
        console.error('File input or send button not found');
        return;
    }
    
    // Handle file selection - send immediately on mobile
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            Array.from(files).forEach(file => {
                sendFile(file);
            });
            // Clear the input so the same file can be selected again
            fileInput.value = '';
        }
    });
    
    // Also handle button click for manual trigger
    sendBtn.addEventListener('click', () => {
        const files = fileInput.files;
        if (files.length > 0) {
            Array.from(files).forEach(file => {
                sendFile(file);
            });
            fileInput.value = '';
        } else {
            // Trigger file picker if no files selected
            fileInput.click();
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

