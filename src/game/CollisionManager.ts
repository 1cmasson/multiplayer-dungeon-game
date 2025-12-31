import { MapSchema } from '@colyseus/schema';
import { DungeonState, Player, Bot, Bullet } from '../rooms/schema/DungeonState';
import { TileType } from '../utils/dungeonGenerator';

export interface KillEvent {
  botId: string;
  playerIds: string[];  // Changed: array of player IDs who contributed to the kill
  creditPerPlayer: number;  // New: credit each player gets (0.5 for split kills)
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

/**
 * Manages collision detection between bullets, bots, and players
 */
export class CollisionManager {
  // Track which players have damaged each bot (for split kill credit)
  private botDamageDealers: Map<string, Set<string>> = new Map();
  
  constructor(
    private state: DungeonState,
    private dungeonData: any
  ) {}

  /**
   * Check bullet vs bot collisions (tile-based)
   * @param bullets All bullets
   * @param bots All bots
   * @param mapKey Optional map key to filter - only check collisions on this map
   */
  checkBulletVsBots(
    bullets: MapSchema<Bullet>,
    bots: MapSchema<Bot>,
    mapKey?: string
  ): BulletCollisionResult {
    const bulletsToRemove: string[] = [];
    const botsToRemove: string[] = [];
    const killEvents: KillEvent[] = [];

    bullets.forEach((bullet, bulletId) => {
      // Skip bullets not on this map (if filtering)
      if (mapKey && bullet.mapKey !== mapKey) {
        return;
      }
      
      // Get bullet's tile position
      const bulletTileX = Math.floor(bullet.x);
      const bulletTileY = Math.floor(bullet.y);

      bots.forEach((bot, botId) => {
        // Skip bots not on this map (if filtering)
        if (mapKey && bot.mapKey !== mapKey) {
          return;
        }
        
        // Also skip if bullet and bot are on different maps (regardless of filter)
        if (bullet.mapKey !== bot.mapKey) {
          return;
        }
        
        // Check if bullet is on same tile as bot
        if (bulletTileX === bot.x && bulletTileY === bot.y) {
          // Hit! Damage bot
          bot.health -= 50; // 2 hits to kill base bot
          bulletsToRemove.push(bulletId);

          // Track damage dealer for split kill credit
          if (!this.botDamageDealers.has(botId)) {
            this.botDamageDealers.set(botId, new Set());
          }
          this.botDamageDealers.get(botId)!.add(bullet.playerId);

          if (bot.health <= 0) {
            botsToRemove.push(botId);
            
            // Get all players who damaged this bot
            const dealers = this.botDamageDealers.get(botId);
            const playerIds = dealers ? Array.from(dealers) : [bullet.playerId];
            
            // Calculate credit per player: 0.5 each if multiple, 1.0 if solo
            const creditPerPlayer = playerIds.length > 1 ? 0.5 : 1.0;
            
            killEvents.push({
              botId,
              playerIds,
              creditPerPlayer
            });
            
            // Clean up tracking for this bot
            this.botDamageDealers.delete(botId);
          }
        }
      });
    });

    return { bulletsToRemove, botsToRemove, killEvents };
  }

  /**
   * Check bot vs player collisions (tile-based)
   * NOTE: This method only detects collisions and decrements lives.
   * Respawn logic is handled by DungeonRoom which has access to map entry points.
   * @param bots All bots
   * @param players All players
   * @param mapKey Optional map key to filter - only check collisions on this map
   */
  checkBotVsPlayers(
    bots: MapSchema<Bot>,
    players: MapSchema<Player>,
    mapKey?: string
  ): PlayerCollisionResult {
    const hitEvents: PlayerHitEvent[] = [];
    const currentTime = Date.now();

    bots.forEach((bot) => {
      // Skip bots not on this map (if filtering)
      if (mapKey && bot.mapKey !== mapKey) {
        return;
      }
      
      players.forEach((player) => {
        // Skip if player is dead or invincible
        if (player.lives <= 0 || player.invincibleUntil > currentTime) {
          return;
        }
        
        // Skip if player is on a different map than the bot
        // Compare using player's currentMapDepth and currentMapSeed
        if (mapKey) {
          const [depthStr, seedStr] = mapKey.split('_');
          const mapDepth = parseInt(depthStr, 10);
          const mapSeed = parseInt(seedStr, 10);
          
          if (player.currentMapDepth !== mapDepth || player.currentMapSeed !== mapSeed) {
            return;
          }
        }

        // Check if bot and player are on same tile
        if (bot.x === player.x && bot.y === player.y) {
          player.lives--;
          console.log(`💔 Player ${player.sessionId} hit by bot! Lives: ${player.lives}`);

          // Give invincibility (respawn position handled by DungeonRoom)
          if (player.lives > 0) {
            player.invincibleUntil = currentTime + 3000;
          }

          // Push bot away to adjacent tile (cardinal directions only)
          const pushDirections = [
            { x: 1, y: 0 },   // Right
            { x: -1, y: 0 },  // Left
            { x: 0, y: 1 },   // Down
            { x: 0, y: -1 }   // Up
          ];
          
          // Try each direction randomly until we find a valid tile
          const shuffled = pushDirections.sort(() => Math.random() - 0.5);
          for (const dir of shuffled) {
            const newBotX = bot.x + dir.x;
            const newBotY = bot.y + dir.y;
            
            if (this.isValidMove(newBotX, newBotY)) {
              bot.x = newBotX;
              bot.y = newBotY;
              bot.targetX = newBotX;
              bot.targetY = newBotY;
              bot.moveStartTime = currentTime;
              break; // Found valid push location
            }
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
   * Find safe respawn location away from bots and other players (on the same map)
   * @param excludePlayerId Player to exclude from distance check
   * @param players All players
   * @param mapKey Optional map key - if provided, only consider bots on this map for distance
   */
  private findSafeRespawnLocation(
    excludePlayerId: string,
    players: MapSchema<Player>,
    mapKey?: string
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

      // Check distance from bots on the same map
      let tooCloseToBot = false;
      this.state.bots.forEach((bot) => {
        // Only check bots on the same map
        if (mapKey && bot.mapKey !== mapKey) {
          return;
        }
        
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

    // Round coordinates to grid indices (handles float coordinates)
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);

    // Check against server-side dungeon data
    const tile = this.dungeonData.grid[gridY][gridX];

    // Can walk on floor, spawn, exit, or inactive transports - but NOT obstacles or walls
    return tile === TileType.FLOOR || tile === TileType.SPAWN || tile === TileType.EXIT || tile === TileType.TRANSPORT_INACTIVE;
  }
  
  /**
   * Clear damage tracking for all bots (call when resetting game state)
   */
  clearDamageTracking(): void {
    this.botDamageDealers.clear();
  }
}
