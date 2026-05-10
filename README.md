# Evil Startups: Panic Pitch Party

A realtime party-game prototype about improvising absurd corporate nonsense under pressure.

## Run

```powershell
node server.js
```

Open the host screen:

```text
http://127.0.0.1:4173
```

Players join from their own devices using the room link shown in the lobby:

```text
http://<host>:4173/?room=ABCD
```

### Static frontend deployment

The frontend is static and can be hosted separately (GitHub Pages, Vercel, Netlify, etc.), but the realtime backend must be hosted on a separate server.

- Use `config.js` to set `window.EVIL_API_BASE` when the frontend is served from a different origin than the backend.
- You can also override the backend at runtime with `?api=https://your-backend-host.com` in the URL.
- On GitHub Pages, the frontend should load from the Pages URL while API calls go to the hosted backend.

## Multiplayer Architecture

- `server.js` serves the frontend and owns realtime room state.
- Rooms are created with short room codes.
- Players join through `/api/rooms/:code/join`.
- Clients subscribe through Server-Sent Events at `/api/rooms/:code/events`.
- Host and players send actions through `/api/rooms/:code/action`.
- The server is authoritative for phases, timers, submissions, votes, scores, and round progression.
- Session persistence is in-memory for now, which is good for fast iteration and simple deployment.

This can be deployed as a lightweight Node service on Render, Fly.io, Railway, or a small VPS. A static frontend could also live on GitHub Pages or Vercel if `API_BASE` is added later, but GitHub Pages alone cannot host the realtime backend.

## Current Loop

- Lobby with live room code and remote player joining
- Host-controlled start
- Intro and theme reveal
- Three polished rounds with synchronized timers
- Private phone/controller submissions
- Shared reveal screen
- Audience/player voting
- Breaking-news event beat
- Final scoreboard and recap

## Dev / Solo Testing

The host lobby includes Solo Dev Mode:

- Add individual fake players
- Fill a party with bots
- Auto-submit bot answers during a round
- Force the next phase
- Simulate a disconnected player

This keeps the core multiplayer loop testable without needing multiple real devices.
