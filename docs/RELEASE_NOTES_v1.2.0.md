# v1.2.0 - Improved Cross-Network Connectivity

## 🎯 Major Improvements
- Replaced unreliable free TURN servers with dedicated Metered credentials
- Added 4 dedicated TURN server configurations for better reliability
- Removed invalid ExpressTurn credentials
- Improved cross-network connectivity for devices on different networks

## 🔧 Technical Changes
- Updated WebRTC TURN server configuration in pc.js and mobile.js
- Prioritized dedicated Metered TURN servers (500MB/month free tier)
- Kept public TURN servers as backup fallback
- Added multiple transport protocols (TCP/UDP) on ports 80 and 443

## 🚀 Benefits
- More reliable file transfers across different networks
- Better connectivity for PC (WiFi) to Mobile (cellular) scenarios
- Reduced connection failures due to TURN server overload
- Improved NAT traversal success rate

## 📊 TURN Server Configuration
- **Primary**: a.relay.metered.ca (dedicated credentials)
- **Backup**: openrelay.metered.ca (public credentials)
- **Protocols**: TCP and UDP on ports 80 and 443

## ✅ Testing Recommendations
- Test with PC on WiFi and mobile on cellular data
- Check browser console for 'relay' ICE candidates
- Verify cloud signaling server connectivity
- Monitor Metered dashboard for usage statistics

## 🔒 Security Note
- This release uses personal Metered credentials
- Do not share credentials publicly
- 500MB/month free tier limit applies

---

**This release significantly improves the reliability of cross-network file sharing!**

