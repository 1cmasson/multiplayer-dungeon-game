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

/**
 * Manages collision detection between bullets, bots, and players
 */
export class CollisionManager {
  constructor(
    private state: DungeonState,
    private dungeonData: any
  ) {}

  /**
   * Check bullet vs bot collisions (tile-based)
   */
  checkBulletVsBots(
    bullets: MapSchema<Bullet>,
    bots: MapSchema<Bot>
  ): BulletCollisionResult {
    const bulletsToRemove: string[] = [];
    const botsToRemove: string[] = [];
    const killEvents: KillEvent[] = [];

    bullets.forEach((bullet, bulletId) => {
      // Get bullet's tile position
      const bulletTileX = Math.floor(bullet.x);
      const bulletTileY = Math.floor(bullet.y);

      bots.forEach((bot, botId) => {
        // Check if bullet is on same tile as bot
        if (bulletTileX === bot.x && bulletTileY === bot.y) {
          // Hit! Damage bot
          bot.health -= 50; // 2 hits to kill base bot
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
   * Check bot vs player collisions (tile-based)
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

        // Check if bot and player are on same tile
        if (bot.x === player.x && bot.y === player.y) {
          player.lives--;
          console.log(`💔 Player ${player.sessionId} hit by bot! Lives: ${player.lives}`);

          // Respawn player if still alive
          if (player.lives > 0) {
            // Give 3 seconds of invincibility
            player.invincibleUntil = currentTime + 3000;

            // Respawn at a random safe location (away from bots)
            const safeLocation = this.findSafeRespawnLocation(player.sessionId, players);
            if (safeLocation) {
              player.x = safeLocation.x;
              player.y = safeLocation.y;
              console.log(`🔄 Player ${player.sessionId} respawned at (${player.x}, ${player.y}) with 3s invincibility`);
            } else {
              // Fallback to spawn point
              player.x = this.dungeonData.spawnPoint.x;
              player.y = this.dungeonData.spawnPoint.y;
            }
          } else {
            console.log(`☠️  Player ${player.sessionId} is out of lives!`);
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
   * Find safe respawn location away from bots and other players
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

    // Round coordinates to grid indices (handles float coordinates)
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);

    // Check against server-side dungeon data
    const tile = this.dungeonData.grid[gridY][gridX];

    // Can walk on floor, spawn, exit, or inactive transports - but NOT obstacles or walls
    return tile === TileType.FLOOR || tile === TileType.SPAWN || tile === TileType.EXIT || tile === TileType.TRANSPORT_INACTIVE;
  }
}
