# Game Improvement Plan: Bot Shooter with Level Progression

## Current State Analysis

### Build Errors
- TypeScript error in `src/rooms/DungeonRoom.ts:232-233` - Property 'x' and 'y' do not exist on type 'never'
  - This appears to be a TypeScript type narrowing issue with the `nearestPlayer` variable
  - Need to add explicit type annotation or restructure the condition

### Existing Features
- Multiplayer dungeon game with Colyseus backend
- Players rendered as circles with movement (WASD/Arrow keys)
- Bot AI that moves toward nearest player
- Shooting system with bullets
- Lives system (players have 3 lives)
- Bot health system (bots require multiple shots to kill)
- Score tracking (player.score counts kills)
- Collision detection (bullets vs bots, bots vs players)
- Level system based on reaching exit (currently 4 levels)

## Proposed Changes

### 1. Fix TypeScript Build Errors
**Priority: HIGH**

#### Location: `src/rooms/DungeonRoom.ts:210-234`

**Issue:**
- TypeScript cannot properly narrow the type of `nearestPlayer` from `Player | undefined` to `Player` after the null check

**Solution:**
Add explicit type assertion or restructure the code:
```typescript
if (!nearestPlayer) return;

// Option A: Type assertion
const target = nearestPlayer as Player;
const dx = target.x - bot.x;
const dy = target.y - bot.y;

// Option B: Store in a different variable with explicit type
const targetPlayer: Player = nearestPlayer;
const dx = targetPlayer.x - bot.x;
const dy = targetPlayer.y - bot.y;
```

### 2. Change Player Rendering to Triangle
**Priority: MEDIUM**

#### Location: `public/game.js:594-631`

**Current Code:**
```javascript
// Draw player as a circle
ctx.fillStyle = isMe ? COLORS.PLAYER : COLORS.OTHER_PLAYER;
ctx.beginPath();
ctx.arc(screenX + TILE_SIZE / 2, screenY + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
ctx.fill();
```

**New Implementation:**
```javascript
// Draw player as a triangle (pointing in the direction they're facing)
ctx.fillStyle = isMe ? COLORS.PLAYER : COLORS.OTHER_PLAYER;
ctx.save();

// Translate to player center
ctx.translate(screenX + TILE_SIZE / 2, screenY + TILE_SIZE / 2);

// Rotate based on player angle (for aiming direction)
ctx.rotate(player.angle);

// Draw triangle pointing right (0 degrees)
const size = TILE_SIZE / 2;
ctx.beginPath();
ctx.moveTo(size * 0.6, 0);           // Front point
ctx.lineTo(-size * 0.4, -size * 0.5); // Back top
ctx.lineTo(-size * 0.4, size * 0.5);  // Back bottom
ctx.closePath();
ctx.fill();

// Draw outline
ctx.strokeStyle = '#fff';
ctx.lineWidth = 2;
ctx.stroke();

ctx.restore();
```

**Additional Changes:**
- Update mouse tracking to calculate angle: `game.js` needs mouse move listener
- Send angle updates to server: Already exists in `DungeonRoom.ts:77-83`
- Ensure player.angle is updated from mouse position

### 3. Implement Kill-Based Level System
**Priority: HIGH**

#### Overview
Replace the current exit-based level system with a kill-based progression system.

#### Level Requirements
- **Level 1:** Kill 10 bots → Advance to Level 2
- **Level 2:** Kill 15 bots → Advance to Level 3
- **Level 3:** Kill 20 bots → Advance to Level 4
- **Level 4:** Kill 25 bots → Advance to Level 5
- **Level 5:** Kill 30 bots → Game complete

#### Schema Changes: `src/rooms/schema/DungeonState.ts`

**Add new fields:**
```typescript
@type("number") currentLevelKills: number = 0; // Kills in current level
@type("number") killsNeededForNextLevel: number = 10; // Dynamic target
```

**Update existing:**
```typescript
@type("number") currentLevel: number = 1; // Current level (1-5)
@type("number") totalLevels: number = 5; // Update from 4 to 5
```

#### Server Logic Changes: `src/rooms/DungeonRoom.ts`

**Initialize level system in `onCreate()`:**
```typescript
this.state.currentLevel = 1;
this.state.totalLevels = 5;
this.state.currentLevelKills = 0;
this.state.killsNeededForNextLevel = this.getKillsForLevel(1);

// Helper method to calculate kills needed
private getKillsForLevel(level: number): number {
  if (level === 1) return 10;
  if (level === 2) return 15;
  // Levels 3-5: increment by 5
  return 15 + (level - 2) * 5; // Returns 20, 25, 30
}
```

**Modify `checkCollisions()` method (line 255-316):**
```typescript
if (bot.health <= 0) {
  botsToRemove.push(botId);

  // Award kill to player
  const player = this.state.players.get(bullet.playerId);
  if (player) {
    player.score++;
    this.state.totalKills++;
    this.state.currentLevelKills++;

    console.log(`Bot killed. Level kills: ${this.state.currentLevelKills}/${this.state.killsNeededForNextLevel}`);

    // Check if level is complete
    if (this.state.currentLevelKills >= this.state.killsNeededForNextLevel) {
      this.advanceToNextLevel(bullet.playerId);
    } else {
      // Spawn new bot to maintain population
      this.spawnBots(1);
    }
  }
}
```

**Update `advanceToNextLevel()` method:**
```typescript
private advanceToNextLevel(triggerPlayerSessionId: string): void {
  const nextLevel = this.state.currentLevel + 1;

  if (nextLevel > this.state.totalLevels) {
    // Game completed!
    console.log(`Player ${triggerPlayerSessionId} completed all 5 levels!`);
    this.broadcast("gameCompleted", {
      triggerPlayer: triggerPlayerSessionId,
      totalKills: this.state.totalKills
    });

    // Reset to level 1 or end game
    this.state.currentLevel = 1;
    this.state.currentLevelKills = 0;
    this.state.killsNeededForNextLevel = this.getKillsForLevel(1);
    this.generateLevel(1);
  } else {
    // Advance to next level
    console.log(`Level ${this.state.currentLevel} complete! Advancing to Level ${nextLevel}`);
    this.state.currentLevel = nextLevel;
    this.state.currentLevelKills = 0;
    this.state.killsNeededForNextLevel = this.getKillsForLevel(nextLevel);

    // Keep same dungeon layout, just increase difficulty
    // OR regenerate dungeon: this.generateLevel(nextLevel);
  }

  // Broadcast level change
  this.broadcast("levelAdvanced", {
    newLevel: this.state.currentLevel,
    killsNeeded: this.state.killsNeededForNextLevel,
    triggerPlayer: triggerPlayerSessionId
  });
}
```

#### Client Changes: `public/game.js`

**Update HUD display (line 180-186):**
```javascript
<div id="gameInfo">
  <div>
    Level: <span id="currentLevel">1</span>/<span id="totalLevels">5</span> |
    Kills: <span id="levelKills">0</span>/<span id="killsNeeded">10</span> |
    Players: <span id="playerCount">0</span> |
    Room: <span id="roomId">-</span>
  </div>
</div>
```

**Listen for level advancement (add in connect() function):**
```javascript
room.onMessage('levelAdvanced', (message) => {
  console.log('Level up!', message);

  currentLevelEl.textContent = message.newLevel;
  // Update kills display
  document.getElementById('levelKills').textContent = '0';
  document.getElementById('killsNeeded').textContent = message.killsNeeded;

  if (message.triggerPlayer === mySessionId) {
    statusEl.textContent = `Level ${message.newLevel}! Kill ${message.killsNeeded} bots!`;
  } else {
    statusEl.textContent = `Level ${message.newLevel}! (Someone else triggered it)`;
  }
});

room.onMessage('gameCompleted', (message) => {
  statusEl.textContent = message.triggerPlayer === mySessionId
    ? '🎉 YOU WON! All 5 levels completed!'
    : '🎉 Game completed!';
});
```

**Update state change handler:**
```javascript
room.state.onChange = () => {
  playerCountEl.textContent = room.state.players.size;

  // Update kill progress
  if (room.state.currentLevelKills !== undefined) {
    document.getElementById('levelKills').textContent = room.state.currentLevelKills;
    document.getElementById('killsNeeded').textContent = room.state.killsNeededForNextLevel;
  }

  messagesReceived++;
};
```

### 4. Increase Bot Endurance Per Level
**Priority: MEDIUM**

#### Location: `src/rooms/DungeonRoom.ts:186-206`

**Current Implementation:**
```typescript
private spawnBots(count: number): void {
  // ...
  const difficultyMultiplier = 1 + Math.floor(this.state.totalKills / 10) * 0.5;
  bot.maxHealth = Math.floor(100 * difficultyMultiplier);
  bot.health = bot.maxHealth;
  // ...
}
```

**New Implementation (based on current level):**
```typescript
private spawnBots(count: number): void {
  for (let i = 0; i < count; i++) {
    const bot = new Bot();
    bot.id = `bot_${this.botIdCounter++}`;

    // Find random walkable location
    const location = this.findRandomWalkableLocation();
    if (location) {
      bot.x = location.x;
      bot.y = location.y;

      // Calculate bot health based on CURRENT LEVEL
      // Level 1: 100 HP (2 shots)
      // Level 2: 150 HP (3 shots)
      // Level 3: 200 HP (4 shots)
      // Level 4: 250 HP (5 shots)
      // Level 5: 300 HP (6 shots)
      const baseHealth = 100;
      const healthPerLevel = 50;
      bot.maxHealth = baseHealth + (this.state.currentLevel - 1) * healthPerLevel;
      bot.health = bot.maxHealth;

      this.state.bots.set(bot.id, bot);
      console.log(`Bot spawned for Level ${this.state.currentLevel} with ${bot.maxHealth} HP`);
    }
  }
}
```

**Alternative: More granular scaling**
```typescript
// For more shots required at higher levels:
private getBotHealthForLevel(level: number): number {
  const shotsRequired = 1 + level; // Level 1: 2 shots, Level 5: 6 shots
  const damagePerShot = 50; // From checkCollisions() line 265
  return shotsRequired * damagePerShot;
}

// In spawnBots():
bot.maxHealth = this.getBotHealthForLevel(this.state.currentLevel);
bot.health = bot.maxHealth;
```

### 5. UI/UX Improvements
**Priority: LOW**

#### Health Bars for Bots
Add visual health bars above bots in `public/game.js`:

```javascript
// After drawing bots, add health bars
room.state.bots.forEach((bot) => {
  const screenX = (bot.x - cameraX) * TILE_SIZE;
  const screenY = (bot.y - cameraY) * TILE_SIZE;

  if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
    // Draw bot (existing code)
    // ...

    // Draw health bar above bot
    const barWidth = TILE_SIZE * 0.8;
    const barHeight = 4;
    const healthPercent = bot.health / bot.maxHealth;

    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(screenX + (TILE_SIZE - barWidth) / 2, screenY - 8, barWidth, barHeight);

    // Health
    ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : '#ff0000';
    ctx.fillRect(screenX + (TILE_SIZE - barWidth) / 2, screenY - 8, barWidth * healthPercent, barHeight);
  }
});
```

#### Player Lives Display
Update `public/index.html` to show player lives:

```html
<div id="gameInfo">
  <div>
    Level: <span id="currentLevel">1</span>/<span id="totalLevels">5</span> |
    Kills: <span id="levelKills">0</span>/<span id="killsNeeded">10</span> |
    Lives: <span id="playerLives">3</span> |
    Players: <span id="playerCount">0</span>
  </div>
</div>
```

Update in `public/game.js`:
```javascript
room.state.onChange = () => {
  const myPlayer = room.state.players.get(mySessionId);
  if (myPlayer) {
    document.getElementById('playerLives').textContent = myPlayer.lives;
  }
};
```

### 6. Game Balance Adjustments
**Priority: LOW**

#### Bot Spawn Rate
Adjust initial bot count and respawn behavior:
- Level 1: 3 bots active at once
- Level 2: 4 bots active at once
- Level 3: 5 bots active at once
- Level 4: 6 bots active at once
- Level 5: 7 bots active at once

```typescript
private getBotsForLevel(level: number): number {
  return 2 + level; // 3-7 bots
}

// In onCreate()
this.spawnBots(this.getBotsForLevel(1));

// In checkCollisions(), instead of always spawning 1:
if (this.state.bots.size < this.getBotsForLevel(this.state.currentLevel)) {
  this.spawnBots(1);
}
```

#### Bot Speed Scaling
Make bots faster at higher levels:

```typescript
private updateBots(deltaTime: number): void {
  const BASE_SPEED = 2;
  const speedMultiplier = 1 + (this.state.currentLevel - 1) * 0.1; // +10% per level
  const BOT_SPEED = BASE_SPEED * speedMultiplier;

  // ... rest of bot AI code
}
```

## Implementation Order

### Phase 1: Critical Fixes
1. Fix TypeScript build errors in `DungeonRoom.ts:232-233`
2. Test that game builds successfully

### Phase 2: Core Gameplay Changes
1. Update schema with new level fields (`DungeonState.ts`)
2. Implement kill-based level progression (`DungeonRoom.ts`)
3. Update bot health scaling per level (`DungeonRoom.ts`)
4. Update client to display new level system (`game.js`, `index.html`)

### Phase 3: Visual Updates
1. Change player rendering from circle to triangle (`game.js`)
2. Add mouse tracking for player angle updates (`game.js`)
3. Add health bars for bots (`game.js`)
4. Add lives display for players (`index.html`, `game.js`)

### Phase 4: Polish
1. Adjust bot spawn counts per level
2. Add bot speed scaling
3. Test game balance
4. Update game title and instructions

## Testing Checklist

- [ ] Game builds without errors (`pnpm build`)
- [ ] Level 1: Can kill 10 bots to advance to Level 2
- [ ] Level 2: Can kill 15 bots to advance to Level 3
- [ ] Level 3: Can kill 20 bots to advance to Level 4
- [ ] Level 4: Can kill 25 bots to advance to Level 5
- [ ] Level 5: Can kill 30 bots to complete game
- [ ] Bots require more shots to kill at higher levels
  - Level 1: 2 shots (100 HP)
  - Level 2: 3 shots (150 HP)
  - Level 3: 4 shots (200 HP)
  - Level 4: 5 shots (250 HP)
  - Level 5: 6 shots (300 HP)
- [ ] Player renders as triangle pointing in aiming direction
- [ ] HUD shows kills progress (X/Y kills)
- [ ] HUD shows player lives
- [ ] Player loses lives when hit by bots
- [ ] Player respawns at spawn point after being hit (if lives remain)
- [ ] Game over message when player runs out of lives
- [ ] Level up message when kill requirement met
- [ ] Game completion message after Level 5

## File Changes Summary

| File | Changes |
|------|---------|
| `src/rooms/schema/DungeonState.ts` | Add `currentLevelKills`, `killsNeededForNextLevel` fields; update `totalLevels` to 5 |
| `src/rooms/DungeonRoom.ts` | Fix TypeScript error; implement kill-based progression; update bot health scaling; add `getKillsForLevel()` and `getBotHealthForLevel()` methods; modify `checkCollisions()` and `advanceToNextLevel()` |
| `public/game.js` | Change player rendering to triangle; add mouse tracking; add bot health bars; listen for `levelAdvanced` and `gameCompleted` messages; update state change handler |
| `public/index.html` | Update HUD to show kills progress and player lives; update game title |

## Estimated Complexity

- **TypeScript Fix:** 10 minutes
- **Kill-Based Progression:** 1-2 hours
- **Triangle Rendering + Mouse Tracking:** 30 minutes - 1 hour
- **Bot Health Scaling:** 30 minutes
- **UI Updates:** 1 hour
- **Testing & Polish:** 1-2 hours

**Total Estimated Time:** 5-7 hours
