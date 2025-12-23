# WebRTC Signaling Server

A Node.js WebSocket server that facilitates peer-to-peer WebRTC connections by relaying signaling messages (offers, answers, and ICE candidates) between peers.

## Features

- ✅ WebSocket-based signaling (lightweight and fast)
- ✅ Session-based peer matching
- ✅ Automatic peer disconnection handling
- ✅ Cloud platform compatible (uses PORT environment variable)
- ✅ Compatible with Koyeb, Railway, Heroku, and other PaaS platforms
- ✅ Health check endpoint

## Installation

```bash
cd signaling-server
npm install
```

## Usage

### Local Development

```bash
npm start
```

The server will start on port 3000 by default (or the port specified in `PORT` environment variable).

### Production (Koyeb/Railway/Heroku)

The server automatically uses the `PORT` environment variable set by the hosting platform (typically port 8000 for Koyeb).

## Configuration

The server listens on the port specified by the `PORT` environment variable. If not set, it defaults to port 3000.

## API

### WebSocket Messages

#### Join Session
```json
{
  "type": "join",
  "session_id": "uuid-here",
  "peer_type": "pc" | "mobile"
}
```

#### Send WebRTC Offer
```json
{
  "type": "webrtc_offer",
  "session_id": "uuid-here",
  "offer": { ... RTCSessionDescriptionInit ... }
}
```

#### Send WebRTC Answer
```json
{
  "type": "webrtc_answer",
  "session_id": "uuid-here",
  "answer": { ... RTCSessionDescriptionInit ... }
}
```

#### Send ICE Candidate
```json
{
  "type": "ice_candidate",
  "session_id": "uuid-here",
  "candidate": { ... RTCIceCandidateInit ... }
}
```

### Server Messages

#### Joined
```json
{
  "type": "joined",
  "session_id": "uuid-here",
  "peer_type": "pc" | "mobile"
}
```

#### Peer Connected
```json
{
  "type": "peer_connected"
}
```

#### Peer Disconnected
```json
{
  "type": "pc_disconnected" | "mobile_disconnected"
}
```

#### Error
```json
{
  "type": "error",
  "message": "Error description"
}
```

## Health Check

GET `/health` - Returns server status and active session count.

## Deployment

For detailed deployment instructions, see the main project's `KOYEB_DEPLOYMENT.md` file.

