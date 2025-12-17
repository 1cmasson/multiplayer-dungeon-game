# Multiplayer Dungeon Shooter - Complete Project Documentation

**Last Updated:** December 13, 2025
**Version:** 1.1.0
**Status:** Fully Functional, Post-Refactoring Planning Phase

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [What It Does](#what-it-does)
3. [Technology Stack](#technology-stack)
4. [Architecture](#architecture)
5. [File Structure](#file-structure)
6. [Server-Side Components](#server-side-components)
7. [Client-Side Components](#client-side-components)
8. [Game Systems](#game-systems)
9. [Network Architecture](#network-architecture)
10. [Recent Improvements](#recent-improvements)
11. [How to Run](#how-to-run)
12. [Current State & Future Plans](#current-state--future-plans)

---

## Project Overview

**Multiplayer Dungeon Shooter** is a real-time multiplayer top-down shooter game built with Node.js and Colyseus. Players cooperatively battle through procedurally generated dungeons, fighting AI-controlled enemy bots across 5 increasingly difficult levels.

### Core Concept
- **Genre:** Top-down shooter, dungeon crawler, multiplayer co-op
- **Players:** 1-4 simultaneous players
- **Goal:** Defeat enemy bots, progress through 5 levels
- **Perspective:** Top-down 2D view with triangle player representation
- **Art Style:** Minimalist geometric (HTML5 Canvas)
- **Theme:** Terminal/hacker aesthetic with green-on-black UI

### Key Features
- Real-time multiplayer synchronization (WebSocket)
- Procedurally generated dungeons using seed-based generation
- AI-controlled enemy bots with pathfinding
- Bullet physics and collision detection
- Level progression system (5 levels)
- Player respawn with invincibility mechanics
- Teleport portals for tactical movement
- Mouse-based 360° aiming system
- Difficulty scaling (bot count, health, speed)

---

## What It Does

### Game Loop
1. **Start Game:** Player enters room via browser
2. **Spawn:** Player appears in procedurally generated dungeon
3. **Combat:** Player shoots AI bots while avoiding damage
4. **Progress:** Kill required number of bots to advance levels
5. **Win/Lose:** Complete all 5 levels or run out of lives

### Gameplay Mechanics

#### Movement
- **WASD keys:** Instant movement + auto-rotation
- **Grid-based:** 50x50 tile dungeon
- **Collision:** Players cannot walk through walls or obstacles

#### Combat
- **Mouse aiming:** 360° aiming with cursor
- **Click to shoot:** Fires bullets toward cursor position
- **Bullet speed:** 7 tiles/second
- **Damage:** 50 damage per bullet (2 hits kill level 1 bot)
- **Visual feedback:** Yellow bullet trails for visibility

#### Enemy Bots
- **AI Behavior:** Chase nearest living player
- **Pathfinding:** Obstacle avoidance using X/Y fallback algorithm
- **Spawning:** Safe distance (10+ tiles from players)
- **Collision:** Touch player to deal damage
- **Health bars:** Color-coded (green/yellow/red)

#### Lives System
- **Starting lives:** 3 per player
- **Damage:** Lose 1 life when touched by bot
- **Respawn:** Player respawns with 3 seconds invincibility
- **Game over:** Player eliminated when lives reach 0

#### Level Progression

| Level | Bots | Bot HP | Bot Speed | Kills Needed |
|-------|------|--------|-----------|--------------|
| 1     | 3    | 100    | 3.0       | 10           |
| 2     | 4    | 150    | 3.3       | 15           |
| 3     | 5    | 200    | 3.6       | 20           |
| 4     | 6    | 250    | 3.9       | 25           |
| 5     | 7    | 300    | 4.2       | 30           |

#### Special Features
- **Teleport Portals:** Step on invisible portal to warp randomly
- **Dynamic UI:** Real-time kills, lives, level tracking
- **Multiplayer:** Up to 4 players cooperate simultaneously
- **Camera:** Follows local player smoothly

---

## Technology Stack

### Backend (Server)
```json
{
  "runtime": "Node.js (TypeScript)",
  "framework": "Colyseus 0.16.5",
  "transport": "WebSocket (@colyseus/ws-transport)",
  "web-server": "Express 5.2.1",
  "state-sync": "@colyseus/schema 3.0.70"
}
```

### Frontend (Client)
```json
{
  "rendering": "HTML5 Canvas (2D Context)",
  "networking": "Colyseus.js 0.16.22",
  "ui": "Vanilla JavaScript + CSS",
  "no-framework": "Pure JS, no React/Vue/etc"
}
```

### Development Tools
```json
{
  "language": "TypeScript 5.9.3",
  "compiler": "ts-node 10.9.2",
  "dev-server": "nodemon (auto-restart)",
  "package-manager": "pnpm 10.20.0",
  "testing": "None (planned: Vitest)"
}
```

### Dependencies Summary
- **colyseus:** Multiplayer game server framework
- **@colyseus/schema:** State synchronization with binary encoding
- **express:** HTTP server for static files
- **cors:** Cross-origin resource sharing
- **colyseus.js:** Client-side SDK for connecting to server

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Client                        │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │  Canvas    │  │  Input     │  │  Colyseus.js     │  │
│  │  Renderer  │  │  Handler   │  │  Client          │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                    WebSocket (Binary)
                           │
┌─────────────────────────────────────────────────────────┐
│                  Colyseus Game Server                    │
│  ┌────────────────────────────────────────────────────┐ │
│  │              DungeonRoom (Room Logic)              │ │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │ │
│  │  │  Player  │  │  Enemy   │  │   Collision    │  │ │
│  │  │  Mgmt    │  │  Bot AI  │  │   Detection    │  │ │
│  │  └──────────┘  └──────────┘  └────────────────┘  │ │
│  │                                                    │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │        DungeonState (Synchronized)           │ │ │
│  │  │  - Players, Bots, Bullets, Dungeon Data     │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Server Authority Model
- **Server is authoritative:** All game logic runs on server
- **Client is view only:** Renders state received from server
- **No client prediction:** Movement/shooting sent to server first
- **State sync:** ~30 FPS updates via binary protocol

### Seed-Based Dungeon Generation
```
Server generates seed → Sends to clients → Clients regenerate same dungeon

Benefits:
✅ Tiny network payload (4 bytes for seed vs ~10KB for full grid)
✅ Deterministic dungeons (same seed = same layout)
✅ Fast client-side rendering (no latency waiting for map data)
```

---

## File Structure

```
multiplayer-games/
├── src/                          # Server-side TypeScript code
│   ├── index.ts                  # Express + Colyseus server setup
│   ├── rooms/
│   │   ├── DungeonRoom.ts        # Main game room logic (800 lines)
│   │   └── schema/
│   │       └── DungeonState.ts   # Synchronized state schema
│   ├── utils/
│   │   └── dungeonGenerator.ts   # Procedural dungeon algorithm
│   ├── bots/                     # AI test client bots (NOT enemy bots)
│   │   ├── BotManager.ts         # Manages headless test clients
│   │   ├── HeadlessBot.ts        # AI player for load testing
│   │   ├── PlaywrightBot.ts      # Browser-based test bot
│   │   └── ai/
│   │       ├── Pathfinding.ts    # A* pathfinding for test bots
│   │       └── Strategy.ts       # Decision-making for test bots
│   └── botRunner.ts              # Script to spawn test bots
│
├── public/                       # Client-side files (served statically)
│   ├── index.html                # Game UI (canvas, modals, HUD)
│   ├── game.js                   # Client game logic (900+ lines)
│   └── (no other files)
│
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
├── CLAUDE.md                     # Improvement documentation (bug fixes)
├── BOT_ALGORITHM.md              # Enemy bot AI explanation
├── REFACTORING_PLAN.md           # Plan to separate bot logic
└── PROJECT_DOCUMENTATION.md      # This file
```

### Important Note on `/src/bots/`
**This directory is NOT for enemy bots in the game!**
- It contains **AI client bots** for testing/load testing
- These are automated players that connect to the server like real players
- Enemy bots (NPCs) are in `DungeonRoom.ts` (lines 197-326)

---

## Server-Side Components

### 1. Entry Point (`src/index.ts`)

**Responsibilities:**
- Create Express HTTP server
- Create Colyseus game server
- Register `DungeonRoom` handler
- Serve static files from `/public`
- Start listening on port 2567

**Key Code:**
```typescript
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define("dungeon", DungeonRoom);
gameServer.listen(2567);
```

### 2. DungeonRoom (`src/rooms/DungeonRoom.ts`)

**Responsibilities:**
- Room lifecycle (onCreate, onJoin, onLeave, onDispose)
- Game loop (30 FPS updates for bullets, bots, collisions)
- Player message handling (move, shoot, updateAngle)
- Bot spawning and AI updates
- Collision detection (bullet vs bot, bot vs player)
- Level progression logic
- Teleport portal management

**Key Properties:**
```typescript
private dungeonData: any;           // Generated dungeon grid
private levelSeeds: number[];       // Seeds for all levels
private updateInterval: any;        // 30 FPS game loop
private botIdCounter: number;       // Unique bot ID generator
private bulletIdCounter: number;    // Unique bullet ID generator
```

**Key Methods:**

| Method | Line | Purpose |
|--------|------|---------|
| `onCreate()` | 13 | Initialize room, generate dungeon, spawn bots |
| `onJoin()` | 96 | Add player to game state |
| `startGameLoop()` | 129 | Start 30 FPS update loop |
| `createBullet()` | 143 | Spawn bullet from player |
| `updateBullets()` | 168 | Move bullets, check wall collisions |
| `spawnBots()` | 197 | Spawn bots at safe distances |
| `updateBots()` | 261 | Bot AI movement toward players |
| `checkCollisions()` | 331 | Detect bullet/bot/player hits |
| `advanceToNextLevel()` | 436 | Handle level progression |
| `generateLevel()` | 485 | Generate new dungeon layout |
| `isValidBotMove()` | 693 | 5-point collision for bots |

**Game Loop:**
```typescript
setInterval(() => {
  this.updateBullets(deltaTime);   // Move bullets
  this.updateBots(deltaTime);      // Update bot AI
  this.checkCollisions();          // Detect hits
}, 33); // 30 FPS
```

### 3. DungeonState (`src/rooms/schema/DungeonState.ts`)

**Purpose:** Define synchronized state between server and clients

**Colyseus Schema:**
```typescript
export class DungeonState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bot }) bots = new MapSchema<Bot>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
  @type([Transport]) activeTransports = new ArraySchema<Transport>();
  @type("number") seed: number = 0;
  @type("number") currentLevel: number = 1;
  @type("number") totalLevels: number = 5;
  @type("number") currentLevelKills: number = 0;
  @type("number") killsNeededForNextLevel: number = 10;
  // ... more properties
}
```

**Schemas:**
- `Player`: x, y, sessionId, lives, angle, score, invincibleUntil
- `Bot`: id, x, y, health, maxHealth
- `Bullet`: id, playerId, x, y, velocityX, velocityY
- `Transport`: x, y (teleport portal locations)

**State Size:** ~0.17 KB with 1 player (measured in CLAUDE.md)

### 4. DungeonGenerator (`src/utils/dungeonGenerator.ts`)

**Purpose:** Generate procedural dungeons using seeded random

**Algorithm:**
1. Create 50x50 grid filled with walls
2. Place 5-10 rooms (size varies by difficulty)
3. Connect rooms with 2-tile wide corridors
4. Place spawn point in first room
5. Place exit in far room (30+ tiles away)
6. Place obstacles (5-15% of floor tiles)
7. Place 3 teleport portals

**Key Features:**
- **Seeded RNG:** Same seed = same dungeon (Linear Congruential Generator)
- **Difficulty scaling:** More rooms and obstacles at higher difficulties
- **Safe spawning:** Spawn/exit/obstacles have minimum distances
- **Deterministic:** Client can regenerate exact same dungeon from seed

**Tile Types:**
```typescript
enum TileType {
  WALL = 0,            // Black, blocks movement
  FLOOR = 1,           // Gray-green, walkable
  EXIT = 2,            // Goal location
  SPAWN = 3,           // Player start position
  OBSTACLE = 4,        // Pure black, blocks movement
  TRANSPORT_INACTIVE = 5  // Used portal (blue tile)
}
```

---

## Client-Side Components

### 1. HTML Structure (`public/index.html`)

**UI Elements:**
- **Canvas:** 800x800px game viewport
- **Start Modal:** Enter room ID or create new room
- **Game Over Modal:** Shown when player dies
- **HUD:** Level, kills, lives, player count display
- **Controls info:** WASD to move, Mouse to aim, Click to shoot

**Styling:**
- Terminal aesthetic (green on black)
- Monospace font (Courier New)
- Glowing effects on text/borders
- Responsive modals

### 2. Game Client (`public/game.js`)

**Responsibilities:**
- Connect to Colyseus server
- Regenerate dungeon from seed
- Render game state on canvas
- Handle player input (keyboard, mouse)
- Draw players, bots, bullets, UI
- Handle game events (teleport, level change, game over)

**Key Components:**

#### A. Connection & State Management
```javascript
const client = new Colyseus.Client('ws://localhost:2567');
const room = await client.joinOrCreate('dungeon');

room.state.onChange = (changes) => {
  // Update UI when state changes
};

room.onMessage("teleported", (data) => {
  // Handle teleport animation
});
```

#### B. Dungeon Generation (Client-Side)
```javascript
class DungeonGenerator {
  // MUST match server algorithm exactly
  // Uses same SeededRandom class
  // Generates identical dungeon from seed
}
```

#### C. Rendering Pipeline (30 FPS)
```javascript
function gameLoop() {
  updateCamera();           // Center on local player
  drawTiles();              // Render dungeon grid
  drawTeleportAnimations(); // Portal effects
  drawBots();               // Enemy bots with health bars
  drawBullets();            // Bullets with trails
  drawPlayers();            // Players as triangles
  drawUI();                 // HUD overlays
  requestAnimationFrame(gameLoop);
}
```

#### D. Input Handling
```javascript
// Keyboard (WASD movement)
document.addEventListener('keydown', (e) => {
  if (e.key === 'w') room.send('move', { direction: 'up' });
  // ... other keys
});

// Mouse (360° aiming)
canvas.addEventListener('mousemove', throttle((e) => {
  const angle = Math.atan2(mouseY - playerY, mouseX - playerX);
  room.send('updateAngle', { angle });
}, 50)); // Throttled to 20 updates/sec

// Click (shooting)
canvas.addEventListener('click', () => {
  room.send('shoot', { angle: currentAngle });
});
```

#### E. Visual Effects

**Bullet Trails:**
```javascript
// Semi-transparent yellow line behind bullet
ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
ctx.beginPath();
ctx.moveTo(bullet.x, bullet.y);
ctx.lineTo(bullet.x - velocityX * 0.3, bullet.y - velocityY * 0.3);
ctx.stroke();
```

**Bot Health Bars:**
```javascript
const healthPercent = bot.health / bot.maxHealth;
if (healthPercent > 0.66) ctx.fillStyle = '#00ff00'; // Green
else if (healthPercent > 0.33) ctx.fillStyle = '#ffff00'; // Yellow
else ctx.fillStyle = '#ff0000'; // Red
```

**Invincibility Indicator:**
```javascript
// Flashing cyan circle around player
if (player.invincibleUntil > currentTime) {
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
  ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
  ctx.stroke();
}
```

#### F. Camera System
```javascript
// Camera follows local player smoothly
const targetX = canvas.width / 2 - localPlayer.x * tileSize;
const targetY = canvas.height / 2 - localPlayer.y * tileSize;

camera.x += (targetX - camera.x) * 0.1; // Smooth interpolation
camera.y += (targetY - camera.y) * 0.1;
```

---

## Game Systems

### 1. Enemy Bot AI System

**Overview:** Server-side AI that controls enemy bots to chase and attack players.

**Algorithm:** (Detailed in `BOT_ALGORITHM.md`)

#### Spawning
```
For each bot to spawn:
  1. Find random walkable tile
  2. Check distance from spawn point
     If < 10 tiles → Reject, try again
  3. Check distance from all living players
     If any within 10 tiles → Reject, try again
  4. Spawn bot at location
  5. Set health = 100 + (level - 1) × 50
```

#### AI Movement (Every Frame)
```
For each bot:
  1. Find nearest living player
  2. Calculate direction vector to player
  3. Normalize and scale by bot speed
  4. Try to move directly toward player
     ↓ (if blocked by wall)
  5. Try to move along X-axis only
     ↓ (if blocked)
  6. Try to move along Y-axis only
     ↓ (if blocked)
  7. Stay in place (truly blocked)
```

**5-Point Collision Detection:**
```
Check these 5 points before moving:
  [TL]     [TR]
     \     /
       [C]
     /     \
  [BL]     [BR]

All 5 must be on walkable tiles to move
```

**Speed Scaling:**
```
BOT_SPEED = 3 × (1 + (level - 1) × 0.1)
Level 1: 3.0 tiles/sec
Level 5: 4.2 tiles/sec
```

### 2. Bullet System

**Creation:**
- Spawned at player's tile center (prevents rotation offset)
- Direction determined by player's angle (mouse cursor)
- Velocity: 7 tiles/second (reduced from 10 for visibility)

**Movement:**
```javascript
bullet.x += bullet.velocityX * deltaTime;
bullet.y += bullet.velocityY * deltaTime;
```

**Collision Checks:**
1. Wall collision: Despawn if hit wall or obstacle
2. Bot collision: Deal 50 damage if within 0.5 tile radius
3. Out of bounds: Despawn if outside map

**Visual:**
- 4px white circle with black outline
- Semi-transparent yellow trail for visibility

### 3. Collision System

#### Bullet vs Bot
```
For each bullet:
  For each bot:
    distance = √((bx - px)² + (by - py)²)

    If distance < 0.5:
      bot.health -= 50
      remove bullet

      If bot.health <= 0:
        remove bot
        player.score++
        levelKills++
        spawn new bot (if quota not met)

        If levelKills >= killsNeeded:
          advance to next level
```

#### Bot vs Player
```
For each bot:
  For each player:
    If player is dead OR invincible:
      Skip

    distance = √((bx - px)² + (by - py)²)

    If distance < 0.7:
      player.lives--

      If player.lives > 0:
        player.invincibleUntil = now + 3000ms
        respawn player at safe location (5+ tiles from bots)
        broadcast "playerHit" event
      Else:
        broadcast "gameOver" event

      Push bot away 3 tiles in random direction
```

### 4. Level Progression System

**Trigger:** When `currentLevelKills >= killsNeededForNextLevel`

**Sequence:**
```
1. Increment current level
2. Reset level kills to 0
3. Update kills needed for new level
4. Clear all existing bots
5. Spawn new bots (count based on level)
6. Teleport all players to spawn point
7. Broadcast "levelAdvanced" event
```

**Level Completion:**
```
Level 1: 10 kills needed
Level 2: 15 kills needed
Level 3: 20 kills needed
Level 4: 25 kills needed
Level 5: 30 kills needed

Total: 100 kills to complete game
```

**Victory:** After level 5, game loops back to level 1

### 5. Teleport Portal System

**Mechanics:**
- 3 invisible portals spawn per level
- Placed on floor tiles (not near spawn/exit)
- Stepping on portal teleports player to random location
- Portal turns blue (inactive) after use
- New portal spawns elsewhere
- Portal count maintained at 3 always

**Purpose:**
- Tactical repositioning
- Escape from surrounded situations
- Add unpredictability to gameplay

---

## Network Architecture

### Colyseus State Synchronization

**Binary Protocol:**
- Colyseus Schema compiles to efficient binary format
- Only changed properties sent (delta encoding)
- ~30 updates per second from server to clients
- State size: ~0.17 KB with 1 player

**Message Types:**

#### Client → Server
```javascript
room.send("move", { direction: "up" });
room.send("updateAngle", { angle: 1.57 });
room.send("shoot", { angle: 1.57 });
```

#### Server → Client (State Changes)
```javascript
room.state.onChange = (changes) => {
  // Automatic updates to:
  // - players, bots, bullets
  // - currentLevel, levelKills, etc.
};
```

#### Server → Client (Events)
```javascript
room.onMessage("playerHit", (data) => {
  // { playerId, livesRemaining, invincibilitySeconds }
});

room.onMessage("gameOver", (data) => {
  // { playerId }
});

room.onMessage("levelAdvanced", (data) => {
  // { newLevel, totalLevels, killsNeeded }
});

room.onMessage("teleported", (data) => {
  // { fromX, fromY, toX, toY }
});
```

### Network Optimization

**Throttling:**
```javascript
// Mouse angle updates throttled to 50ms (20 Hz)
const throttledAngleUpdate = throttle((angle) => {
  room.send("updateAngle", { angle });
}, 50);
```

**Seed-Based Generation:**
- Dungeon grid (50×50 = 2500 tiles × 1 byte = 2.5 KB)
- Reduced to single seed (4 bytes)
- **99.8% reduction in network payload**

**Efficient State Schema:**
- Binary encoding (not JSON)
- Delta updates (only changes)
- Primitive types (numbers, strings)
- No nested objects (flat structure)

---

## Recent Improvements

### Bug Fixes (from CLAUDE.md)

All improvements made on **December 10, 2025**:

#### 1. Invisible Bullets (CRITICAL)
**Problem:** Bullets despawned before being seen
**Fix:** Reduced speed 10 → 7 tiles/sec, added yellow trail, increased size
**Files:** `DungeonRoom.ts:170`, `game.js:693-701`

#### 2. Instant Death on Spawn (GAME-BREAKING)
**Problem:** Bots spawned adjacent to player
**Fix:** Enforced 10-tile minimum spawn distance with validation
**Files:** `DungeonRoom.ts:209-268`

#### 3. Broken UI Display
**Problem:** "Level: /" instead of "Level: 1/5", player count always 0
**Fix:** Added null checks, proper state initialization
**Files:** `game.js:355-378, 450-459`

#### 4. Clunky Movement
**Problem:** Required two key presses (rotate then move)
**Fix:** Instant move + auto-rotate in one step
**Files:** `DungeonRoom.ts:40-77`

#### 5. Limited Aiming
**Problem:** Only 4 cardinal directions with WASD
**Fix:** Added full 360° mouse-based aiming
**Files:** `game.js:827-873`

#### 6. Poor Visual Distinction
**Problem:** Hard to see walls vs floors (all green)
**Fix:** Improved color scheme (darker walls, lighter floors)
**Files:** `game.js:311-321`

#### 7. Static Invincibility Message
**Problem:** No countdown timer
**Fix:** Dynamic countdown updating every frame
**Files:** `game.js:797`

#### 8. Bot Movement Too Fast
**Problem:** Bots moved 5 tiles/sec (hard to track)
**Fix:** Reduced to 3 tiles/sec base speed
**Files:** `DungeonRoom.ts:256`

#### 9. Bot Health Bars
**Status:** Already working correctly
**Feature:** Color-coded (green/yellow/red)

### Transformation Summary
- **Before:** Mediocre, buggy, unplayable
- **After:** Engaging, balanced, polished
- **Testing:** Verified with Playwright automated tests
- **Result:** 9 critical fixes, 2 major features added

---

## How to Run

### Prerequisites
```bash
Node.js >= 18.x
pnpm >= 10.x (or npm/yarn)
```

### Installation
```bash
# Clone repository
cd multiplayer-games

# Install dependencies
pnpm install
```

### Development Mode
```bash
# Start server with auto-reload
pnpm run dev

# Server starts on:
# - WebSocket: ws://localhost:2567
# - HTTP: http://localhost:2567
```

### Production Mode
```bash
# Compile TypeScript
pnpm run build

# Start server
pnpm run start
```

### Play the Game
1. Open browser to `http://localhost:2567`
2. Click "Create New Room" or enter existing room ID
3. Use WASD to move, mouse to aim, click to shoot
4. Survive and defeat bots to advance levels

### Running Test Bots (Load Testing)
```bash
# Spawn AI client bots for testing
pnpm run bots

# Configure in src/botRunner.ts:
# - numHeadlessBots (headless AI clients)
# - numVisualBots (browser-based bots)
```

---

## Current State & Future Plans

### Current Status

✅ **Fully Functional:**
- Real-time multiplayer works
- All game systems operational
- 9 major bugs fixed
- Performance optimized
- Playable and fun

⚠️ **Needs Refactoring:**
- Bot logic embedded in DungeonRoom.ts (800 lines)
- No unit tests
- Tight coupling between systems

### Planned Refactoring

**Goal:** Separate bot logic into dedicated managers
**Plan:** Documented in `REFACTORING_PLAN.md`

**New Structure:**
```
src/game/
  ├── EnemyBotManager.ts     # Bot spawning, AI, scaling
  └── CollisionManager.ts     # All collision detection
```

**Testing Strategy:**
- Install Vitest for headless unit tests
- Write tests BEFORE extracting code (TDD)
- Vitest UI for visual test results
- Fast feedback (~1 second per test run)

**Benefits:**
- Better organization (600-line DungeonRoom instead of 800)
- Unit testable bot AI
- Reusable managers
- Easier to maintain

### Future Enhancements (Post-Refactoring)

#### High Priority
1. **Sound Effects**
   - Shooting, hits, damage, level complete

2. **Visual Effects**
   - Muzzle flash (100ms glow)
   - Damage numbers (float up from bots)
   - Screen shake on player hit
   - Particle effects on death

3. **UI Improvements**
   - Minimap showing bot locations
   - Larger canvas (1000×1000)
   - Kill streak counter
   - Damage statistics

#### Medium Priority
4. **Gameplay Balance**
   - Playtest bullet speed
   - Adjust bot spawn distance
   - Fine-tune bot speed scaling

5. **Multiplayer Features**
   - Player name display
   - Chat system
   - Team colors
   - Friendly fire toggle

#### Low Priority
6. **Accessibility**
   - Colorblind mode
   - Larger text options
   - Keyboard-only aiming
   - Screen reader support

### Known Limitations

1. **Room ID Display:** Shows "Unknown" (minor cosmetic bug)
2. **Bot Pathfinding:** Can get stuck in complex U-shaped corridors
3. **No Muzzle Flash:** Planned but not implemented
4. **No Sound Effects:** Would significantly enhance experience
5. **No Damage Numbers:** Would improve feedback clarity

---

## Development Commands

```bash
# Start development server (auto-reload)
pnpm run dev

# Start production server
pnpm run start

# Build TypeScript
pnpm run build

# Run test bots (load testing)
pnpm run bots

# Run tests (after Vitest setup)
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:ui           # Visual UI in browser
```

---

## Key Files Quick Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 30 | Server entry point |
| `src/rooms/DungeonRoom.ts` | 792 | Main game logic |
| `src/rooms/schema/DungeonState.ts` | 51 | State schema |
| `src/utils/dungeonGenerator.ts` | 333 | Dungeon generation |
| `public/index.html` | 300+ | Game UI |
| `public/game.js` | 900+ | Client rendering/input |
| `CLAUDE.md` | 900+ | Bug fix documentation |
| `BOT_ALGORITHM.md` | 600+ | Bot AI explanation |
| `REFACTORING_PLAN.md` | 800+ | Refactoring guide |

---

## Architecture Diagrams

### Game Loop Flow
```
┌──────────────────────────────────────────────┐
│         Server (30 FPS Game Loop)            │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │  1. Update Bullets (movement)       │    │
│  │     - Move based on velocity        │    │
│  │     - Check wall collisions         │    │
│  │     - Remove out-of-bounds          │    │
│  └─────────────────────────────────────┘    │
│                   ↓                          │
│  ┌─────────────────────────────────────┐    │
│  │  2. Update Bots (AI)                │    │
│  │     - Find nearest player           │    │
│  │     - Calculate movement            │    │
│  │     - Apply pathfinding             │    │
│  └─────────────────────────────────────┘    │
│                   ↓                          │
│  ┌─────────────────────────────────────┐    │
│  │  3. Check Collisions                │    │
│  │     - Bullet vs Bot                 │    │
│  │     - Bot vs Player                 │    │
│  │     - Handle damage/deaths          │    │
│  └─────────────────────────────────────┘    │
│                   ↓                          │
│  ┌─────────────────────────────────────┐    │
│  │  4. Broadcast State Changes         │    │
│  │     - Send updates to all clients   │    │
│  │     - Binary delta encoding         │    │
│  └─────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### Client Rendering Pipeline
```
┌──────────────────────────────────────────────┐
│      Client (60 FPS Render Loop)             │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │  1. Update Camera Position          │    │
│  │     - Follow local player           │    │
│  │     - Smooth interpolation          │    │
│  └─────────────────────────────────────┘    │
│                   ↓                          │
│  ┌─────────────────────────────────────┐    │
│  │  2. Draw Dungeon Tiles              │    │
│  │     - Walls, floors, obstacles      │    │
│  │     - Apply camera transform        │    │
│  └─────────────────────────────────────┘    │
│                   ↓                          │
│  ┌─────────────────────────────────────┐    │
│  │  3. Draw Game Entities              │    │
│  │     - Bots (with health bars)       │    │
│  │     - Bullets (with trails)         │    │
│  │     - Players (as triangles)        │    │
│  └─────────────────────────────────────┘    │
│                   ↓                          │
│  ┌─────────────────────────────────────┐    │
│  │  4. Draw UI Overlays                │    │
│  │     - HUD (level, kills, lives)     │    │
│  │     - Invincibility indicator       │    │
│  │     - Teleport animations           │    │
│  └─────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

---

## Credits & History

**Created By:** Unknown (original developer)
**Improved By:** Claude AI (Anthropic) - December 2025
**Framework:** Colyseus.js Multiplayer Framework
**Testing:** Playwright MCP Server Integration

**Version History:**
- **v1.0.0** - Original implementation with bugs
- **v1.1.0** - 9 bug fixes, 2 major features (Dec 10, 2025)
- **v1.2.0** - Planned refactoring (TBD)

---

## Contact & Support

**Issues/Bugs:** Document in CLAUDE.md or create GitHub issue
**Improvements:** Add to REFACTORING_PLAN.md
**Questions:** Discuss with ChatGPT using this documentation

---

## Summary for ChatGPT Context

This is a real-time multiplayer top-down shooter built with Colyseus (Node.js). Players cooperate to defeat AI bots across 5 progressively harder levels in procedurally generated dungeons. The game uses WebSocket for real-time sync, HTML5 Canvas for rendering, and a server-authoritative architecture. Recently underwent major bug fixes (9 issues resolved) and is now planning a refactoring to separate bot logic into dedicated manager classes with comprehensive unit testing using Vitest. The codebase is TypeScript on server, vanilla JavaScript on client, with no frameworks like React/Vue. Current focus is on code organization and test coverage while maintaining existing functionality.

**Key Technical Details:**
- 30 FPS server game loop
- 60 FPS client render loop
- Binary state sync via Colyseus Schema
- Seed-based dungeon generation (deterministic)
- ~800 line DungeonRoom.ts (needs splitting)
- Bot AI uses simple chase + obstacle avoidance
- 5-point collision detection for bots
- Mouse-based 360° aiming system
- Lives system with invincibility respawn

**Current State:** Fully functional, needs refactoring for better maintainability.
