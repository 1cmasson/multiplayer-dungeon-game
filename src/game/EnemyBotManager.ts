import { MapSchema } from '@colyseus/schema';
import { DungeonState, Player, Bot } from '../rooms/schema/DungeonState';
import { TileType } from '../utils/dungeonGenerator';
import { Pathfinding, Point } from '../bots/ai/Pathfinding';

/**
 * Manages enemy bot spawning, movement, and AI behavior
 */
export class EnemyBotManager {
  private botIdCounter = 0;
  private botMoveCooldowns = new Map<string, number>(); // Track last move time per bot
  private readonly BASE_MOVE_INTERVAL = 333; // ms between moves (3 tiles/sec at level 1)
  
  // Pathfinding state
  private botPaths = new Map<string, Point[]>(); // Cached paths for each bot
  private botPathTargets = new Map<string, Point>(); // Player position when path was calculated
  private botStuckCounters = new Map<string, number>(); // Track consecutive failed moves
  private botLastPathUpdate = new Map<string, number>(); // Timestamp of last path calculation
  private pathfindingQueue: string[] = []; // Queue of bots needing path calculation
  
  // Configuration
  private readonly PATH_UPDATE_INTERVAL = 1000; // Recalculate paths every 1 second
  private readonly PLAYER_MOVE_THRESHOLD = 5; // Recalculate if player moves 5+ tiles
  private readonly STUCK_THRESHOLD = 3; // Consecutive failed moves before recalculating
  private readonly MAX_CONCURRENT_PATHFINDING = 3; // Max bots calculating paths per frame
  private readonly WANDER_DISTANCE = 3; // Distance to wander when no path available

  constructor(
    private state: DungeonState,
    private dungeonData: any
  ) {}

  /**
   * Spawn bots with safe distance checks
   */
  spawnBots(count: number, players: MapSchema<Player>): void {
    const MIN_SPAWN_DISTANCE = 10; // Bots must spawn at least 10 tiles from spawn point and players

    for (let i = 0; i < count; i++) {
      const bot = new Bot();
      bot.id = `bot_${this.botIdCounter++}`;

      // Find safe spawn location away from players and spawn point
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

        // Check distance from all players
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
        // Use integer tile positions (not center of tile)
        const tileX = Math.floor(location.x);
        const tileY = Math.floor(location.y);
        
        bot.x = tileX;
        bot.y = tileY;
        bot.targetX = tileX;
        bot.targetY = tileY;
        bot.moveStartTime = Date.now();

        // Calculate bot health based on current level
        bot.maxHealth = this.getBotHealthForLevel(this.state.currentLevel);
        bot.health = bot.maxHealth;

        this.state.bots.set(bot.id, bot);
      }
    }
  }

  /**
   * Update bot AI (tile-based movement with A* pathfinding)
   */
  updateBots(deltaTime: number, players: MapSchema<Player>): void {
    const currentTime = Date.now();
    const moveInterval = this.getMoveInterval(this.state.currentLevel);

    // Process pathfinding queue (limit concurrent calculations)
    this.processPathfindingQueue(players);

    this.state.bots.forEach((bot) => {
      // Check if bot is on cooldown
      const lastMove = this.botMoveCooldowns.get(bot.id) || 0;
      const timeSinceLastMove = currentTime - lastMove;

      if (timeSinceLastMove < moveInterval) {
        return; // Still on cooldown, skip this bot
      }

      // Find nearest living player
      const nearestPlayer = this.findNearestPlayer(bot, players);
      if (!nearestPlayer) return;

      // Check if bot needs path recalculation
      if (this.shouldRecalculatePath(bot, nearestPlayer, currentTime)) {
        this.requestPathCalculation(bot.id);
      }

      // Get next tile from path or fallback to direct movement
      const nextTile = this.getNextTileFromPath(bot, nearestPlayer);
      
      if (nextTile && this.isValidMove(nextTile.x, nextTile.y) && !this.isTileOccupied(nextTile.x, nextTile.y, bot.id)) {
        // Successfully moving - reset stuck counter
        this.botStuckCounters.set(bot.id, 0);
        
        // Update bot position
        bot.targetX = nextTile.x;
        bot.targetY = nextTile.y;
        bot.moveStartTime = currentTime;
        
        bot.x = nextTile.x;
        bot.y = nextTile.y;
        
        // Mark cooldown
        this.botMoveCooldowns.set(bot.id, currentTime);
        
        // Remove this waypoint from path if we reached it
        const currentPath = this.botPaths.get(bot.id);
        if (currentPath && currentPath.length > 0) {
          currentPath.shift(); // Remove first waypoint
        }
      } else {
        // Bot is blocked - increment stuck counter
        const stuckCount = (this.botStuckCounters.get(bot.id) || 0) + 1;
        this.botStuckCounters.set(bot.id, stuckCount);
        
        // If stuck for too long, force path recalculation
        if (stuckCount >= this.STUCK_THRESHOLD) {
          this.requestPathCalculation(bot.id);
          this.botStuckCounters.set(bot.id, 0); // Reset counter
        }
      }
    });
  }

  /**
   * Find nearest living player to bot
   */
  private findNearestPlayer(bot: Bot, players: MapSchema<Player>): Player | undefined {
    let nearestPlayer: Player | undefined = undefined;
    let nearestDistance = Infinity;

    players.forEach((player) => {
      if (player.lives > 0) {
        const dist = Math.sqrt((player.x - bot.x) ** 2 + (player.y - bot.y) ** 2);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestPlayer = player;
        }
      }
    });

    return nearestPlayer;
  }

  /**
   * Get next tile to move to (cardinal directions only: up/down/left/right)
   * DEPRECATED: Legacy greedy movement, kept as fallback
   */
  private getNextTile(bot: Bot, target: Player): { x: number; y: number } | null {
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    
    // Prioritize axis with greater distance
    if (Math.abs(dx) > Math.abs(dy)) {
      // Move horizontally first
      if (dx > 0) {
        return { x: bot.x + 1, y: bot.y }; // Right
      } else if (dx < 0) {
        return { x: bot.x - 1, y: bot.y }; // Left
      }
    } else {
      // Move vertically first
      if (dy > 0) {
        return { x: bot.x, y: bot.y + 1 }; // Down
      } else if (dy < 0) {
        return { x: bot.x, y: bot.y - 1 }; // Up
      }
    }
    
    // Fallback: try opposite axis
    if (Math.abs(dy) > 0) {
      if (dy > 0) {
        return { x: bot.x, y: bot.y + 1 }; // Down
      } else if (dy < 0) {
        return { x: bot.x, y: bot.y - 1 }; // Up
      }
    }
    
    if (Math.abs(dx) > 0) {
      if (dx > 0) {
        return { x: bot.x + 1, y: bot.y }; // Right
      } else if (dx < 0) {
        return { x: bot.x - 1, y: bot.y }; // Left
      }
    }
    
    return null; // Already at target
  }

  /**
   * Get next tile from calculated path or fallback to simple movement
   */
  private getNextTileFromPath(bot: Bot, target: Player): { x: number; y: number } | null {
    const path = this.botPaths.get(bot.id);
    
    // If we have a valid path with waypoints, use it
    if (path && path.length > 0) {
      const nextWaypoint = path[0];
      
      // Ensure we're moving one tile at a time (cardinal directions only)
      const dx = nextWaypoint.x - bot.x;
      const dy = nextWaypoint.y - bot.y;
      
      // Should be exactly 1 tile away in cardinal direction
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        return { x: nextWaypoint.x, y: nextWaypoint.y };
      }
      
      // Path is invalid, clear it
      this.botPaths.delete(bot.id);
    }
    
    // No valid path - use line of sight check first
    if (Pathfinding.hasLineOfSight(this.dungeonData.grid, 
        { x: bot.x, y: bot.y }, 
        { x: Math.floor(target.x), y: Math.floor(target.y) })) {
      // Direct line of sight - use simple greedy movement
      return this.getNextTile(bot, target);
    }
    
    // No path and no line of sight - wander randomly
    return this.getRandomAdjacentTile(bot);
  }

  /**
   * Check if bot needs path recalculation
   */
  private shouldRecalculatePath(bot: Bot, target: Player, currentTime: number): boolean {
    const lastUpdate = this.botLastPathUpdate.get(bot.id) || 0;
    const timeSinceUpdate = currentTime - lastUpdate;
    
    // Recalculate if enough time has passed
    if (timeSinceUpdate >= this.PATH_UPDATE_INTERVAL) {
      return true;
    }
    
    // Recalculate if player moved significantly
    const lastTarget = this.botPathTargets.get(bot.id);
    if (lastTarget) {
      const playerMoved = Math.abs(target.x - lastTarget.x) + Math.abs(target.y - lastTarget.y);
      if (playerMoved >= this.PLAYER_MOVE_THRESHOLD) {
        return true;
      }
    }
    
    // Recalculate if path is empty or invalid
    const path = this.botPaths.get(bot.id);
    if (!path || path.length === 0) {
      return true;
    }
    
    return false;
  }

  /**
   * Request path calculation (adds to queue)
   */
  private requestPathCalculation(botId: string): void {
    if (!this.pathfindingQueue.includes(botId)) {
      this.pathfindingQueue.push(botId);
    }
  }

  /**
   * Process pathfinding queue (limit concurrent calculations)
   */
  private processPathfindingQueue(players: MapSchema<Player>): void {
    const botsToProcess = Math.min(this.pathfindingQueue.length, this.MAX_CONCURRENT_PATHFINDING);
    
    for (let i = 0; i < botsToProcess; i++) {
      const botId = this.pathfindingQueue.shift();
      if (!botId) continue;
      
      const bot = this.state.bots.get(botId);
      if (!bot) continue;
      
      const target = this.findNearestPlayer(bot, players);
      if (!target) continue;
      
      this.calculatePath(bot, target);
    }
  }

  /**
   * Calculate A* path for bot to target
   */
  private calculatePath(bot: Bot, target: Player): void {
    const start: Point = { x: Math.floor(bot.x), y: Math.floor(bot.y) };
    const goal: Point = { x: Math.floor(target.x), y: Math.floor(target.y) };
    
    // Run A* pathfinding
    const path = Pathfinding.findPath(this.dungeonData.grid, start, goal);
    
    if (path.length > 0) {
      // Remove first waypoint (current position)
      path.shift();
      
      // Store path
      this.botPaths.set(bot.id, path);
      this.botPathTargets.set(bot.id, { x: target.x, y: target.y });
      this.botLastPathUpdate.set(bot.id, Date.now());
    } else {
      // No path found - clear existing path
      this.botPaths.delete(bot.id);
      this.botPathTargets.delete(bot.id);
    }
  }

  /**
   * Get a random adjacent walkable tile (for wandering)
   */
  private getRandomAdjacentTile(bot: Bot): { x: number; y: number } | null {
    const directions = [
      { x: 0, y: -1 }, // up
      { x: 0, y: 1 },  // down
      { x: -1, y: 0 }, // left
      { x: 1, y: 0 },  // right
    ];
    
    // Shuffle directions for randomness
    for (let i = directions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [directions[i], directions[j]] = [directions[j], directions[i]];
    }
    
    // Try each direction
    for (const dir of directions) {
      const nextX = bot.x + dir.x;
      const nextY = bot.y + dir.y;
      
      if (this.isValidMove(nextX, nextY)) {
        return { x: nextX, y: nextY };
      }
    }
    
    return null; // No valid adjacent tile
  }

  /**
   * Check if tile is occupied by another bot
   */
  private isTileOccupied(x: number, y: number, excludeBotId: string): boolean {
    for (const [botId, bot] of this.state.bots) {
      if (botId !== excludeBotId && bot.x === x && bot.y === y) {
        return true; // Tile occupied
      }
    }
    return false;
  }

  /**
   * Get move interval based on level (faster at higher levels)
   */
  getMoveInterval(level: number): number {
    const speedMultiplier = 1 - (level - 1) * 0.1; // -10% per level
    return Math.max(100, this.BASE_MOVE_INTERVAL * speedMultiplier);
  }

  /**
   * Clear all bots and their cooldowns
   */
  clearAllBots(): void {
    this.state.bots.clear();
    this.botMoveCooldowns.clear();
    
    // Clear pathfinding state
    this.botPaths.clear();
    this.botPathTargets.clear();
    this.botStuckCounters.clear();
    this.botLastPathUpdate.clear();
    this.pathfindingQueue = [];
  }
  
  /**
   * Get bot paths for debugging visualization
   */
  getBotPaths(): Map<string, Point[]> {
    return this.botPaths;
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
   * Check if position is walkable
   */
  private isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= this.state.width || y < 0 || y >= this.state.height) {
      return false;
    }

    // Round coordinates to grid indices (handles float coordinates)
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);

    // Check against server-side dungeon data
    const tile = this.dungeonData.grid[gridY][gridX];

    // Can walk on floor, spawn, exit, or inactive transports - but NOT obstacles or walls
    return tile === TileType.FLOOR || tile === TileType.SPAWN || tile === TileType.EXIT || tile === TileType.TRANSPORT_INACTIVE;
  }

  /**
   * Find random walkable location (returns integer tile coordinates)
   */
  private findRandomWalkableLocation(): { x: number; y: number } | null {
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const tileX = Math.floor(Math.random() * this.state.width);
      const tileY = Math.floor(Math.random() * this.state.height);

      const tile = this.dungeonData.grid[tileY][tileX];
      if (tile === TileType.FLOOR || tile === TileType.SPAWN) {
        // Return integer tile position
        return { x: tileX, y: tileY };
      }

      attempts++;
    }

    return null;
  }
}
