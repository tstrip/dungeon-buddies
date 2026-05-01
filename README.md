# Dungeon Buddies

An original, legally safer, Munchkin-inspired real-time card battler for exactly three remote friends.

This project intentionally does **not** use the Munchkin name, official card names, official wording, official classes/races, official art, logos, or trade dress. It keeps the broad social-card-game shape: open a chamber, fight threats, call backup, sabotage friends, grab loot, and race to Renown 10.

## V1 Rule Locks

- Exactly 3 players.
- No hand size limit.
- Players may sabotage any time during combat.
- First to 10 Renown wins, but the final Renown must come from winning combat.
- The server is authoritative. Clients ask; the server decides.
- V1 uses in-memory state. Restarting the server clears active games.

## Local Run

```bash
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

For a three-player test, open three tabs/windows. Create a room in the first tab, then join the same room code in the other two.

## Production Build

```bash
npm install
npm run build
npm start
```

The Node server serves the built React app from `dist/` and listens on `PORT` or `3001`.

## Docker

```bash
docker build -t dungeon-buddies .
docker run -p 3001:3001 dungeon-buddies
```

Open:

```text
http://localhost:3001
```

## Render Deployment

1. Push this repo to GitHub.
2. Create a new Render **Web Service**.
3. Connect your repo.
4. Use these settings:
   - Environment: `Node`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
5. Deploy.
6. Open the Render URL on your iPad.
7. Create a room and send the room code to your two friends.

## Game Concepts

| Familiar idea | Dungeon Buddies wording |
| --- | --- |
| Door | Chamber |
| Treasure | Loot |
| Monster | Threat |
| Curse | Hex |
| Class | Role |
| Race | Origin |
| Level | Renown |
| Help | Backup |
| Bad Stuff | Consequences |

## Current Card Set

V1 includes 30 Chamber cards and 30 Loot cards, all original placeholder content.

## Known V1 Limits

- In-memory state only.
- No database persistence yet.
- No account system yet.
- No automated combat timer yet; players resolve manually.
- Some edge cases are intentionally simplified for playability.

## Suggested V2

- PostgreSQL persistence.
- Reconnect by saved player token instead of player name.
- Dedicated card editor for custom inside-joke expansions.
- Better combat timing windows.
- Card art upload support.
- Private room links instead of room-code-only join.
