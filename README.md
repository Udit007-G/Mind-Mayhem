# Mind Meld Mayhem

Mind Meld Mayhem is a fast, real-time party game for 2–8 players. Join with a room code, answer a prompt, and try to think like the rest of the room.

## Features

- Room-code multiplayer with no accounts
- Classic, Majority, Risky, Chaos, and Ultimate Meld rounds
- Server-authoritative matching, scoring, streaks, speed bonuses, and Perfect Melds
- Double Down power-up and live reactions
- Reconnection, host migration, duplicate-name protection, and stale-room cleanup
- Mobile-first player interface with a projector-view entry point

## How to Play

1. Run the server and open the game on each device.
2. One player creates a room and shares the six-character code.
3. Everyone answers the prompt before the timer ends.
4. Matching answers form a Meld and earn points together.
5. Build streaks, use Double Down once, survive Chaos, and win the Ultimate Meld.

## Architecture

The app uses a lightweight Node.js HTTP server and WebSocket transport. Rooms, players, timers, submissions, matching, and scoring live in server memory. Browsers render state and send validated actions; the server never trusts client scores or timers.

## Tech Stack

- Node.js
- `ws`
- Vanilla HTML, CSS, and JavaScript

## Scoring

Matching groups earn `group size × 10`, with separate Majority scoring, capped streak multipliers, a fastest-valid-answer bonus, Perfect Meld bonuses, Chaos/Final multipliers, and an optional Double Down multiplier.

## Running Locally

```powershell
npm.cmd install
npm.cmd start
```

Then open `http://localhost:3000/`.

## Future Improvements

Animated reveal staging, projector-specific rendering, sound effects, richer final statistics, and optional AI prompt generation are natural next steps.
