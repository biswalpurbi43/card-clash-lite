# Uno Lite

A real-time, turn-based multiplayer card game for 2–8 players.

## Run locally
1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this project folder.
3. Run `npm install`
4. Run `npm start`
5. Open http://localhost:3000

For separate-device testing on the same Wi-Fi, open `http://YOUR_COMPUTER_LOCAL_IP:3000` on another device. For friends outside your network, deploy the app to a Node-capable host (e.g. Render) and share the public URL.

## Gameplay
- 5 cards per player.
- 92-card deck: four colors, numbers 0–9, Skip and Reverse.
- Play by matching color or value/action.
- Draw one card if unable to play; the turn automatically passes.
- Reverse changes direction; in two-player play it acts as Skip.
- First player to play all cards wins.

## Notes
This is an initial playable MVP. Rooms are held in server memory, so restarting the server clears rooms. Reconnection and persistent rooms are not included in this first version.
