# Mind Meld Mayhem

Everyone stares at their own phone. Then the room discovers five people had the exact same thought.

![Mind Meld Mayhem demo placeholder](docs/demo-placeholder.gif)

## Why this matters

Mind Meld Mayhem turns “reading the room” into a playable skill. It is not trivia or memorization: players score by predicting what their friends will say, creating instant tension, surprise matches, and comeback moments.

## What it is

A real-time party game for 2–8 players. Join with a room code, answer short prompts, match with the group, survive Chaos rounds, and win the Ultimate Meld.

## Features

- Classic, Majority, Risky, Chaos, and Ultimate Meld rounds
- Server-authoritative matching, scoring, streaks, speed bonuses, and Perfect Melds
- Double Down power-up, reactions, reconnects, host migration, and room cleanup
- Mobile-first player UI plus a spectator projector view

## How to play

1. Create a room and share the six-character code.
2. Everyone joins from their own device.
3. Read the prompt and submit the answer your friends are most likely to choose.
4. Matching answers form a Meld and score together.
5. Build a streak, use Double Down, survive Chaos, and win the final round.

## Game modes

- **Classic Mind Meld:** write any answer; matching groups score together.
- **Majority Mind:** choose the option most of the room will pick.
- **Risky Mind:** choose Safe or Risk It before submitting.
- **Chaos Round:** a clear modifier changes the stakes.
- **Ultimate Meld:** the final round doubles the pressure and points.

## Scoring

Classic matches start at `group size × 10`. Majority rewards the most-selected option. Perfect Meld adds a server-authoritative bonus, the fastest valid answer can earn a small bonus, and capped streak multipliers reward consistency without making the game unwinnable.

## Under the hood

- Server-authoritative scoring means clients cannot set scores, timers, or winners.
- Per-connection message and room-action rate limiting protects live demos from spam.
- UUID-validated session reconnection preserves player identity without accounts.
- WebSockets synchronize rooms, timers, submissions, reveals, reactions, and host migration.

## Running locally

```bash
npm install && npm start
```

Open `http://localhost:3000/`.

Run checks with `npm test`.

## Projector view

Open `http://localhost:3000/?projector=1&room=ROOMCODE` on the shared screen. The projector is a spectator-only connection; players continue answering from their phones.

## Architecture

The app uses a lightweight Node.js HTTP server, the `ws` WebSocket library, and vanilla HTML/CSS/JavaScript. Game rooms are held in memory for a fast, dependency-light hackathon deployment.

## Demo flow

See [DEMO.md](DEMO.md) for a 90-second presentation script.

## Future roadmap

Persistent rooms, richer reveal sequencing, optional sound effects, and AI-assisted prompt packs.
