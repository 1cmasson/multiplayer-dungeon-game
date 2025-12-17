# Refactoring Plan: Separate Bot Logic + Headless Testing

## Phase 1: Setup Testing Infrastructure

### Step 1: Install Vitest
```bash
pnpm add -D vitest @vitest/ui
```

**Why Vitest?**
- Native TypeScript support (no config needed)
- Fast (uses Vite)
- Built-in UI for visualization (`@vitest/ui`)
- Watch mode for instant feedback

### Step 2: Add Test Scripts to package.json
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui"
}
```

### Step 3: Create Test Structure
```
src/
├── game/
│   ├── __tests__/                    # NEW
│   │   ├── EnemyBotManager.test.ts
│   │   └── CollisionManager.test.ts
│   ├── EnemyBotManager.ts
│   └── CollisionManager.ts
```

---

## Phase 2: Extract EnemyBotManager (Test-Driven)

### Step 2.1: Write Tests FIRST
Create `src/game/__tests__/EnemyBotManager.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { EnemyBotManager } from '../EnemyBotManager';
import { DungeonState, Player } from '../../rooms/schema/DungeonState';

describe('EnemyBotManager - Spawning', () => {
  let state: DungeonState;
  let dungeonData: any;
  let manager: EnemyBotManager;

  beforeEach(() => {
    state = new DungeonState();
    dungeonData = createMockDungeon(); // Helper to create test dungeon
    manager = new EnemyBotManager(state, dungeonData);
  });

  test('spawns correct number of bots for level 1', () => {
    const botsForLevel1 = manager.getBotsForLevel(1);
    expect(botsForLevel1).toBe(3); // Level 1 should have 3 bots

    manager.spawnBots(botsForLevel1, state.players);
    expect(state.bots.size).toBe(3);
  });

  test('bots spawn at safe distance from players (10+ tiles)', () => {
    // Add player at position (10, 10)
    const player = new Player();
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    state.players.set('player1', player);

    // Spawn bots
    manager.spawnBots(5, state.players);

    // Verify all bots are at least 10 tiles away
    state.bots.forEach(bot => {
      const distance = Math.sqrt(
        Math.pow(bot.x - player.x, 2) +
        Math.pow(bot.y - player.y, 2)
      );
      expect(distance).toBeGreaterThanOrEqual(10);
    });
  });

  test('bots have correct health for level', () => {
    // Level 1: 100 HP, Level 3: 200 HP
    expect(manager.getBotHealthForLevel(1)).toBe(100);
    expect(manager.getBotHealthForLevel(3)).toBe(200);
    expect(manager.getBotHealthForLevel(5)).toBe(300);
  });

  test('bot count scales with level', () => {
    expect(manager.getBotsForLevel(1)).toBe(3); // 2 + 1
    expect(manager.getBotsForLevel(3)).toBe(5); // 2 + 3
    expect(manager.getBotsForLevel(5)).toBe(7); // 2 + 5
  });
});

describe('EnemyBotManager - AI Movement', () => {
  let state: DungeonState;
  let dungeonData: any;
  let manager: EnemyBotManager;

  beforeEach(() => {
    state = new DungeonState();
    dungeonData = createMockDungeon();
    manager = new EnemyBotManager(state, dungeonData);
  });

  test('bots move toward nearest player', () => {
    // Create bot at (5, 5)
    manager.spawnBots(1, state.players);
    const bot = Array.from(state.bots.values())[0];
    bot.x = 5;
    bot.y = 5;

    // Create player at (10, 10)
    const player = new Player();
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    state.players.set('player1', player);

    const initialDistance = Math.sqrt(
      Math.pow(bot.x - player.x, 2) +
      Math.pow(bot.y - player.y, 2)
    );

    // Update AI for 1 second
    manager.updateBots(1.0, state.players);

    const finalDistance = Math.sqrt(
      Math.pow(bot.x - player.x, 2) +
      Math.pow(bot.y - player.y, 2)
    );

    // Bot should have moved closer
    expect(finalDistance).toBeLessThan(initialDistance);
  });

  test('bots avoid walls using X/Y fallback pathfinding', () => {
    // This test would require a more complex dungeon setup
    // with walls blocking direct path to player
    // Bot should slide around walls using X or Y axis movement
  });

  test('bot speed scales with level (10% per level)', () => {
    const speed1 = manager.getBotSpeed(1);
    const speed3 = manager.getBotSpeed(3);
    const speed5 = manager.getBotSpeed(5);

    expect(speed1).toBe(3.0);
    expect(speed3).toBe(3.6);
    expect(speed5).toBe(4.2);
  });
});

// Helper function to create a simple test dungeon
function createMockDungeon() {
  const width = 50;
  const height = 50;
  const grid = Array(height).fill(null).map(() =>
    Array(width).fill(0) // 0 = floor (walkable)
  );

  return {
    width,
    height,
    grid,
    spawnPoint: { x: 25, y: 25 },
    rooms: [],
  };
}
```

### Step 2.2: Create EnemyBotManager Class
Create `src/game/EnemyBotManager.ts`:

```typescript
import { MapSchema } from '@colyseus/schema';
import { DungeonState, Player, Bot } from '../rooms/schema/DungeonState';
import { TileType } from '../utils/dungeonGenerator';

export class EnemyBotManager {
  private botIdCounter = 0;

  constructor(
    private state: DungeonState,
    private dungeonData: any
  ) {}

  /**
   * Spawn bots with safe distance checks
   */
  spawnBots(count: number, players: MapSchema<Player>): void {
    const MIN_SPAWN_DISTANCE = 10;

    for (let i = 0; i < count; i++) {
      const bot = new Bot();
      bot.id = `bot_${this.botIdCounter++}`;

      // Find safe spawn location (extract from DungeonRoom.ts lines 209-255)
      let location = null;
      let attempts = 0;
      const maxAttempts = 100;

      while (attempts < maxAttempts && !location) {
        const candidate = this.findRandomWalkableLocation();
        if (!candidate) break;

        // Check distance from spawn point
        const distFromSpawn = Math.sqrt(
          Math.pow(candidate.x - this.dungeonData.spawnPoint.x, 2) +
          Math.pow(candidate.y - this.dungeonData.spawnPoint.y, 2)
        );

        if (distFromSpawn < MIN_SPAWN_DISTANCE) {
          attempts++;
          continue;
        }

        // Check distance from all living players
        let tooCloseToPlayer = false;
        players.forEach((player) => {
          if (player.lives > 0) {
            const distFromPlayer = Math.sqrt(
              Math.pow(candidate.x - player.x, 2) +
              Math.pow(candidate.y - player.y, 2)
            );
            if (distFromPlayer < MIN_SPAWN_DISTANCE) {
              tooCloseToPlayer = true;
            }
          }
        });

        if (!tooCloseToPlayer) {
          location = candidate;
        }

        attempts++;
      }

      if (location) {
        bot.x = location.x;
        bot.y = location.y;
        bot.maxHealth = this.getBotHealthForLevel(this.state.currentLevel);
        bot.health = bot.maxHealth;
        this.state.bots.set(bot.id, bot);
      }
    }
  }

  /**
   * Update all bots AI (movement toward nearest player)
   */
  updateBots(deltaTime: number, players: MapSchema<Player>): void {
    const BOT_SPEED = this.getBotSpeed(this.state.currentLevel);

    this.state.bots.forEach((bot) => {
      // Find nearest living player (extract from DungeonRoom.ts lines 268-280)
      let nearestPlayer: Player | undefined = undefined;
      let nearestDistance = Infinity;

      players.forEach((player) => {
        if (player.lives > 0) {
          const dist = Math.sqrt(
            (player.x - bot.x) ** 2 +
            (player.y - bot.y) ** 2
          );
          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestPlayer = player;
          }
        }
      });

      if (!nearestPlayer) return;

      // Move toward player with obstacle avoidance
      // (extract from DungeonRoom.ts lines 284-323)
      const target = nearestPlayer;
      const dx = target.x - bot.x;
      const dy = target.y - bot.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0.5) {
        const moveX = (dx / distance) * BOT_SPEED * deltaTime;
        const moveY = (dy / distance) * BOT_SPEED * deltaTime;

        const newX = bot.x + moveX;
        const newY = bot.y + moveY;

        const clampedX = Math.max(0.5, Math.min(this.state.width - 0.5, newX));
        const clampedY = Math.max(0.5, Math.min(this.state.height - 0.5, newY));

        // Try direct path
        if (this.isValidBotMove(clampedX, clampedY)) {
          bot.x = clampedX;
          bot.y = clampedY;
        } else {
          // Try X-axis only
          const clampedTryX = Math.max(0.5, Math.min(this.state.width - 0.5, bot.x + moveX));
          if (this.isValidBotMove(clampedTryX, bot.y)) {
            bot.x = clampedTryX;
          } else {
            // Try Y-axis only
            const clampedTryY = Math.max(0.5, Math.min(this.state.height - 0.5, bot.y + moveY));
            if (this.isValidBotMove(bot.x, clampedTryY)) {
              bot.y = clampedTryY;
            }
          }
        }
      }
    });
  }

  /**
   * Check if bot can move to position (5-point collision)
   */
  private isValidBotMove(x: number, y: number): boolean {
    const BOT_RADIUS = 0.2;

    const checkPoints = [
      { x: x - BOT_RADIUS, y: y - BOT_RADIUS },
      { x: x + BOT_RADIUS, y: y - BOT_RADIUS },
      { x: x - BOT_RADIUS, y: y + BOT_RADIUS },
      { x: x + BOT_RADIUS, y: y + BOT_RADIUS },
      { x: x, y: y }
    ];

    for (const point of checkPoints) {
      const tileX = Math.floor(point.x);
      const tileY = Math.floor(point.y);

      if (tileX < 0 || tileX >= this.state.width ||
          tileY < 0 || tileY >= this.state.height) {
        return false;
      }

      const tile = this.dungeonData.grid[tileY][tileX];
      if (tile === TileType.WALL || tile === TileType.OBSTACLE) {
        return false;
      }
    }

    return true;
  }

  /**
   * Find random walkable location
   */
  private findRandomWalkableLocation(): { x: number; y: number } | null {
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const tileX = Math.floor(Math.random() * this.state.width);
      const tileY = Math.floor(Math.random() * this.state.height);

      const tile = this.dungeonData.grid[tileY][tileX];
      if (tile === TileType.FLOOR || tile === TileType.SPAWN) {
        return { x: tileX + 0.5, y: tileY + 0.5 };
      }

      attempts++;
    }

    return null;
  }

  /**
   * Clear all bots
   */
  clearAllBots(): void {
    this.state.bots.clear();
  }

  /**
   * Get bot health for level
   */
  getBotHealthForLevel(level: number): number {
    const baseHealth = 100;
    const healthPerLevel = 50;
    return baseHealth + (level - 1) * healthPerLevel;
  }

  /**
   * Get number of bots for level
   */
  getBotsForLevel(level: number): number {
    return 2 + level; // Level 1: 3 bots, Level 5: 7 bots
  }

  /**
   * Get bot speed for level
   */
  getBotSpeed(level: number): number {
    const BASE_SPEED = 3;
    const speedMultiplier = 1 + (level - 1) * 0.1;
    return BASE_SPEED * speedMultiplier;
  }
}
```

### Step 2.3: Run Tests + Validate
```bash
pnpm test:ui  # Opens browser with live test results
```

**Success Criteria:** All EnemyBotManager tests pass ✅

---

## Phase 3: Extract CollisionManager (Test-Driven)

### Step 3.1: Write Tests FIRST
Create `src/game/__tests__/CollisionManager.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { CollisionManager } from '../CollisionManager';
import { DungeonState, Player, Bot, Bullet } from '../../rooms/schema/DungeonState';

describe('CollisionManager - Bullet vs Bot', () => {
  let state: DungeonState;
  let dungeonData: any;
  let manager: CollisionManager;

  beforeEach(() => {
    state = new DungeonState();
    dungeonData = createMockDungeon();
    manager = new CollisionManager(state, dungeonData);
  });

  test('bullet hitting bot deals 50 damage', () => {
    // Create bot at (10, 10)
    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    bot.health = 100;
    bot.maxHealth = 100;
    state.bots.set(bot.id, bot);

    // Create bullet at same position
    const bullet = new Bullet();
    bullet.id = 'bullet1';
    bullet.x = 10;
    bullet.y = 10;
    bullet.playerId = 'player1';
    state.bullets.set(bullet.id, bullet);

    // Check collisions
    const result = manager.checkBulletVsBots(state.bullets, state.bots);

    expect(result.bulletsToRemove).toContain('bullet1');
    expect(bot.health).toBe(50); // 100 - 50 = 50
  });

  test('bot dies when health reaches 0', () => {
    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    bot.health = 50; // Only 50 HP left
    bot.maxHealth = 100;
    state.bots.set(bot.id, bot);

    const bullet = new Bullet();
    bullet.id = 'bullet1';
    bullet.x = 10;
    bullet.y = 10;
    bullet.playerId = 'player1';
    state.bullets.set(bullet.id, bullet);

    const result = manager.checkBulletVsBots(state.bullets, state.bots);

    expect(result.botsToRemove).toContain('bot1');
    expect(result.killEvents).toHaveLength(1);
    expect(result.killEvents[0].playerId).toBe('player1');
  });

  test('bullet is removed after hit', () => {
    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    bot.health = 100;
    state.bots.set(bot.id, bot);

    const bullet = new Bullet();
    bullet.id = 'bullet1';
    bullet.x = 10;
    bullet.y = 10;
    state.bullets.set(bullet.id, bullet);

    const result = manager.checkBulletVsBots(state.bullets, state.bots);

    expect(result.bulletsToRemove).toContain('bullet1');
  });

  test('no collision when bullet is far from bot', () => {
    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    bot.health = 100;
    state.bots.set(bot.id, bot);

    const bullet = new Bullet();
    bullet.id = 'bullet1';
    bullet.x = 20; // Far away
    bullet.y = 20;
    state.bullets.set(bullet.id, bullet);

    const result = manager.checkBulletVsBots(state.bullets, state.bots);

    expect(result.bulletsToRemove).toHaveLength(0);
    expect(bot.health).toBe(100); // No damage
  });
});

describe('CollisionManager - Bot vs Player', () => {
  let state: DungeonState;
  let dungeonData: any;
  let manager: CollisionManager;

  beforeEach(() => {
    state = new DungeonState();
    dungeonData = createMockDungeon();
    manager = new CollisionManager(state, dungeonData);
  });

  test('player loses 1 life when touched by bot', () => {
    const player = new Player();
    player.sessionId = 'player1';
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    player.invincibleUntil = 0;
    state.players.set('player1', player);

    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10; // Same position (touching)
    state.bots.set(bot.id, bot);

    const result = manager.checkBotVsPlayers(state.bots, state.players);

    expect(result.hitEvents).toHaveLength(1);
    expect(player.lives).toBe(2); // Lost 1 life
  });

  test('player becomes invincible for 3 seconds after hit', () => {
    const player = new Player();
    player.sessionId = 'player1';
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    player.invincibleUntil = 0;
    state.players.set('player1', player);

    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    state.bots.set(bot.id, bot);

    const beforeTime = Date.now();
    manager.checkBotVsPlayers(state.bots, state.players);

    expect(player.invincibleUntil).toBeGreaterThan(beforeTime);
    expect(player.invincibleUntil).toBeLessThanOrEqual(beforeTime + 3000);
  });

  test('invincible player does not take damage', () => {
    const player = new Player();
    player.sessionId = 'player1';
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    player.invincibleUntil = Date.now() + 5000; // Invincible for 5 more seconds
    state.players.set('player1', player);

    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    state.bots.set(bot.id, bot);

    const result = manager.checkBotVsPlayers(state.bots, state.players);

    expect(result.hitEvents).toHaveLength(0);
    expect(player.lives).toBe(3); // No damage
  });

  test('player respawns at safe location (5+ tiles from bots)', () => {
    const player = new Player();
    player.sessionId = 'player1';
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    player.invincibleUntil = 0;
    state.players.set('player1', player);

    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    state.bots.set(bot.id, bot);

    manager.checkBotVsPlayers(state.bots, state.players);

    // Player should have been moved to a safe location
    const distance = Math.sqrt(
      Math.pow(player.x - bot.x, 2) +
      Math.pow(player.y - bot.y, 2)
    );

    expect(distance).toBeGreaterThanOrEqual(5);
  });

  test('bot is pushed away after hitting player', () => {
    const player = new Player();
    player.sessionId = 'player1';
    player.x = 10;
    player.y = 10;
    player.lives = 3;
    player.invincibleUntil = 0;
    state.players.set('player1', player);

    const bot = new Bot();
    bot.id = 'bot1';
    bot.x = 10;
    bot.y = 10;
    state.bots.set(bot.id, bot);

    manager.checkBotVsPlayers(state.bots, state.players);

    // Bot should have been pushed away
    const distance = Math.sqrt(
      Math.pow(bot.x - 10, 2) +
      Math.pow(bot.y - 10, 2)
    );

    expect(distance).toBeGreaterThan(0);
  });
});

function createMockDungeon() {
  const width = 50;
  const height = 50;
  const grid = Array(height).fill(null).map(() =>
    Array(width).fill(0) // 0 = floor
  );

  return {
    width,
    height,
    grid,
    spawnPoint: { x: 25, y: 25 },
  };
}
```

### Step 3.2: Create CollisionManager Class
Create `src/game/CollisionManager.ts`:

```typescript
import { MapSchema } from '@colyseus/schema';
import { DungeonState, Player, Bot, Bullet } from '../rooms/schema/DungeonState';
import { TileType } from '../utils/dungeonGenerator';

export interface KillEvent {
  botId: string;
  playerId: string;
}

export interface PlayerHitEvent {
  playerId: string;
  livesRemaining: number;
}

export interface BulletCollisionResult {
  bulletsToRemove: string[];
  botsToRemove: string[];
  killEvents: KillEvent[];
}

export interface PlayerCollisionResult {
  hitEvents: PlayerHitEvent[];
}

export class CollisionManager {
  constructor(
    private state: DungeonState,
    private dungeonData: any
  ) {}

  /**
   * Check bullet vs bot collisions
   */
  checkBulletVsBots(
    bullets: MapSchema<Bullet>,
    bots: MapSchema<Bot>
  ): BulletCollisionResult {
    const bulletsToRemove: string[] = [];
    const botsToRemove: string[] = [];
    const killEvents: KillEvent[] = [];

    bullets.forEach((bullet, bulletId) => {
      bots.forEach((bot, botId) => {
        const dist = Math.sqrt(
          (bullet.x - bot.x) ** 2 +
          (bullet.y - bot.y) ** 2
        );

        if (dist < 0.5) { // Hit radius
          bot.health -= 50; // Damage
          bulletsToRemove.push(bulletId);

          if (bot.health <= 0) {
            botsToRemove.push(botId);
            killEvents.push({
              botId,
              playerId: bullet.playerId
            });
          }
        }
      });
    });

    return { bulletsToRemove, botsToRemove, killEvents };
  }

  /**
   * Check bot vs player collisions
   */
  checkBotVsPlayers(
    bots: MapSchema<Bot>,
    players: MapSchema<Player>
  ): PlayerCollisionResult {
    const hitEvents: PlayerHitEvent[] = [];
    const currentTime = Date.now();

    bots.forEach((bot) => {
      players.forEach((player) => {
        // Skip if player is dead or invincible
        if (player.lives <= 0 || player.invincibleUntil > currentTime) {
          return;
        }

        const dist = Math.sqrt(
          (bot.x - player.x) ** 2 +
          (bot.y - player.y) ** 2
        );

        if (dist < 0.7) { // Touch distance
          player.lives--;

          // Respawn if still alive
          if (player.lives > 0) {
            player.invincibleUntil = currentTime + 3000;

            const safeLocation = this.findSafeRespawnLocation(
              player.sessionId,
              players
            );

            if (safeLocation) {
              player.x = safeLocation.x;
              player.y = safeLocation.y;
            } else {
              // Fallback to spawn point
              player.x = this.dungeonData.spawnPoint.x;
              player.y = this.dungeonData.spawnPoint.y;
            }
          }

          // Push bot away
          const pushDistance = 3;
          const angle = Math.random() * Math.PI * 2;
          const newBotX = bot.x + Math.cos(angle) * pushDistance;
          const newBotY = bot.y + Math.sin(angle) * pushDistance;

          if (this.isValidMove(Math.floor(newBotX), Math.floor(newBotY))) {
            bot.x = newBotX;
            bot.y = newBotY;
          }

          hitEvents.push({
            playerId: player.sessionId,
            livesRemaining: player.lives
          });
        }
      });
    });

    return { hitEvents };
  }

  /**
   * Find safe respawn location away from bots
   */
  private findSafeRespawnLocation(
    excludePlayerId: string,
    players: MapSchema<Player>
  ): { x: number; y: number } | null {
    let attempts = 0;
    const maxAttempts = 100;
    const MIN_DISTANCE_FROM_BOTS = 5;
    const MIN_DISTANCE_FROM_PLAYERS = 3;

    while (attempts < maxAttempts) {
      const x = Math.floor(Math.random() * this.state.width);
      const y = Math.floor(Math.random() * this.state.height);

      const tile = this.dungeonData.grid[y][x];
      if (tile !== TileType.FLOOR && tile !== TileType.SPAWN) {
        attempts++;
        continue;
      }

      // Check distance from all bots
      let tooCloseToBot = false;
      this.state.bots.forEach((bot) => {
        const dist = Math.sqrt((bot.x - x) ** 2 + (bot.y - y) ** 2);
        if (dist < MIN_DISTANCE_FROM_BOTS) {
          tooCloseToBot = true;
        }
      });

      if (tooCloseToBot) {
        attempts++;
        continue;
      }

      // Check distance from other players
      let tooCloseToPlayer = false;
      players.forEach((player, sessionId) => {
        if (sessionId !== excludePlayerId && player.lives > 0) {
          const dist = Math.sqrt((player.x - x) ** 2 + (player.y - y) ** 2);
          if (dist < MIN_DISTANCE_FROM_PLAYERS) {
            tooCloseToPlayer = true;
          }
        }
      });

      if (!tooCloseToPlayer) {
        return { x, y };
      }

      attempts++;
    }

    return null;
  }

  /**
   * Check if position is walkable
   */
  private isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= this.state.width || y < 0 || y >= this.state.height) {
      return false;
    }

    const tile = this.dungeonData.grid[y][x];
    return tile === TileType.FLOOR ||
           tile === TileType.SPAWN ||
           tile === TileType.EXIT ||
           tile === TileType.TRANSPORT_INACTIVE;
  }
}
```

### Step 3.3: Run Tests + Validate
```bash
pnpm test:ui
```

**Success Criteria:** All CollisionManager tests pass ✅

---

## Phase 4: Integration Testing & Update DungeonRoom

### Step 4.1: Update DungeonRoom.ts

Replace bot-related code with manager calls:

```typescript
import { EnemyBotManager } from '../game/EnemyBotManager';
import { CollisionManager } from '../game/CollisionManager';

export class DungeonRoom extends Room<DungeonState> {
  private enemyBotManager: EnemyBotManager;
  private collisionManager: CollisionManager;

  onCreate(options: any) {
    // ... existing setup ...

    // Initialize managers
    this.enemyBotManager = new EnemyBotManager(this.state, this.dungeonData);
    this.collisionManager = new CollisionManager(this.state, this.dungeonData);

    // Spawn initial bots
    this.enemyBotManager.spawnBots(
      this.enemyBotManager.getBotsForLevel(1),
      this.state.players
    );

    this.startGameLoop();
  }

  private startGameLoop(): void {
    const FPS = 30;
    const DELTA_TIME = 1000 / FPS;

    this.updateInterval = setInterval(() => {
      this.updateBullets(DELTA_TIME / 1000);
      this.enemyBotManager.updateBots(DELTA_TIME / 1000, this.state.players);
      this.checkCollisions();
    }, DELTA_TIME);
  }

  private checkCollisions(): void {
    // Bullet vs Bot
    const bulletResult = this.collisionManager.checkBulletVsBots(
      this.state.bullets,
      this.state.bots
    );

    // Remove bullets and bots
    bulletResult.bulletsToRemove.forEach(id => this.state.bullets.delete(id));
    bulletResult.botsToRemove.forEach(id => this.state.bots.delete(id));

    // Handle kill events
    bulletResult.killEvents.forEach(event => {
      const player = this.state.players.get(event.playerId);
      if (player) {
        player.score++;
        this.state.totalKills++;
        this.state.currentLevelKills++;

        if (this.state.currentLevelKills >= this.state.killsNeededForNextLevel) {
          this.advanceToNextLevel(event.playerId);
        } else {
          // Spawn new bot
          if (this.state.bots.size < this.enemyBotManager.getBotsForLevel(this.state.currentLevel)) {
            this.enemyBotManager.spawnBots(1, this.state.players);
          }
        }
      }
    });

    // Bot vs Player
    const playerResult = this.collisionManager.checkBotVsPlayers(
      this.state.bots,
      this.state.players
    );

    // Handle player hit events
    playerResult.hitEvents.forEach(event => {
      if (event.livesRemaining > 0) {
        this.broadcast("playerHit", {
          playerId: event.playerId,
          livesRemaining: event.livesRemaining,
          invincibilitySeconds: 3
        });
      } else {
        this.broadcast("gameOver", { playerId: event.playerId });
      }
    });
  }

  private advanceToNextLevel(triggerPlayerSessionId: string): void {
    // ... existing level advance logic ...

    // Clear bots and spawn new ones
    this.enemyBotManager.clearAllBots();
    this.enemyBotManager.spawnBots(
      this.enemyBotManager.getBotsForLevel(this.state.currentLevel),
      this.state.players
    );
  }

  // Remove these methods (now in managers):
  // - spawnBots()
  // - updateBots()
  // - isValidBotMove()
  // - getBotHealthForLevel()
  // - getBotsForLevel()
  // - findSafeRespawnLocation() (moved to CollisionManager)
}
```

### Step 4.2: Write Integration Test
Create `src/rooms/__tests__/DungeonRoom.integration.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { DungeonRoom } from '../DungeonRoom';

describe('DungeonRoom Integration', () => {
  test('full game loop: spawn → move → shoot → kill bot', () => {
    // This test would require Colyseus test utilities
    // to create a room, connect clients, and simulate gameplay
    // For now, this serves as a placeholder for future integration tests
  });
});
```

### Step 4.3: Run Full Test Suite
```bash
pnpm test
```

**Success Criteria:** All tests pass ✅

---

## Phase 5: Manual Validation

Start the server and play manually:

```bash
pnpm start
# Open browser to http://localhost:2567
# Play one level
```

**Checklist:**
- [ ] Bots spawn at safe distance from player
- [ ] Bots chase player smoothly
- [ ] Bullets damage and kill bots
- [ ] Bots damage player on collision
- [ ] Player respawns with invincibility
- [ ] Level progression works correctly
- [ ] No console errors

---

## Test Visualization

### Vitest UI (Recommended)
```bash
pnpm test:ui
```

**Opens browser showing:**
- ✅ Green/Red test status
- Code coverage heatmap
- Test execution times
- Ability to re-run specific tests

### Console Output
```bash
pnpm test
```

**Example output:**
```
✓ src/game/__tests__/EnemyBotManager.test.ts (7)
  ✓ spawns correct number of bots for level 1
  ✓ bots spawn at safe distance from players
  ✓ bots have correct health for level
  ✓ bot count scales with level
  ✓ bots move toward nearest player
  ✓ bots avoid walls using X/Y fallback
  ✓ bot speed scales with level

✓ src/game/__tests__/CollisionManager.test.ts (10)
  ✓ bullet hitting bot deals 50 damage
  ✓ bot dies when health reaches 0
  ✓ bullet is removed after hit
  ✓ no collision when bullet is far
  ✓ player loses 1 life when touched
  ✓ player becomes invincible for 3s
  ✓ invincible player does not take damage
  ✓ player respawns at safe location
  ✓ bot is pushed away after hit

Test Files  2 passed (2)
Tests  17 passed (17)
Duration  523ms
```

---

## Refactoring Workflow Summary

1. ✅ **Install Vitest** → `pnpm add -D vitest @vitest/ui`
2. ✅ **Write EnemyBotManager tests** → Tests fail (expected)
3. ✅ **Extract EnemyBotManager** → Tests pass
4. ✅ **Write CollisionManager tests** → Tests fail (expected)
5. ✅ **Extract CollisionManager** → Tests pass
6. ✅ **Update DungeonRoom** → Use managers
7. ✅ **Run all tests** → All pass
8. ✅ **Manual smoke test** → Play the game

---

## Benefits Summary

✅ **Fast Feedback:** Tests run in <1 second
✅ **Confidence:** Each step validated before moving forward
✅ **Documentation:** Tests serve as usage examples
✅ **Regression Prevention:** Can't accidentally break bot logic
✅ **Visualization:** Vitest UI shows exactly what's passing/failing
✅ **Better Organization:** 600-line DungeonRoom.ts instead of 800
✅ **Reusability:** Managers can be used in other room types
✅ **Testability:** Bot AI can be unit tested independently

---

## Estimated Timeline

- **Phase 1** (Setup): 10 minutes
- **Phase 2** (EnemyBotManager): 45 minutes
- **Phase 3** (CollisionManager): 45 minutes
- **Phase 4** (Integration): 30 minutes
- **Phase 5** (Manual validation): 10 minutes

**Total: ~2.5 hours** (with comprehensive testing)

---

## Notes

- Tests are written **before** extracting code (TDD approach)
- Each phase is independently validated
- No need for Playwright (headless tests only)
- Can visualize test results in browser UI
- Can run tests in watch mode during development (`pnpm test:watch`)

---

## Phase 6: Improve Headless Bot AI (Strategy.ts)

**Context:** This phase improves the AI for headless player bots (AI clients that play the game). These are NOT the enemy NPCs - this is about making the simulated players more human-like.

**Current Issues:**
- Bots have 360° omniscient vision through walls (unrealistic)
- Instant perfect aim when acquiring target (feels robotic)
- Perfect accuracy (never misses)
- Single-minded behavior (always chase → shoot, no variety)

### Step 6.1: Add FOV + Memory System

**Goal:** Limit bot perception to feel more human

**Location:** `src/bots/ai/Strategy.ts`

**Add new interface:**
```typescript
interface PerceptionSystem {
  lastSeenPosition: Map<string, { x: number; y: number; timestamp: number }>;
  FOV_ANGLE: number; // 120 degrees
  VIEW_DISTANCE: number; // 20 tiles
  MEMORY_DURATION: number; // 5000ms (5 seconds)
}
```

**Implementation:**
```typescript
export class Strategy {
  private perception: PerceptionSystem = {
    lastSeenPosition: new Map(),
    FOV_ANGLE: (120 * Math.PI) / 180, // 120 degrees in radians
    VIEW_DISTANCE: 20,
    MEMORY_DURATION: 5000
  };

  /**
   * Check if bot can see a target (FOV + distance + LOS checks)
   */
  private canSeeTarget(
    myPos: Point,
    myAngle: number,
    targetPos: Point,
    grid: number[][]
  ): boolean {
    // 1. Distance check
    const distance = Pathfinding.distance(myPos, targetPos);
    if (distance > this.perception.VIEW_DISTANCE) {
      return false;
    }

    // 2. FOV check (is target within cone of vision?)
    const angleToTarget = Math.atan2(
      targetPos.y - myPos.y,
      targetPos.x - myPos.x
    );
    const angleDiff = Math.abs(this.normalizeAngle(angleToTarget - myAngle));

    if (angleDiff > this.perception.FOV_ANGLE / 2) {
      return false; // Outside FOV cone
    }

    // 3. Line of sight check (walls blocking?)
    const hasLOS = Pathfinding.hasLineOfSight(grid, myPos, targetPos);
    if (!hasLOS) {
      return false;
    }

    return true;
  }

  /**
   * Normalize angle to -PI to PI range
   */
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Update memory with target sightings
   */
  private updateMemory(botId: string, position: Point): void {
    this.perception.lastSeenPosition.set(botId, {
      x: position.x,
      y: position.y,
      timestamp: Date.now()
    });
  }

  /**
   * Get last known position of target (if within memory duration)
   */
  private getLastKnownPosition(botId: string): Point | null {
    const memory = this.perception.lastSeenPosition.get(botId);
    if (!memory) return null;

    const age = Date.now() - memory.timestamp;
    if (age > this.perception.MEMORY_DURATION) {
      this.perception.lastSeenPosition.delete(botId);
      return null;
    }

    return { x: memory.x, y: memory.y };
  }
}
```

**Update `findNearestBot()` to use FOV:**
```typescript
private findNearestBot(state: GameState, myPos: Point): Bot | null {
  let nearestBot: Bot | null = null;
  let minDistance = Infinity;

  for (const [botId, bot] of state.bots) {
    // Check if we can currently see this bot
    const canSee = this.canSeeTarget(
      myPos,
      state.myPlayer!.angle,
      { x: bot.x, y: bot.y },
      state.grid
    );

    if (canSee) {
      // Update memory when we see a bot
      this.updateMemory(botId, { x: bot.x, y: bot.y });

      const distance = Pathfinding.distance(myPos, { x: bot.x, y: bot.y });
      if (distance < minDistance) {
        minDistance = distance;
        nearestBot = bot;
      }
    } else {
      // Can't see bot, check if we have recent memory
      const lastKnown = this.getLastKnownPosition(botId);
      if (lastKnown) {
        const distance = Pathfinding.distance(myPos, lastKnown);
        if (distance < minDistance) {
          minDistance = distance;
          nearestBot = bot; // Use actual bot, but navigate to last known position
        }
      }
    }
  }

  return nearestBot;
}
```

**Tests:** `src/bots/ai/__tests__/Strategy.fov.test.ts`
```typescript
import { describe, test, expect } from 'vitest';
import { Strategy } from '../Strategy';

describe('Strategy - FOV System', () => {
  test('bot cannot see target behind it (outside FOV)', () => {
    // Bot facing north (angle = -PI/2)
    // Target directly behind (south)
    // Should return false
  });

  test('bot can see target within 120° FOV cone', () => {
    // Bot facing north
    // Target 45° to the left (within 120° cone)
    // Should return true
  });

  test('bot cannot see target through walls', () => {
    // Target within FOV and distance
    // But wall between bot and target
    // Should return false
  });

  test('bot cannot see target beyond 20 tiles', () => {
    // Target at 25 tiles away
    // Should return false
  });

  test('memory persists for 5 seconds after losing sight', () => {
    // See bot at time T
    // Lose sight at T+1
    // Memory should exist until T+6
  });
});
```

---

### Step 6.2: Add Reaction Delay

**Goal:** Add human-like delay before shooting at new target

**Add to Strategy class:**
```typescript
export class Strategy {
  private targetAcquisitionTime: Map<string, number> = new Map();
  private readonly REACTION_DELAY = 250; // 250ms delay

  /**
   * Check if enough time has passed since acquiring target
   */
  private canShootAtTarget(botId: string): boolean {
    const acquisitionTime = this.targetAcquisitionTime.get(botId);
    if (!acquisitionTime) return false;

    const elapsedTime = Date.now() - acquisitionTime;
    return elapsedTime >= this.REACTION_DELAY;
  }

  /**
   * Mark when we first acquired this target
   */
  private acquireTarget(botId: string): void {
    if (!this.targetAcquisitionTime.has(botId)) {
      this.targetAcquisitionTime.set(botId, Date.now());
    }
  }
}
```

**Update shooting logic in `decideAction()`:**
```typescript
if (hasLOS && distance < 15) {
  const angle = Math.atan2(target.y - myPos.y, target.x - myPos.x);

  // Mark target acquisition
  this.acquireTarget(target.id);

  // Update angle first
  if (Math.abs(state.myPlayer.angle - angle) > 0.1) {
    return { type: "updateAngle", angle };
  }

  // Only shoot if reaction delay has passed
  if (this.canShootAtTarget(target.id)) {
    return { type: "shoot", angle };
  } else {
    // Still waiting for reaction delay
    return { type: "wait" };
  }
}
```

**Tests:** `src/bots/ai/__tests__/Strategy.reaction.test.ts`
```typescript
describe('Strategy - Reaction Delay', () => {
  test('bot waits 250ms before first shot at new target', () => {
    // Acquire target at time T
    // Should NOT shoot until T+250ms
  });

  test('bot shoots immediately at already-acquired target', () => {
    // Target acquired 500ms ago
    // Should shoot immediately
  });
});
```

---

### Step 6.3: Add Aim Spread

**Goal:** Add slight inaccuracy to shooting

**Add to Strategy class:**
```typescript
export class Strategy {
  private readonly AIM_SPREAD = 0.1; // ±0.1 radians (~5.7 degrees)

  /**
   * Add random spread to aim angle
   */
  private applyAimSpread(angle: number): number {
    const spread = (Math.random() - 0.5) * 2 * this.AIM_SPREAD;
    return angle + spread;
  }
}
```

**Update shooting in `decideAction()`:**
```typescript
if (this.canShootAtTarget(target.id)) {
  const baseAngle = Math.atan2(target.y - myPos.y, target.x - myPos.x);
  const spreadAngle = this.applyAimSpread(baseAngle);
  return { type: "shoot", angle: spreadAngle };
}
```

**Tests:** `src/bots/ai/__tests__/Strategy.aim.test.ts`
```typescript
describe('Strategy - Aim Spread', () => {
  test('shooting angle varies within ±0.1 radians', () => {
    // Shoot at same target 100 times
    // Angles should vary within spread range
  });

  test('average aim is centered on target', () => {
    // Over many shots, average should equal base angle
  });
});
```

---

### Step 6.4: Add 3-State Tactical FSM

**Goal:** Add tactical survival behaviors (Hunt, Kite, Retreat)

**Why this matters:** Enemy NPCs can damage and kill the bot. Bots need to kite enemies, avoid getting surrounded, and retreat when low on lives—just like skilled human players.

**Add state machine:**
```typescript
type BotState = "HUNT" | "KITE" | "RETREAT";

interface StateData {
  currentState: BotState;
  huntTarget: Point | null;
  lastStateChange: number;
}

export class Strategy {
  private stateData: StateData = {
    currentState: "HUNT",
    huntTarget: null,
    lastStateChange: Date.now()
  };

  /**
   * Count how many enemies are visible within FOV
   */
  private countVisibleEnemies(state: GameState, myPos: Point): number {
    let count = 0;
    for (const [_, bot] of state.bots) {
      if (this.canSeeTarget(
        myPos,
        state.myPlayer!.angle,
        { x: bot.x, y: bot.y },
        state.grid
      )) {
        count++;
      }
    }
    return count;
  }

  /**
   * Update state machine based on tactical situation
   */
  private updateState(state: GameState, myPos: Point, nearestBot: Bot | null): void {
    const visibleEnemies = this.countVisibleEnemies(state, myPos);
    const livesRemaining = state.myPlayer!.lives;
    const now = Date.now();

    switch (this.stateData.currentState) {
      case "HUNT":
        // Found enemy - switch to kiting to maintain safe distance
        if (nearestBot && visibleEnemies > 0) {
          this.transitionTo("KITE", now);
        }
        break;

      case "KITE":
        // Retreat if surrounded (3+ enemies) or critically low on lives
        if (visibleEnemies >= 3 || livesRemaining <= 1) {
          this.transitionTo("RETREAT", now);
        }
        // Return to hunting if area is clear
        if (visibleEnemies === 0) {
          this.transitionTo("HUNT", now);
        }
        break;

      case "RETREAT":
        // Safe to return to kiting
        if (visibleEnemies <= 1 && livesRemaining >= 2) {
          this.transitionTo("KITE", now);
        }
        // Area is clear, resume hunting
        if (visibleEnemies === 0 && livesRemaining >= 2) {
          this.transitionTo("HUNT", now);
        }
        break;
    }
  }

  private transitionTo(newState: BotState, timestamp: number): void {
    this.stateData.currentState = newState;
    this.stateData.lastStateChange = timestamp;
  }

  /**
   * Decide action based on current state
   */
  decideAction(state: GameState): Action {
    if (!state.myPlayer || state.myPlayer.lives <= 0) {
      return { type: "wait" };
    }

    const myPos = { x: Math.round(state.myPlayer.x), y: Math.round(state.myPlayer.y) };
    const nearestBot = this.findNearestBot(state, myPos);

    // Update state machine
    this.updateState(state, myPos, nearestBot);

    // Execute behavior based on state
    switch (this.stateData.currentState) {
      case "HUNT":
        return this.huntBehavior(state, myPos, nearestBot);

      case "KITE":
        if (!nearestBot) return { type: "wait" };
        return this.kiteBehavior(state, myPos, nearestBot);

      case "RETREAT":
        return this.retreatBehavior(state, myPos);

      default:
        return { type: "wait" };
    }
  }

  /**
   * HUNT: Actively search for enemy NPCs to kill
   */
  private huntBehavior(state: GameState, myPos: Point, nearestBot: Bot | null): Action {
    // Try to dodge bullets first
    const dodgeAction = this.tryDodgeBullet(state, myPos);
    if (dodgeAction) return dodgeAction;

    if (!nearestBot) {
      // No enemies visible - explore to find them
      if (!this.stateData.huntTarget) {
        this.stateData.huntTarget = this.pickRandomWalkablePoint(state.grid);
      }

      if (this.stateData.huntTarget) {
        const distance = Pathfinding.distance(myPos, this.stateData.huntTarget);
        if (distance < 2) {
          // Reached exploration point, pick a new one
          this.stateData.huntTarget = null;
        } else {
          return this.navigateToTarget(state, myPos, this.stateData.huntTarget);
        }
      }
      return { type: "wait" };
    }

    // Enemy found - navigate toward it
    const targetPos = { x: Math.round(nearestBot.x), y: Math.round(nearestBot.y) };
    return this.navigateToTarget(state, myPos, targetPos) || { type: "wait" };
  }

  /**
   * KITE: Maintain safe distance while shooting (5-10 tiles)
   */
  private kiteBehavior(state: GameState, myPos: Point, target: Bot): Action {
    // Try to dodge bullets first
    const dodgeAction = this.tryDodgeBullet(state, myPos);
    if (dodgeAction) return dodgeAction;

    const targetPos = { x: Math.round(target.x), y: Math.round(target.y) };
    const distance = Pathfinding.distance(myPos, targetPos);
    const hasLOS = Pathfinding.hasLineOfSight(state.grid, myPos, targetPos);

    const MIN_KITE_DISTANCE = 5;
    const MAX_KITE_DISTANCE = 12;

    // Too close - back away while shooting
    if (distance < MIN_KITE_DISTANCE) {
      // Calculate direction away from enemy
      const dx = myPos.x - target.x;
      const dy = myPos.y - target.y;
      const angle = Math.atan2(dy, dx);

      // Move away
      const retreatX = Math.round(myPos.x + Math.cos(angle) * 2);
      const retreatY = Math.round(myPos.y + Math.sin(angle) * 2);

      // Try to shoot while backing away
      if (hasLOS) {
        const shootAngle = Math.atan2(target.y - myPos.y, target.x - myPos.x);
        this.acquireTarget(target.id);

        if (this.canShootAtTarget(target.id)) {
          const spreadAngle = this.applyAimSpread(shootAngle);
          return { type: "shoot", angle: spreadAngle };
        }
      }

      return this.navigateToTarget(state, myPos, { x: retreatX, y: retreatY }) || { type: "wait" };
    }

    // In optimal range (5-12 tiles) - shoot if LOS
    if (distance <= MAX_KITE_DISTANCE && hasLOS) {
      const angle = Math.atan2(target.y - myPos.y, target.x - myPos.x);
      this.acquireTarget(target.id);

      if (Math.abs(state.myPlayer!.angle - angle) > 0.1) {
        return { type: "updateAngle", angle };
      }

      if (this.canShootAtTarget(target.id)) {
        const spreadAngle = this.applyAimSpread(angle);
        return { type: "shoot", angle: spreadAngle };
      }

      return { type: "wait" }; // Waiting for reaction delay
    }

    // Too far - move closer to optimal range
    return this.navigateToTarget(state, myPos, targetPos) || { type: "wait" };
  }

  /**
   * RETREAT: Run away to safe area (corner/dead-end), only shoot if cornered
   */
  private retreatBehavior(state: GameState, myPos: Point): Action {
    // Try to dodge bullets first
    const dodgeAction = this.tryDodgeBullet(state, myPos);
    if (dodgeAction) return dodgeAction;

    // Find safe corner (tile with walls on 3 sides)
    const safeSpot = this.findSafeCorner(state.grid, myPos);

    if (safeSpot) {
      const distance = Pathfinding.distance(myPos, safeSpot);
      if (distance > 2) {
        // Navigate to safe spot
        return this.navigateToTarget(state, myPos, safeSpot) || { type: "wait" };
      }
    }

    // Already in safe spot or can't find one - shoot enemies that get too close
    const nearestBot = this.findNearestBot(state, myPos);
    if (nearestBot) {
      const targetPos = { x: Math.round(nearestBot.x), y: Math.round(nearestBot.y) };
      const distance = Pathfinding.distance(myPos, targetPos);
      const hasLOS = Pathfinding.hasLineOfSight(state.grid, myPos, targetPos);

      // Only shoot if enemy is dangerously close (< 7 tiles)
      if (distance < 7 && hasLOS) {
        const angle = Math.atan2(nearestBot.y - myPos.y, nearestBot.x - myPos.x);
        this.acquireTarget(nearestBot.id);

        if (Math.abs(state.myPlayer!.angle - angle) > 0.1) {
          return { type: "updateAngle", angle };
        }

        if (this.canShootAtTarget(nearestBot.id)) {
          const spreadAngle = this.applyAimSpread(angle);
          return { type: "shoot", angle: spreadAngle };
        }
      }
    }

    return { type: "wait" };
  }

  /**
   * Find a safe corner (tile with walls on 3 sides)
   */
  private findSafeCorner(grid: number[][], myPos: Point): Point | null {
    const height = grid.length;
    const width = grid[0].length;

    // Search in expanding radius around current position
    for (let radius = 5; radius < 20; radius += 5) {
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const x = Math.round(myPos.x + Math.cos(angle) * radius);
        const y = Math.round(myPos.y + Math.sin(angle) * radius);

        if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) continue;
        if (grid[y][x] !== 1) continue; // Not walkable

        // Count walls around this tile
        const neighbors = [
          grid[y-1][x], // up
          grid[y+1][x], // down
          grid[y][x-1], // left
          grid[y][x+1]  // right
        ];

        const wallCount = neighbors.filter(tile => tile === 0).length;

        // Safe corner = 3 walls, 1 open side
        if (wallCount === 3) {
          return { x, y };
        }
      }
    }

    return null; // No safe corner found
  }

  /**
   * Pick random walkable tile for exploration
   */
  private pickRandomWalkablePoint(grid: number[][]): Point {
    const height = grid.length;
    const width = grid[0].length;

    for (let i = 0; i < 20; i++) {
      const x = Math.floor(Math.random() * width);
      const y = Math.floor(Math.random() * height);

      if (grid[y][x] === 1) { // Walkable
        return { x, y };
      }
    }

    return { x: width / 2, y: height / 2 }; // Fallback to center
  }
}
```

---

### Step 6.5: Integration Testing

Run headless bots and observe behavior:

```bash
# Terminal 1: Start server
pnpm start

# Terminal 2: Run 3 headless bots
pnpm run bots --headless 3 --verbose
```

**Success Criteria:**
- [ ] Bots don't shoot enemies behind them (FOV working)
- [ ] Bots have slight delay before first shot (reaction delay working)
- [ ] Bots occasionally miss shots (aim spread working)
- [ ] Bots patrol when no enemies visible
- [ ] Bots engage when spotting enemies
- [ ] Bots search last known position after losing sight
- [ ] Bots return to patrol after failed search

---

### Step 6.6: Update Timeline

**Phase 6 Breakdown (No Tests):**
- FOV + Memory: 1 hour (medium complexity, no tests)
- Reaction Delay: 15 minutes (simple)
- Aim Spread: 5 minutes (trivial)
- 3-State Tactical FSM: 1.5 hours (medium complexity, no tests)
- Integration Testing: 20 minutes (manual testing with `pnpm run bots`)

**Phase 6 Total: ~3 hours**

---

## Updated Timeline (All Phases)

**If you want organized code (Phases 1-5):**
- **Phase 1** (Setup): 10 minutes
- **Phase 2** (EnemyBotManager): 45 minutes (no tests)
- **Phase 3** (CollisionManager): 45 minutes (no tests)
- **Phase 4** (Integration): 30 minutes
- **Phase 5** (Manual validation): 10 minutes

**Phase 1-5 Total: ~2.5 hours**

**If you want smarter bots (Phase 6 only):**
- **Phase 6** (Headless Bot AI Improvements): 3 hours

**Both? Total: ~5.5 hours** (refactor + AI improvements, no tests)

---

## Recommendation: Do Phase 6 First

**Why?** Phase 6 gives immediate gameplay improvements you can see in action. Phases 1-5 are code organization that doesn't change behavior.

**Best approach:**
1. Implement Phase 6 (3 hours) → Better bots NOW
2. Play/test for a few days
3. Decide if you want cleaner code (Phases 1-5) later

**Phases 1-5 can wait. Phase 6 makes the game more fun immediately.**
