# Multiplayer Dungeon Shooter

A real-time multiplayer roguelike dungeon shooter experiment built with Colyseus and HTML5 Canvas.

> **Note:** This is an experimental project for learning and exploring real-time multiplayer game development concepts. It is not intended for production use.

## What is this?

This project explores building a multiplayer game with:

- **Real-time state synchronization** using Colyseus WebSocket framework
- **Procedural dungeon generation** with seeded randomness for deterministic results
- **AI pathfinding** using A* algorithm and finite state machine behaviors
- **Client-server architecture** with authoritative server and client-side interpolation

Players explore procedurally generated dungeons, fight enemy bots, and progress through 5 increasingly difficult levels.

## Game Features

- **Multiplayer**: Up to 8 players per room with lobby system
- **5 Levels**: Progressive difficulty (faster bots, more health, more obstacles)
- **Combat**: Shoot enemy bots (2+ hits to kill depending on level)
- **Lives System**: 3 lives with invincibility frames after being hit
- **Transport Portals**: Teleportation spots that move players randomly
- **Activity Feed**: Real-time updates on kills, deaths, and level progression

## Tech Stack

| Layer | Technology |
|-------|------------|
| Server | Node.js, TypeScript, Express |
| Multiplayer | Colyseus (WebSocket-based state sync) |
| Client | HTML5 Canvas, Vanilla JavaScript |
| Package Manager | pnpm |

## Project Structure

```
multiplayer-games/
├── public/                     # Client-side (static files)
│   ├── index.html              # Lobby page
│   ├── lobby.js                # Room browser, create/join logic
│   ├── game.html               # Game page
│   └── game.js                 # Canvas rendering, input handling
│
├── src/                        # Server-side (TypeScript)
│   ├── index.ts                # Server entry point
│   ├── botRunner.ts            # CLI tool to spawn AI player bots
│   ├── rooms/
│   │   ├── DungeonRoom.ts      # Main game room logic
│   │   └── schema/
│   │       └── DungeonState.ts # Colyseus state schema
│   ├── game/
│   │   ├── EnemyBotManager.ts  # NPC enemy AI and spawning
│   │   └── CollisionManager.ts # Collision detection
│   ├── bots/                   # AI player bots (for testing)
│   │   ├── BotManager.ts       # Orchestrates multiple bots
│   │   ├── HeadlessBot.ts      # Headless AI player bot
│   │   └── ai/
│   │       ├── Pathfinding.ts  # A* pathfinding
│   │       └── Strategy.ts     # FSM: HUNT/KITE/RETREAT
│   └── utils/
│       └── dungeonGenerator.ts # Procedural dungeon generation
│
├── package.json
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js v18+
- pnpm

### Installation

```bash
pnpm install
```

### Running the Game

```bash
# Start the server
pnpm start

# Or with hot-reload for development
pnpm dev
```

Then open your browser to `http://localhost:2567`

### Spawning AI Bots (for testing)

```bash
# Spawn 1 bot
pnpm bots

# Spawn multiple bots
pnpm bots --headless 5

# With verbose logging
pnpm bots --headless 10 --verbose
```

## How to Play

1. Enter your player name on the lobby page
2. Create a new room or join an existing one
3. Wait for the host (first player) to start the game
4. Kill enemy bots to progress through levels

### Controls

| Input | Action |
|-------|--------|
| WASD / Arrow Keys | Move |
| Mouse | Aim |
| Spacebar | Shoot |

### Win Condition

Progress through all 5 levels by killing enough bots:
- Level 1: 10 kills
- Level 2: 15 kills
- Level 3: 20 kills
- Level 4: 25 kills
- Level 5: 30 kills

## Experimental Concepts

This project experiments with several game development concepts:

### State Synchronization
The server maintains authoritative game state using Colyseus schemas. Changes are automatically synchronized to all connected clients via WebSocket.

### Procedural Generation
Dungeons are generated using a seeded random number generator, ensuring the same seed produces identical layouts on both server and client.

### AI Systems
- **Enemy Bots**: Use A* pathfinding to chase players with tactical roles (75% direct attack, 25% flanking)
- **Player Bots**: Implement a finite state machine (HUNT/KITE/RETREAT) for testing multiplayer scenarios

### Client Interpolation
Bot movements are interpolated on the client for smooth rendering despite discrete server updates.

## License

ISC
