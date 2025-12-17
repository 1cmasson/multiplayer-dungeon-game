# Bot Algorithm Explanation

The bot system consists of **4 main components**: spawning, AI movement, collision handling, and difficulty scaling. Here's how each works:

---

## 1. Safe Spawning Algorithm

**Location:** `src/rooms/DungeonRoom.ts:197-256`

### Goal
Prevent bots from spawning too close to players, avoiding instant death scenarios.

### Logic
```typescript
MIN_SPAWN_DISTANCE = 10 tiles
```

**For each bot:**
1. Pick a random walkable floor tile
2. Calculate distance from spawn point: `√((x₁-x₂)² + (y₁-y₂)²)`
3. If distance < 10 tiles → **reject**, try again
4. Calculate distance from **all living players**
5. If any player within 10 tiles → **reject**, try again
6. If location is safe → spawn bot there
7. Max 100 attempts per bot (prevents infinite loops)

### Health Scaling
```typescript
baseHealth = 100
healthPerLevel = 50
botHealth = 100 + (level - 1) × 50
```

| Level | Bot Health | Shots to Kill |
|-------|-----------|---------------|
| 1     | 100 HP    | 2 shots       |
| 2     | 150 HP    | 3 shots       |
| 3     | 200 HP    | 4 shots       |
| 4     | 250 HP    | 5 shots       |
| 5     | 300 HP    | 6 shots       |

---

## 2. Bot AI Movement

**Location:** `src/rooms/DungeonRoom.ts:261-326`

### Core Behavior: Chase Nearest Player

#### Step 1: Target Selection
```typescript
foreach player:
  if alive:
    distance = √((player.x - bot.x)² + (player.y - bot.y)²)
    if distance < nearestDistance:
      nearestPlayer = player
```

#### Step 2: Calculate Movement Speed
```typescript
BOT_SPEED = 3 × (1 + (level-1) × 0.1) tiles/sec
```

| Level | Bot Speed     |
|-------|---------------|
| 1     | 3.0 tiles/sec |
| 2     | 3.3 tiles/sec |
| 3     | 3.6 tiles/sec |
| 4     | 3.9 tiles/sec |
| 5     | 4.2 tiles/sec |

#### Step 3: Normalize Direction
```typescript
dx = target.x - bot.x
dy = target.y - bot.y
distance = √(dx² + dy²)

moveX = (dx / distance) × BOT_SPEED × deltaTime
moveY = (dy / distance) × BOT_SPEED × deltaTime
```

This creates a **unit vector** (direction) scaled by speed and time.

#### Step 4: Obstacle Avoidance (Smart Pathfinding)

```
Priority 1: Try direct path to player
  ↓ (if blocked by wall)
Priority 2: Try moving along X-axis only
  ↓ (if blocked)
Priority 3: Try moving along Y-axis only
  ↓ (if blocked)
Result: Bot stays in place (truly blocked)
```

**Example Scenario:**
```
[Wall] [Wall] [Wall]
[Bot]  [Wall] [Player]
[Wall] [Wall] [Wall]
```

1. Direct diagonal path blocked? ✗
2. Move right (X-axis)? ✗ (wall in the way)
3. Move up/down (Y-axis)? ✓ **Success!** Bot slides around wall

This creates natural **"sliding along walls"** behavior without complex pathfinding algorithms.

---

## 3. Collision Detection

**Location:** `src/rooms/DungeonRoom.ts:331-431`

### A. Bullet vs Bot Collisions

**Location:** Lines 336-369

```typescript
hitRadius = 0.5 tiles
damage = 50 HP per bullet

if distance(bullet, bot) < 0.5:
  bot.health -= 50
  destroyBullet()

  if bot.health <= 0:
    player.score++
    totalKills++
    levelKills++
    destroyBot()

    if levelKills >= killsNeeded:
      advanceToNextLevel()
    else:
      spawnBots(1) // Maintain bot count
```

**Key Features:**
- Hit radius of 0.5 tiles (generous hitbox for better feel)
- Each bullet deals 50 damage (2 hits kill a level 1 bot)
- New bot spawns immediately to maintain difficulty
- Level progression triggers when kill quota met

### B. Bot vs Player Collisions

**Location:** Lines 371-426

```typescript
touchDistance = 0.7 tiles

if distance(bot, player) < 0.7 AND not invincible:
  player.lives--
  player.invincibleUntil = currentTime + 3000ms

  if player.lives > 0:
    respawn at safe location (5+ tiles from bots)
    give 3 seconds invincibility
    broadcast("playerHit")
  else:
    broadcast("gameOver")

  // Push bot away from player
  randomAngle = random(0, 2π)
  bot.x += cos(randomAngle) × 3
  bot.y += sin(randomAngle) × 3
```

**Respawn System:**
- Player loses 1 life
- Gets 3 seconds of invincibility (prevents spawn camping)
- Respawns at safe location (minimum 5 tiles from any bot)
- Falls back to spawn point if no safe location found

**Bot Knockback:**
- Bot pushed 3 tiles away in random direction
- Prevents bot from dealing continuous damage
- Only applied if new position is valid (not in wall)

---

## 4. Advanced Collision Detection

**Location:** `src/rooms/DungeonRoom.ts:693-721`

### Problem
Bots are circular entities (radius = 0.2 tiles) moving through a grid-based world. Simple center-point collision causes bots to **clip through walls at corners**.

### Solution: 5-Point Collision Check

```
    [TL]──────[TR]
       \      /
         [C]
       /      \
    [BL]──────[BR]
```

**Check these 5 points:**
1. **Top-left corner:** `(x - 0.2, y - 0.2)`
2. **Top-right corner:** `(x + 0.2, y - 0.2)`
3. **Bottom-left corner:** `(x - 0.2, y + 0.2)`
4. **Bottom-right corner:** `(x + 0.2, y + 0.2)`
5. **Center:** `(x, y)`

**Validation Rule:**
```typescript
BOT_RADIUS = 0.2 tiles

foreach checkPoint in [TL, TR, BL, BR, Center]:
  tileX = floor(checkPoint.x)
  tileY = floor(checkPoint.y)

  if tile is WALL or OBSTACLE:
    return INVALID_MOVE

return VALID_MOVE
```

**Why 0.2 radius?**
- Large enough to prevent wall clipping
- Small enough to allow movement through 1-tile corridors
- Balanced for smooth gameplay

---

## 5. Difficulty Scaling

### Complete Difficulty Table

| Level | Bots | Bot HP | Bot Speed | Kills Needed | Total Kills to Complete |
|-------|------|--------|-----------|--------------|------------------------|
| 1     | 3    | 100    | 3.0       | 10           | 10                     |
| 2     | 4    | 150    | 3.3       | 15           | 25                     |
| 3     | 5    | 200    | 3.6       | 20           | 45                     |
| 4     | 6    | 250    | 3.9       | 25           | 70                     |
| 5     | 7    | 300    | 4.2       | 30           | 100                    |

### Scaling Formulas

```typescript
// Number of bots per level
getBotsForLevel(level) {
  return 2 + level  // Linear growth
}

// Bot health per level
getBotHealthForLevel(level) {
  return 100 + (level - 1) × 50  // +50 HP per level
}

// Bot speed per level
getBotSpeed(level) {
  const BASE_SPEED = 3
  const speedMultiplier = 1 + (level - 1) × 0.1  // +10% per level
  return BASE_SPEED × speedMultiplier
}

// Kills needed per level
getKillsForLevel(level) {
  if (level === 1) return 10
  if (level === 2) return 15
  return 15 + (level - 2) × 5  // +5 kills for levels 3-5
}
```

### Difficulty Curve Analysis

**Early Game (Levels 1-2):**
- Forgiving health (2-3 shots to kill)
- Slower bot speed allows learning mechanics
- Fewer bots reduce chaos

**Mid Game (Levels 3-4):**
- Bullet economy matters (4-5 shots to kill)
- Bot speed increases pressure
- More bots require better positioning

**Late Game (Level 5):**
- 7 bots create significant challenge
- 6 shots to kill requires accuracy
- 4.2 tiles/sec speed demands quick reactions
- 30 kills is a marathon test

---

## Key Design Decisions

### Strengths ✅

1. **Simple but Effective AI**
   - No expensive A* pathfinding needed
   - Runs efficiently at 30 FPS with multiple bots
   - Predictable for players to counter

2. **Robust Obstacle Avoidance**
   - Bots naturally slide around walls
   - Prevents getting stuck in corners
   - Feels organic and intelligent

3. **Safe Spawning**
   - Eliminates frustrating instant deaths
   - 10-tile minimum distance is well-tuned
   - Fallback to spawn point prevents soft locks

4. **Smooth Difficulty Curve**
   - Linear bot count growth
   - Exponential health growth creates challenge
   - Speed scaling adds pressure without being unfair

### Limitations ⚠️

1. **Can Get Trapped in Complex Mazes**
   - Simple fallback pathfinding can fail in U-shaped corridors
   - Bots may oscillate between X/Y axis attempts

2. **No Group Coordination**
   - Each bot acts independently
   - No flanking or strategic behavior
   - No communication between bots

3. **Predictable Behavior**
   - Always chase nearest player
   - No feinting or retreating
   - Experienced players can exploit patterns

4. **No Ranged Attacks**
   - Bots must touch player to deal damage
   - Creates "kiting" meta (run and shoot)
   - Limited tactical variety

---

## Performance Characteristics

### Update Frequency
- **Game loop:** 30 FPS (33.33ms per frame)
- **Bot updates:** Every frame
- **Collision checks:** Every frame

### Per-Frame Complexity (per bot)

| Operation                  | Cost | Count |
|---------------------------|------|-------|
| Distance to players       | O(n) | 1     |
| Move calculation          | O(1) | 1     |
| Direct path collision     | O(1) | 1     |
| X-axis fallback collision | O(1) | 0-1   |
| Y-axis fallback collision | O(1) | 0-1   |
| 5-point collision check   | O(1) | 5     |
| Bullet collision checks   | O(m) | m     |

Where:
- `n` = number of players (max 4)
- `m` = number of bullets (typically 0-10)

### Total Complexity
```
Per bot: O(n + m)
All bots: O(k × (n + m))
```
Where `k` = number of bots (max 7)

**Worst case:** `7 bots × (4 players + 10 bullets) = 98 operations/frame`

At 30 FPS: **~3,000 operations/second** (negligible for modern CPUs)

### Network Traffic
- **Protocol:** Colyseus binary state sync (efficient)
- **Bot state size:** ~16 bytes per bot (x, y, health, id)
- **Update frequency:** 30 Hz (every 33ms)
- **Bandwidth per bot:** ~480 bytes/sec

**Total for 7 bots:** ~3.4 KB/sec (minimal)

---

## Code References

### Main Bot Functions

| Function                      | Line | Purpose                        |
|-------------------------------|------|--------------------------------|
| `spawnBots()`                 | 197  | Safe bot spawning logic        |
| `updateBots()`                | 261  | AI movement and pathfinding    |
| `checkCollisions()`           | 331  | Bullet/bot/player collisions   |
| `isValidBotMove()`            | 693  | 5-point collision detection    |
| `getBotHealthForLevel()`      | 779  | Health scaling formula         |
| `getBotsForLevel()`           | 788  | Bot count per level            |

### Related Systems

| System                        | Line | Purpose                        |
|-------------------------------|------|--------------------------------|
| `findRandomWalkableLocation()`| 566  | Used for bot spawning          |
| `findSafeRespawnLocation()`   | 589  | Player respawn after hit       |
| `startGameLoop()`             | 129  | 30 FPS game tick               |
| `advanceToNextLevel()`        | 436  | Level progression              |

---

## Future Enhancement Ideas

### High Priority

1. **Better Pathfinding**
   ```
   Replace: Simple X/Y fallback
   With: Breadth-first search (BFS) or A* pathfinding
   Benefit: Bots navigate complex mazes intelligently
   ```

2. **Bot Behaviors**
   ```
   Add: Aggressive, Defensive, Flanking personalities
   Implementation: 30% aggressive (chase), 40% normal, 30% flanking
   Benefit: Unpredictable, more engaging combat
   ```

3. **Group Coordination**
   ```
   Add: Bots communicate targets and spread out
   Implementation: Prevent multiple bots targeting same player
   Benefit: Forces player to handle multiple threats
   ```

### Medium Priority

4. **Ranged Bot Type**
   ```
   Add: Bots that shoot projectiles from distance
   Ratio: 70% melee, 30% ranged
   Benefit: Forces player movement, adds variety
   ```

5. **Bot Vision System**
   ```
   Add: Line-of-sight checks (bots only chase if they can "see" player)
   Benefit: Stealth gameplay opportunities
   ```

6. **Dynamic Speed**
   ```
   Add: Bots speed up when charging, slow down when damaged
   Benefit: More realistic and varied combat feel
   ```

### Low Priority

7. **Bot Animations**
   ```
   Add: Rotation toward movement direction
   Add: Hit flash effect when damaged
   Benefit: Better visual feedback
   ```

8. **Sound Effects**
   ```
   Add: Bot spawn sound, death sound, aggro sound
   Benefit: Audio feedback for off-screen threats
   ```

---

## Testing & Debugging

### Enable Debug Visualization

Add to `public/game.js` rendering loop:

```javascript
// Draw bot paths (shows where bot is trying to move)
state.bots.forEach(bot => {
  const nearestPlayer = findNearestPlayer(bot);
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.moveTo(bot.x * tileSize, bot.y * tileSize);
  ctx.lineTo(nearestPlayer.x * tileSize, nearestPlayer.y * tileSize);
  ctx.stroke();
});
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Bots spawn on player | MIN_SPAWN_DISTANCE too low | Increase to 12-15 tiles |
| Bots clip through walls | BOT_RADIUS too small | Increase to 0.3 |
| Bots get stuck in corners | Fallback pathfinding fails | Add diagonal movement attempts |
| Too easy/hard | Imbalanced scaling | Adjust speed/health multipliers |

### Performance Profiling

Add to `DungeonRoom.ts`:

```typescript
private updateBots(deltaTime: number): void {
  const startTime = performance.now();

  // ... existing bot update logic ...

  const endTime = performance.now();
  if (endTime - startTime > 5) { // Log if over 5ms
    console.warn(`Bot update took ${endTime - startTime}ms`);
  }
}
```

---

## Credits

**Original Implementation:** Multiplayer Dungeon Shooter
**Documentation:** Claude (Anthropic)
**Last Updated:** December 12, 2025

---

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) - Complete game improvements documentation
- [src/rooms/DungeonRoom.ts](./src/rooms/DungeonRoom.ts) - Full server implementation
- [public/game.js](./public/game.js) - Client-side rendering

