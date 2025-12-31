import { MapSchema } from '@colyseus/schema';
import { DungeonState, Player, Bot } from '../rooms/schema/DungeonState';
import { TileType, getDifficultyForDepth } from '../utils/dungeonGenerator';
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
  
  // Spawn zone rotation
  private lastUsedSpawnZoneIndex = -1; // Track which zone was used last
  private botRoles = new Map<string, 'attack' | 'flank'>(); // Track bot tactical roles
  
  // Configuration
  private readonly PATH_UPDATE_INTERVAL = 800; // Recalculate paths more frequently (was 1000ms, now 800ms)
  private readonly PLAYER_MOVE_THRESHOLD = 3; // React faster to player movement (was 5, now 3 tiles)
  private readonly STUCK_THRESHOLD = 3; // Consecutive failed moves before recalculating
  private readonly MAX_CONCURRENT_PATHFINDING = 3; // Max bots calculating paths per frame
  private readonly WANDER_DISTANCE = 3; // Distance to wander when no path available

  constructor(
    private state: DungeonState,
    private dungeonData: any
  ) {}

  /**
   * Spawn bots using spawn zones with rotation
   * @param count Number of bots to spawn
   * @param players Current players (to avoid spawning too close)
   * @param mapKey The map key this bot belongs to (e.g., "0_12345" for depth_seed)
   */
  spawnBots(count: number, players: MapSchema<Player>, mapKey: string = ""): void {
    const MIN_SPAWN_DISTANCE = 8; // Reduced from 10 to 8 - bots spawn closer
    const spawnZones = this.dungeonData.spawnZones || [];

    // If no spawn zones available, fall back to random spawning
    if (spawnZones.length === 0) {
      this.spawnBotsRandomly(count, players, mapKey);
      return;
    }

    for (let i = 0; i < count; i++) {
      const bot = new Bot();
      bot.id = `bot_${this.botIdCounter++}`;

      // Rotate to next spawn zone (never use same zone twice in a row)
      this.lastUsedSpawnZoneIndex = (this.lastUsedSpawnZoneIndex + 1) % spawnZones.length;
      const selectedZone = spawnZones[this.lastUsedSpawnZoneIndex];

      // Assign tactical role (every 4th bot is a flanker - 25% instead of 33%)
      const role: 'attack' | 'flank' = i % 4 === 0 ? 'flank' : 'attack';
      this.botRoles.set(bot.id, role);

      // Find spawn location within the zone
      let location = null;
      let attempts = 0;
      const maxAttempts = 50;

      while (attempts < maxAttempts && !location) {
        // Random point within zone radius
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * selectedZone.radius;
        const candidate = {
          x: Math.floor(selectedZone.x + Math.cos(angle) * distance),
          y: Math.floor(selectedZone.y + Math.sin(angle) * distance),
        };

        // Check if location is valid
        if (!this.isValidMove(candidate.x, candidate.y)) {
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

      // If no valid location in zone, try adjacent zones
      if (!location) {
        location = this.findLocationInAdjacentZones(spawnZones, players, MIN_SPAWN_DISTANCE);
      }

      if (location) {
        bot.x = location.x;
        bot.y = location.y;
        bot.targetX = location.x;
        bot.targetY = location.y;
        bot.moveStartTime = Date.now();

        // Calculate bot health based on current map depth
        const difficulty = getDifficultyForDepth(this.state.currentMapDepth);
        bot.maxHealth = difficulty.botHealth;
        bot.health = bot.maxHealth;
        
        // Set the map key for multi-map filtering
        bot.mapKey = mapKey;

        this.state.bots.set(bot.id, bot);
        
        console.log(`🤖 Spawned ${role} bot ${bot.id} in ${selectedZone.direction} zone at (${bot.x}, ${bot.y}) [map: ${mapKey}]`);
      }
    }
  }

  /**
   * Try to find spawn location in zones adjacent to the last used zone
   */
  private findLocationInAdjacentZones(
    spawnZones: any[], 
    players: MapSchema<Player>, 
    minDistance: number
  ): { x: number; y: number } | null {
    // Try all zones except the last used one
    for (let i = 0; i < spawnZones.length; i++) {
      if (i === this.lastUsedSpawnZoneIndex) continue;

      const zone = spawnZones[i];
      
      for (let attempt = 0; attempt < 20; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * zone.radius;
        const candidate = {
          x: Math.floor(zone.x + Math.cos(angle) * distance),
          y: Math.floor(zone.y + Math.sin(angle) * distance),
        };

        if (!this.isValidMove(candidate.x, candidate.y)) continue;

        let tooCloseToPlayer = false;
        players.forEach((player) => {
          if (player.lives > 0) {
            const dist = Math.sqrt(
              Math.pow(candidate.x - player.x, 2) +
              Math.pow(candidate.y - player.y, 2)
            );
            if (dist < minDistance) {
              tooCloseToPlayer = true;
            }
          }
        });

        if (!tooCloseToPlayer) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Fallback: spawn bots randomly (old behavior)
   */
  private spawnBotsRandomly(count: number, players: MapSchema<Player>, mapKey: string = ""): void {
    const MIN_SPAWN_DISTANCE = 10;

    for (let i = 0; i < count; i++) {
      const bot = new Bot();
      bot.id = `bot_${this.botIdCounter++}`;

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
        const tileX = Math.floor(location.x);
        const tileY = Math.floor(location.y);
        
        bot.x = tileX;
        bot.y = tileY;
        bot.targetX = tileX;
        bot.targetY = tileY;
        bot.moveStartTime = Date.now();

        const difficulty = getDifficultyForDepth(this.state.currentMapDepth);
        bot.maxHealth = difficulty.botHealth;
        bot.health = bot.maxHealth;
        
        // Set the map key for multi-map filtering
        bot.mapKey = mapKey;

        this.state.bots.set(bot.id, bot);
      }
    }
  }

  /**
   * Update bot AI (tile-based movement with A* pathfinding)
   * @param deltaTime Time since last update in seconds
   * @param players All players (will be filtered to those on the same map)
   * @param mapKey Optional map key to filter bots - only bots with this mapKey will be updated
   */
  updateBots(deltaTime: number, players: MapSchema<Player>, mapKey?: string): void {
    const currentTime = Date.now();
    const difficulty = getDifficultyForDepth(this.state.currentMapDepth);
    const moveInterval = this.getMoveIntervalFromSpeed(difficulty.botSpeed);

    // Process pathfinding queue (limit concurrent calculations)
    this.processPathfindingQueue(players, mapKey);

    this.state.bots.forEach((bot) => {
      // Skip bots not on this map (if mapKey filter is provided)
      if (mapKey && bot.mapKey !== mapKey) {
        return;
      }
      
      // Check if bot is on cooldown
      const lastMove = this.botMoveCooldowns.get(bot.id) || 0;
      const timeSinceLastMove = currentTime - lastMove;

      if (timeSinceLastMove < moveInterval) {
        return; // Still on cooldown, skip this bot
      }

      // Find nearest living player ON THE SAME MAP
      const nearestPlayer = this.findNearestPlayerOnMap(bot, players, mapKey);
      if (!nearestPlayer) return;

      // Determine target based on bot role
      const targetPosition = this.getTargetPosition(bot, nearestPlayer);

      // Check if bot needs path recalculation
      if (this.shouldRecalculatePath(bot, nearestPlayer, currentTime)) {
        this.requestPathCalculation(bot.id);
      }

      // Get next tile from path or fallback to direct movement
      const nextTile = this.getNextTileFromPath(bot, targetPosition);
      
      if (nextTile && this.isValidMove(nextTile.x, nextTile.y) && !this.isTileOccupied(nextTile.x, nextTile.y, bot.id, mapKey)) {
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
   * Find nearest living player on the same map as the bot
   * @param bot The bot looking for a target
   * @param players All players
   * @param mapKey Optional map key - if provided, only consider players on this map
   */
  private findNearestPlayerOnMap(bot: Bot, players: MapSchema<Player>, mapKey?: string): Player | undefined {
    let nearestPlayer: Player | undefined = undefined;
    let nearestDistance = Infinity;

    players.forEach((player) => {
      if (player.lives <= 0) return;
      
      // If mapKey is provided, check if player is on the same map
      // We need to check player's currentMapDepth and currentMapSeed
      if (mapKey) {
        // Parse mapKey format: "depth_seed" e.g., "0_12345"
        const [depthStr, seedStr] = mapKey.split('_');
        const mapDepth = parseInt(depthStr, 10);
        const mapSeed = parseInt(seedStr, 10);
        
        // Only consider players on the same map
        if (player.currentMapDepth !== mapDepth || player.currentMapSeed !== mapSeed) {
          return;
        }
      }
      
      const dist = Math.sqrt((player.x - bot.x) ** 2 + (player.y - bot.y) ** 2);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestPlayer = player;
      }
    });

    return nearestPlayer;
  }

  /**
   * Get target position based on bot's tactical role
   */
  private getTargetPosition(bot: Bot, player: Player): { x: number; y: number } {
    const role = this.botRoles.get(bot.id) || 'attack';
    const playerX = Math.floor(player.x);
    const playerY = Math.floor(player.y);

    // Check distance to player
    const distance = Math.sqrt(
      Math.pow(bot.x - playerX, 2) + Math.pow(bot.y - playerY, 2)
    );

    if (role === 'flank' && distance > 3) {
      // Only flank if we're not already close
      // Flanking bots try to approach from the side
      return this.calculateFlankPosition(bot, player);
    } else {
      // Attack bots or close flankers go directly at player
      return { x: playerX, y: playerY };
    }
  }

  /**
   * Calculate a flanking position - try to approach from the side instead of head-on
   */
  private calculateFlankPosition(bot: Bot, player: Player): { x: number; y: number } {
    const playerX = Math.floor(player.x);
    const playerY = Math.floor(player.y);

    // Calculate angle from bot to player
    const angleToPlayer = Math.atan2(playerY - bot.y, playerX - bot.x);
    
    // Add 90 degrees (perpendicular) to flank from the side
    // Try both directions and pick the closer one
    const flankAngle1 = angleToPlayer + Math.PI / 2;
    const flankAngle2 = angleToPlayer - Math.PI / 2;
    
    // Much closer flank distance - just offset by 3-4 tiles to the side
    const flankDistance = 3;
    
    const flank1 = {
      x: Math.floor(playerX + Math.cos(flankAngle1) * flankDistance),
      y: Math.floor(playerY + Math.sin(flankAngle1) * flankDistance),
    };
    
    const flank2 = {
      x: Math.floor(playerX + Math.cos(flankAngle2) * flankDistance),
      y: Math.floor(playerY + Math.sin(flankAngle2) * flankDistance),
    };
    
    // Pick the flank position that's closer to the bot's current position
    const dist1 = Math.sqrt(Math.pow(bot.x - flank1.x, 2) + Math.pow(bot.y - flank1.y, 2));
    const dist2 = Math.sqrt(Math.pow(bot.x - flank2.x, 2) + Math.pow(bot.y - flank2.y, 2));
    
    const preferredFlank = dist1 < dist2 ? flank1 : flank2;
    
    // Check if flank position is valid
    if (this.isValidMove(preferredFlank.x, preferredFlank.y)) {
      return preferredFlank;
    }
    
    // If preferred flank isn't valid, try the other one
    const alternateFlank = dist1 < dist2 ? flank2 : flank1;
    if (this.isValidMove(alternateFlank.x, alternateFlank.y)) {
      return alternateFlank;
    }
    
    // Both flanks blocked - go directly at player
    return { x: playerX, y: playerY };
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
  private getNextTileFromPath(bot: Bot, target: { x: number; y: number }): { x: number; y: number } | null {
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
      // Direct line of sight - use simple greedy movement toward target
      return this.getNextTileToward(bot, target);
    }
    
    // No path and no line of sight - wander randomly
    return this.getRandomAdjacentTile(bot);
  }

  /**
   * Get next tile toward a target position (not necessarily a player)
   */
  private getNextTileToward(bot: Bot, target: { x: number; y: number }): { x: number; y: number } | null {
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
  private processPathfindingQueue(players: MapSchema<Player>, mapKey?: string): void {
    const botsToProcess = Math.min(this.pathfindingQueue.length, this.MAX_CONCURRENT_PATHFINDING);
    
    for (let i = 0; i < botsToProcess; i++) {
      const botId = this.pathfindingQueue.shift();
      if (!botId) continue;
      
      const bot = this.state.bots.get(botId);
      if (!bot) continue;
      
      // Skip if bot is not on the current map being processed
      if (mapKey && bot.mapKey !== mapKey) continue;
      
      const target = this.findNearestPlayerOnMap(bot, players, mapKey);
      if (!target) continue;
      
      this.calculatePath(bot, target);
    }
  }

  /**
   * Calculate A* path for bot to target (considers flanking positions)
   */
  private calculatePath(bot: Bot, target: Player): void {
    const start: Point = { x: Math.floor(bot.x), y: Math.floor(bot.y) };
    
    // Get the appropriate target position based on bot role
    const targetPosition = this.getTargetPosition(bot, target);
    const goal: Point = { x: Math.floor(targetPosition.x), y: Math.floor(targetPosition.y) };
    
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
   * Check if tile is occupied by another bot (on the same map)
   * @param x Tile X coordinate
   * @param y Tile Y coordinate  
   * @param excludeBotId Bot ID to exclude from check
   * @param mapKey Optional map key - if provided, only check bots on this map
   */
  private isTileOccupied(x: number, y: number, excludeBotId: string, mapKey?: string): boolean {
    for (const [botId, bot] of this.state.bots) {
      if (botId === excludeBotId) continue;
      
      // Skip bots on different maps
      if (mapKey && bot.mapKey !== mapKey) continue;
      
      if (bot.x === x && bot.y === y) {
        return true; // Tile occupied
      }
    }
    return false;
  }

  /**
   * Get move interval from bot speed value (from difficulty config)
   * The botSpeed is already in ms - lower values = faster movement
   */
  getMoveIntervalFromSpeed(botSpeed: number): number {
    return Math.max(100, botSpeed); // Minimum 100ms between moves
  }

  /**
   * Get move interval based on map depth
   * @deprecated Use getMoveIntervalFromSpeed with difficulty.botSpeed instead
   */
  getMoveInterval(depth: number): number {
    const difficulty = getDifficultyForDepth(depth);
    return this.getMoveIntervalFromSpeed(difficulty.botSpeed);
  }

  /**
   * Clear bots belonging to a specific map and their associated state
   * @param mapKey The map key to clear bots for (e.g., "2_12345" for depth_seed)
   */
  clearBotsForMap(mapKey: string): void {
    // Only clear bots belonging to this specific map
    const botsToRemove: string[] = [];
    this.state.bots.forEach((bot, id) => {
      if (bot.mapKey === mapKey) {
        botsToRemove.push(id);
      }
    });
    
    botsToRemove.forEach(id => {
      this.state.bots.delete(id);
      // Clean up associated state for this bot
      this.botMoveCooldowns.delete(id);
      this.botPaths.delete(id);
      this.botPathTargets.delete(id);
      this.botStuckCounters.delete(id);
      this.botLastPathUpdate.delete(id);
      this.botRoles.delete(id);
      
      // Remove from pathfinding queue if present
      const queueIndex = this.pathfindingQueue.indexOf(id);
      if (queueIndex !== -1) {
        this.pathfindingQueue.splice(queueIndex, 1);
      }
    });
    
    console.log(`🧹 Cleared ${botsToRemove.length} bots for map ${mapKey}`);
  }
  
  /**
   * Clear all bots and their cooldowns (use with caution - clears ALL maps)
   * @deprecated Use clearBotsForMap(mapKey) instead to avoid clearing bots from other maps
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
    
    // Clear spawn zone rotation and roles
    this.lastUsedSpawnZoneIndex = -1;
    this.botRoles.clear();
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
   * Get number of bots for level (scaled for 8 players on larger map)
   */
  getBotsForLevel(level: number): number {
    // Level 1: 5 bots, Level 2: 7, Level 3: 9, Level 4: 11, Level 5: 13
    return 3 + level * 2;
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

    // Bots can walk on floor, spawn, exit, inactive transports, and portal tiles - but NOT obstacles or walls
    return tile === TileType.FLOOR || 
           tile === TileType.SPAWN || 
           tile === TileType.EXIT || 
           tile === TileType.TRANSPORT_INACTIVE ||
           tile === TileType.ENTRY_PORTAL ||
           tile === TileType.EXIT_PORTAL ||
           tile === TileType.HOME_MARKER;
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
