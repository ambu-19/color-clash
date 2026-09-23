# Color Clash

A quick-fire multiplayer color game for 2–6 friends. Create a room, share its six-character code, and race to ten points. No account or build step is required.

## Run it locally

Requires Node.js 20 or newer. In this folder, run:

```sh
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in a browser. To play with friends on the same network, share the host computer's local network address and port `3000`.

## Publish a public game

The included `render.yaml` describes a Render web service. To publish it:

1. Put this project in a Git repository and push it to a Git provider supported by Render.
2. In Render, choose **New → Blueprint**, connect that repository, and apply the `render.yaml` configuration.
3. Wait for the service to become live. Render will provide a public `https://…onrender.com` address; share it with players.

The service uses a single Node process and keeps its live rooms in memory. That keeps deployment simple and supports synchronized WebSocket play on one service instance. Rooms are temporary and will end if the service restarts; for durable rooms or multiple server instances, add shared storage and a shared realtime transport.

## Rules and controls

- The room creator is host. The host starts after a second player joins.
- Each round shows one target color and six color buttons. The first correct tap scores one point; the round advances shortly afterward.
- The first player to ten points wins and can start a replay. A replay resets scores.
- Room codes and invite links can be copied or shared from the waiting room.
- Player names and reconnect identity are kept in the browser. No login is needed.

## Files

- `server.js` — HTTP server, WebSocket room management, and authoritative scoring.
- `index.html`, `style.css`, `app.js` — responsive browser game.
- `render.yaml` — Render deployment blueprint.
