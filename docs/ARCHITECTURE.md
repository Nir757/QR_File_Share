# QR File Share - Architecture & Services Overview

## 🏗️ System Architecture

QR File Share uses a **hybrid architecture** combining centralized signaling with peer-to-peer data transfer for secure, efficient file sharing.

```
┌─────────────┐                                      ┌─────────────┐
│   PC (Web)  │                                      │ Mobile (Web)│
│  Browser    │                                      │  Browser    │
└──────┬──────┘                                      └──────┬──────┘
       │                                                    │
       │ ① Generate Session + QR Code                      │
       ├─────────────────────────────────────────────┐     │
       │                                              │     │
       │ ② WebSocket Signaling (Session Matching)    │     │
       ├──────────────────────────────────────────────────►│
       │                Railway Signaling Server           │
       │◄──────────────────────────────────────────────────┤
       │                                              │     │
       │ ③ WebRTC Negotiation (SDP Exchange)         │     │
       ├──────────────────────────────────────────────────►│
       │                  via Signaling                    │
       │◄──────────────────────────────────────────────────┤
       │                                              │     │
       │ ④ ICE Candidates Exchange                    │     │
       ├──────────────────────────────────────────────────►│
       │          STUN/TURN Server Discovery               │
       │◄──────────────────────────────────────────────────┤
       │                                              │     │
       │ ⑤ Direct P2P Data Channel Established       │     │
       ├══════════════════════════════════════════════════►│
       │        File Transfer (Encrypted WebRTC)           │
       │◄══════════════════════════════════════════════════┤
       │                                              │     │
```

---

## 📦 Core Components

### 1. **Flask Web Application**
- **Technology**: Python Flask + Flask-SocketIO
- **Purpose**: Serves web interface and handles session management
- **Deployment**: Can run locally or on Railway/Heroku
- **Key Features**:
  - QR code generation
  - Session ID management
  - WebRTC signaling (LAN mode)
  - Local IP detection

**Files**: `app.py`, `templates/`, `static/`

### 2. **Signaling Server (Node.js WebSocket)**
- **Technology**: Node.js + ws (WebSocket library)
- **Purpose**: Matches peers and relays WebRTC signaling messages
- **Deployment**: Railway (free tier)
- **URL**: `wss://your-app.up.railway.app`
- **Key Features**:
  - Session-based peer matching
  - WebRTC offer/answer relay
  - ICE candidate exchange
  - Automatic cleanup on disconnect
  - Health check endpoint

**Files**: `signaling-server/server.js`

### 3. **WebRTC Data Channel**
- **Technology**: Browser WebRTC API
- **Purpose**: Peer-to-peer file transfer
- **Key Features**:
  - End-to-end encrypted
  - No data touches server
  - Chunked file transfer (200KB chunks)
  - Buffer management
  - Progress tracking

**Files**: `static/js/pc.js`, `static/js/mobile.js`

---

## 🌐 External Services Used

### 1. **Railway** (Signaling Server Hosting)
- **Service**: PaaS (Platform as a Service)
- **Plan**: Free tier (500 hours/month)
- **Purpose**: Hosts WebSocket signaling server
- **URL**: https://railway.app
- **Setup Required**: Yes (deploy signaling-server)
- **Cost**: $0 (free tier) or $5/month (hobby plan)

**Why Railway?**
- Auto-deploys from GitHub
- Free tier sufficient for personal use
- WebSocket support out of the box
- No credit card required for free tier

### 2. **Metered TURN Servers** (NAT Traversal)
- **Service**: WebRTC TURN/STUN infrastructure
- **Plan**: Free trial (500MB/month)
- **Purpose**: Enables connections through NATs/firewalls
- **URL**: https://www.metered.ca
- **Setup Required**: Yes (create account, get credentials)
- **Cost**: $0 (500MB free) then pay-as-you-go

**Why Metered?**
- Reliable TURN server infrastructure
- Global server network
- Better than public TURN servers
- Dedicated credentials (not shared)

**Configuration** (in `pc.js` and `mobile.js`):
```javascript
{
    urls: 'turn:a.relay.metered.ca:443',
    username: 'YOUR_USERNAME',  // Personal credentials
    credential: 'YOUR_PASSWORD'
}
```

### 3. **Google STUN Servers** (Public NAT Discovery)
- **Service**: STUN (Session Traversal Utilities for NAT)
- **Plan**: Free, public
- **Purpose**: Discover public IP for WebRTC
- **Cost**: $0
- **Setup Required**: No (built-in)

**Servers Used**:
```javascript
{ urls: 'stun:stun.l.google.com:19302' }
{ urls: 'stun:stun1.l.google.com:19302' }
// ... up to stun4
```

---

## 🔄 How It Works: Step by Step

### Phase 1: Session Setup
1. **PC runs Flask app** → Generates unique session ID
2. **Flask creates QR code** → Contains URL with session ID
3. **QR displayed** → User scans with mobile camera
4. **Mobile navigates** → Opens URL with session parameter

### Phase 2: Signaling
5. **Both connect** → WebSocket to Railway signaling server
6. **Join session** → Both send session ID to server
7. **Server matches** → Notifies both peers connected
8. **SDP exchange** → Offers/answers relayed via signaling

### Phase 3: Connection
9. **ICE gathering** → Both gather NAT traversal candidates
10. **STUN queries** → Discover public IPs via Google STUN
11. **TURN allocation** → Get relay addresses from Metered
12. **Candidate exchange** → Share all candidates via signaling

### Phase 4: P2P Establishment
13. **WebRTC negotiation** → Try direct connection first
14. **Fallback to TURN** → Use relay if direct fails
15. **Data channel opens** → Secure P2P tunnel established
16. **Signaling done** → Server no longer needed

### Phase 5: File Transfer
17. **File selected** → Convert to base64
18. **Chunked transfer** → Send 200KB chunks via data channel
19. **Progress tracking** → Update UI for each chunk
20. **File received** → Reassemble and offer download

---

## 🔒 Security & Privacy

### What's Encrypted
✅ **WebRTC data channel** → End-to-end encrypted (DTLS-SRTP)  
✅ **Signaling** → WSS (WebSocket Secure) when using Railway  
✅ **File data** → Never touches server, P2P only

### What's NOT Encrypted
⚠️ **Session IDs** → Visible in QR code URL  
⚠️ **Signaling messages** → Metadata visible to signaling server  
⚠️ **LAN mode** → Uses local network (can be sniffed)

### Privacy Features
- No file data stored on servers
- Temporary session IDs (expire on disconnect)
- No user accounts or tracking
- Files deleted from memory after transfer

---

## 📊 Data Flow

### LAN Mode (Same Network)
```
PC → Flask Socket.IO → Mobile
     ↓
   Local network only
   No external services
```

### Cross-Network Mode (Different Networks)
```
PC → Railway Signaling → Mobile
     ↓
   Establish WebRTC via STUN/TURN
     ↓
PC ←═══ P2P Data Channel ═══→ Mobile
     (File data never touches server)
```

---

## 🚀 Deployment Options

### Option 1: Local Only (LAN Mode)
**Setup**: None  
**Cost**: $0  
**Works**: Same WiFi network only  
**Services**: None required  

### Option 2: Cross-Network (Recommended)
**Setup**: Deploy signaling server + Metered account  
**Cost**: $0 (free tiers)  
**Works**: Anywhere with internet  
**Services**: Railway + Metered  

### Option 3: Fully Self-Hosted
**Setup**: Deploy everything on VPS  
**Cost**: ~$5/month (DigitalOcean/Linode)  
**Works**: Anywhere, full control  
**Services**: Your own VPS + coturn TURN server  

---

## 🔧 Configuration

### Environment Variables

**Flask App** (`app.py`):
```bash
SIGNALING_SERVER_URL=wss://your-app.up.railway.app
PORT=5000  # Auto-set by Railway
```

**Signaling Server** (`signaling-server/server.js`):
```bash
PORT=3000  # Auto-set by Railway
```

### WebRTC Configuration

Located in `static/js/pc.js` and `static/js/mobile.js`:

```javascript
const configuration = {
    iceServers: [
        // STUN servers (public IP discovery)
        { urls: 'stun:stun.l.google.com:19302' },
        
        // Your TURN servers (NAT traversal)
        {
            urls: 'turn:a.relay.metered.ca:443',
            username: 'YOUR_METERED_USERNAME',
            credential: 'YOUR_METERED_PASSWORD'
        }
    ],
    iceTransportPolicy: 'all',  // Try both direct and relay
    iceCandidatePoolSize: 10    // Pre-gather candidates
};
```

---

## 📈 Monitoring & Usage

### Check Signaling Server Health
```bash
curl https://your-app.up.railway.app/health
```

Returns:
```json
{
    "status": "ok",
    "sessions": 2,
    "timestamp": "2025-01-13T10:30:00.000Z"
}
```

### Monitor TURN Usage
1. Go to https://www.metered.ca
2. Login to dashboard
3. View "TURN Server" → Usage
4. Check bandwidth consumption

### Check Browser Console
**Good signs**:
```
✅ ICE gathering complete. Total candidates: {host: 2, srflx: 1, relay: 3}
✅ Peer connection established
✅ Data channel opened successfully
```

**Bad signs**:
```
❌ ICE connection failed
❌ Data channel timeout
```

---

## 🛠️ Troubleshooting

### Issue: Cross-network doesn't work
**Check**: 
1. Railway signaling server is running
2. Metered credentials are correct
3. Browser console shows relay candidates
4. Both devices have internet

### Issue: Slow file transfer
**Reasons**:
- Using TURN relay instead of direct P2P
- Poor internet connection
- Large files being chunked

**Solution**: Use LAN mode when possible

### Issue: Connection timeout
**Check**:
1. Firewall blocking WebRTC ports
2. TURN servers accessible
3. Network allows WebRTC

---

## 📚 Technical Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | HTML5, CSS3, JavaScript | User interface |
| WebRTC | Browser WebRTC API | P2P file transfer |
| Signaling (LAN) | Flask-SocketIO | Local mode signaling |
| Signaling (Cross-Net) | Node.js + ws | Remote signaling |
| Backend | Python Flask | Web server |
| QR Generation | qrcode (Python) | Generate QR codes |
| Deployment | Railway PaaS | Signaling server host |
| NAT Traversal | Google STUN + Metered TURN | Connection establishment |

---

## 🎯 Key Decisions & Trade-offs

### Why WebRTC?
✅ Direct P2P transfer (no server bandwidth)  
✅ End-to-end encryption  
✅ Built into browsers (no plugins)  
❌ Complex NAT traversal required  
❌ TURN servers needed for some networks  

### Why Separate Signaling Server?
✅ Works across different networks  
✅ Scalable (Railway auto-scales)  
✅ Can use different tech (Node.js)  
❌ Extra deployment step  
❌ Requires external service  

### Why Metered TURN?
✅ More reliable than free public servers  
✅ Dedicated credentials  
✅ Global infrastructure  
❌ Limited free tier (500MB)  
❌ Requires signup  

---

## 📖 Related Documentation

- **Deployment**: [FLASK_RAILWAY_DEPLOYMENT.md](FLASK_RAILWAY_DEPLOYMENT.md)
- **Signaling Setup**: [SIGNALING_SERVER_DEPLOYMENT.md](SIGNALING_SERVER_DEPLOYMENT.md)
- **P2P Configuration**: [P2P_SETUP.md](P2P_SETUP.md)
- **Quick Start**: [QUICK_START_P2P.md](QUICK_START_P2P.md)

---

## 🔮 Future Improvements

### Potential Enhancements
- [ ] Replace Metered with self-hosted coturn TURN server
- [ ] Add end-to-end encryption on top of WebRTC
- [ ] Implement session passwords for security
- [ ] Add file compression before transfer
- [ ] Support for resumable transfers
- [ ] Multiple simultaneous file transfers
- [ ] Video/audio streaming support
- [ ] Progressive Web App (PWA) support

### Cost Optimization
- Self-host on DigitalOcean ($5/month) instead of Railway
- Deploy coturn TURN server (eliminate Metered dependency)
- Total cost: ~$5/month for unlimited usage

---

**Last Updated**: v1.2.0 (November 13, 2025)

