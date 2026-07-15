# TempChat Secure — Netlify Production Build

This is a production-oriented React + TypeScript + Vite PWA for Netlify with:
- installable PWA setup using `vite-plugin-pwa`
- AES-GCM encrypted local chat history stored in IndexedDB
- WebRTC text and media support
- Netlify Function for lightweight room presence
- SPA redirects for Netlify deployment
- security headers in `netlify.toml`

## Important architecture note

Netlify static hosting does not provide a persistent WebSocket signaling server. Because of that, this Netlify-safe build uses:
- Netlify Function for room presence
- manual SDP/ICE exchange UI for WebRTC handshake

So this is deployable on Netlify, but signaling is not fully automatic. A fully automatic WebRTC handshake needs a persistent signaling server on a platform such as Railway, Fly.io, or Render.

## Local run

```bash
npm install
npm run dev
```

## Netlify deploy

1. Push to GitHub.
2. Import the repo into Netlify.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Functions directory: `netlify/functions`

## Production next steps

- Add TURN credentials.
- Replace manual SDP/ICE exchange with persistent signaling.
- Add auth and room expiry.
- Add abuse limits and rate limiting.
