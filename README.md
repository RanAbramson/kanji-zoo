# Kanji Zoo

A real-time multiplayer classroom game for learning Japanese animal kanji. An instructor controls the game from a host view while students participate on their own devices.

## How It Works

Players match kanji characters to animal emojis (or vice versa) in timed rounds. Points are awarded based on speed and correctness, with a live leaderboard keeping things competitive.

The game includes 12 animals:

| Kanji | Hiragana | English | Emoji |
|-------|----------|---------|-------|
| 犬 | いぬ | dog | 🐕 |
| 猫 | ねこ | cat | 🐱 |
| 鳥 | とり | bird | 🐦 |
| 魚 | さかな | fish | 🐟 |
| 馬 | うま | horse | 🐴 |
| 牛 | うし | cow | 🐄 |
| 虫 | むし | insect | 🐛 |
| 羊 | ひつじ | sheep | 🐑 |
| 熊 | くま | bear | 🐻 |
| 豚 | ぶた | pig | 🐷 |
| 兎 | うさぎ | rabbit | 🐰 |
| 象 | ぞう | elephant | 🐘 |

## Prerequisites

- Node.js v14+

## Getting Started

```bash
npm install
npm start
```

The server starts on port 3000 by default. Set the `PORT` environment variable to change it.

## Usage

- **Players** open `http://<server-ip>:3000` on their devices and enter a name to join.
- **Host** opens `http://<server-ip>:3000/host` on a projector or shared screen.

### Host Controls

| Button | Action |
|--------|--------|
| Start Game | Resets scores and begins a new game |
| Next Question | Presents the next kanji/emoji matching question |
| Hiragana Round | Runs an optional hiragana reading challenge |
| Show Answer | Reveals the correct answer with kanji, hiragana, romaji, and emoji |
| Reset Game | Returns to the lobby |

### Scoring

- Up to 1,000 points per correct answer, scaling down with response time over a 10-second window.
- Wrong answers score 0 points.
- A game consists of 10 questions.

## Tech Stack

- **Express** - serves both the host and player HTML interfaces
- **Socket.IO** - real-time communication between server and all clients

The entire application is self-contained in `server.js` (no separate frontend files).

## Notes

- All game state is held in memory and lost on server restart.
- Only one game session runs per server instance.
- All devices must be on the same network.
