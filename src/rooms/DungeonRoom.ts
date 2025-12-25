import { Room, Client } from "colyseus";
import { DungeonState, Player, Transport, Bot, Bullet } from "./schema/DungeonState";
import { DungeonGenerator, TileType, DungeonData, getDifficultyForDepth } from "../utils/dungeonGenerator";
import { EnemyBotManager } from '../game/EnemyBotManager';
import { CollisionManager } from '../game/CollisionManager';
import { MapSchema } from "@colyseus/schema";

// ==========================================
// MULTI-MAP SYSTEM CONFIGURATION
// ==========================================
const MAP_CACHE_LIMIT = 8; // Full state cached for last 8 maps per player

// ==========================================
// MULTI-MAP INTERFACES
// ==========================================

/** Cached state for a single map (used when player leaves a map) */
interface CachedMapState {
  seed: number;
  depth: number;
  bots: Array<{ 
    id: string; 
    x: number; 
    y: number; 
    health: number; 
    maxHealth: number;
    targetX: number;
    targetY: number;
  }>;
  usedTransports: Array<{ x: number; y: number }>;
  playerLastPosition: { x: number; y: number };  // Where player was when they left
  exitPortalPoint: { x: number; y: number };
  entryPortalPoint: { x: number; y: number } | null;
}

/** Per-player map navigation state */
interface PlayerMapState {
  sessionId: string;
  currentDepth: number;
  mapCache: Map<number, CachedMapState>;  // depth -> full state (limited to MAP_CACHE_LIMIT)
  seedHistory: Map<number, number>;        // depth -> seed (unlimited, for regeneration)
}

/** An active map instance with its own bots and state */
interface ActiveMap {
  seed: number;
  depth: number;
  dungeonData: DungeonData;
  bots: MapSchema<Bot>;
  botManager: EnemyBotManager;
  collisionManager: CollisionManager;
  players: Set<string>;  // sessionIds currently on this map
  lastActivity: number;  // timestamp for cleanup
}

/**
 * Generate deterministic next seed from current seed
 */
function generateNextSeed(currentSeed: number): number {
  return (currentSeed * 16807) % 2147483647;
}

export class DungeonRoom extends Room<DungeonState> {
  maxClients = 8;
  private dungeonData: any;
  private levelSeeds: number[] = []; // Seeds for all 4 levels
  private updateInterval: any; // Game loop
  private botIdCounter = 0;
  private bulletIdCounter = 0;
  private enemyBotManager!: EnemyBotManager;
  private collisionManager!: CollisionManager;

  // ==========================================
  // MULTI-MAP SYSTEM STATE
  // ==========================================
  private activeMaps: Map<string, ActiveMap> = new Map(); // key: `${depth}_${seed}`
  private playerMapStates: Map<string, PlayerMapState> = new Map(); // key: sessionId

  onCreate(options: any) {
    this.state = new DungeonState();

    // Set room name if provided
    if (options.roomName) {
      this.state.roomName = options.roomName;
    }

    // Game starts in waiting state
    this.state.gameStarted = false;
    this.state.hostSessionId = ""; // Will be set when first player joins

    // Set room metadata for lobby listing
    this.setMetadata({
      roomName: this.state.roomName || 'Unnamed Room',
      hostName: 'Waiting for players...',
      currentLevel: 1,
      totalLevels: 5,
      currentLevelKills: 0,
      killsNeededForNextLevel: 10,
      gameStarted: false
    });

    // Generate 4 unique seeds for 4 levels
    const baseSeed = options.seed || Date.now();
    for (let i = 0; i < 4; i++) {
      this.levelSeeds.push(baseSeed + i * 1000); // Offset each seed
    }

    this.state.currentLevel = 1;
    this.state.totalLevels = 5;
    this.state.currentLevelKills = 0;
    this.state.killsNeededForNextLevel = this.getKillsForLevel(1);

    // Generate first level
    this.generateLevel(1);

    // Measure initial state size
    this.measureStateSize();

    // Initialize managers
    this.enemyBotManager = new EnemyBotManager(this.state, this.dungeonData);
    this.collisionManager = new CollisionManager(this.state, this.dungeonData);

    // NOTE: Don't spawn bots here - wait for first player to join
    // Bots will be spawned in onJoin() when first player arrives

    // Start game loop for bullets, bots, collisions
    this.startGameLoop();

    // Handle player movement (instant move + auto-rotate)
    // Supports 8 directions: up, down, left, right, up-right, up-left, down-right, down-left
    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const { direction } = message;

      let newX = player.x;
      let newY = player.y;

      // Calculate new position and update angle in one step
      switch (direction) {
        case "up":
          newY -= 1;
          player.angle = -Math.PI / 2;
          break;
        case "down":
          newY += 1;
          player.angle = Math.PI / 2;
          break;
        case "left":
          newX -= 1;
          player.angle = Math.PI;
          break;
        case "right":
          newX += 1;
          player.angle = 0;
          break;
        // Diagonal directions
        case "up-right":
          newY -= 1;
          newX += 1;
          player.angle = -Math.PI / 4;
          break;
        case "up-left":
          newY -= 1;
          newX -= 1;
          player.angle = -3 * Math.PI / 4;
          break;
        case "down-right":
          newY += 1;
          newX += 1;
          player.angle = Math.PI / 4;
          break;
        case "down-left":
          newY += 1;
          newX -= 1;
          player.angle = 3 * Math.PI / 4;
          break;
      }

      // Check if move is valid (not a wall)
      if (this.isValidMove(newX, newY)) {
        player.x = newX;
        player.y = newY;

        // Check if player stepped on an active transport
        this.handleTransport(player, client.sessionId, client);
        
        // Check if player stepped on a portal (entry/exit)
        this.checkPortalCollision(player, client.sessionId, client);
      }
    });

    // Handle player angle update (for aiming)
    this.onMessage("updateAngle", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.lives <= 0) return;

      player.angle = message.angle;
    });

    // Handle shooting
    this.onMessage("shoot", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.lives <= 0) return;

      this.createBullet(player.x, player.y, message.angle, client.sessionId);
    });

    // Handle game start (only host can start)
    this.onMessage("startGame", (client, message) => {
      // Only host can start the game
      if (client.sessionId !== this.state.hostSessionId) {
        console.log(`⚠️ Non-host ${client.sessionId} tried to start game`);
        return;
      }
      
      // Don't start if already started
      if (this.state.gameStarted) {
        console.log('⚠️ Game already started');
        return;
      }

      console.log(`🎮 Host ${client.sessionId} starting the game!`);
      this.state.gameStarted = true;

      // Spawn bots now that game is starting
      const botCount = this.enemyBotManager.getBotsForLevel(this.state.currentLevel);
      this.enemyBotManager.spawnBots(botCount, this.state.players);
      console.log('🤖 Spawned', this.state.bots.size, 'bots for level', this.state.currentLevel);

      // Get host player name for broadcast
      const hostPlayer = this.state.players.get(client.sessionId);
      const hostName = hostPlayer ? hostPlayer.name : 'Host';

      // Update metadata
      this.setMetadata({
        roomName: this.state.roomName || 'Unnamed Room',
        hostName: hostName,
        currentLevel: this.state.currentLevel,
        totalLevels: this.state.totalLevels,
        currentLevelKills: this.state.currentLevelKills,
        killsNeededForNextLevel: this.state.killsNeededForNextLevel,
        gameStarted: true
      });

      // Broadcast game started to all clients
      this.broadcast('gameStarted', { 
        hostName: hostName,
        botCount: botCount
      });

      // Broadcast activity
      this.broadcast('activity', {
        type: 'level',
        text: `Game started by ${hostName}! Kill ${this.state.killsNeededForNextLevel} bots!`
      });
    });
  }

  onJoin(client: Client, options: any) {
    console.log(`${client.sessionId} joined!`);

    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = options.playerName || `Player${Math.floor(Math.random() * 1000)}`;
    // Ensure integer tile coordinates for player spawn
    player.x = Math.floor(this.dungeonData.spawnPoint.x);
    player.y = Math.floor(this.dungeonData.spawnPoint.y);
    player.lives = 3;
    player.angle = 0;
    player.score = 0;
    player.invincibleUntil = 0; // No invincibility on spawn
    
    // Initialize multi-map player state
    player.currentMapDepth = 0;
    player.currentMapSeed = this.state.seed;
    
    // Initialize player's map navigation state
    const playerMapState = this.initializePlayerMapState(client.sessionId, this.state.seed);
    
    // Add player to the initial map (depth 0)
    const initialMapKey = this.getMapKey(0, this.state.seed);
    let initialMap = this.activeMaps.get(initialMapKey);
    if (!initialMap) {
      // Create the initial map if it doesn't exist yet
      initialMap = this.getOrCreateMap(0, this.state.seed);
    }
    initialMap.players.add(client.sessionId);

    this.state.players.set(client.sessionId, player);

    // Set first player as host
    if (this.state.players.size === 1) {
      this.state.hostSessionId = client.sessionId;
      console.log(`👑 ${player.name} (${client.sessionId}) is the host`);
      
      this.setMetadata({
        roomName: this.state.roomName || 'Unnamed Room',
        hostName: player.name,
        currentLevel: this.state.currentLevel,
        totalLevels: this.state.totalLevels,
        currentLevelKills: this.state.currentLevelKills,
        killsNeededForNextLevel: this.state.killsNeededForNextLevel,
        gameStarted: this.state.gameStarted
      });
    }

    // Broadcast player joined activity
    this.broadcast('activity', {
      type: 'join',
      text: `${player.name} joined the game`
    });

    // If game already started (player joining mid-game), they join the active game
    // Bots are only spawned when host clicks "Start Game"

    // Measure state size after player joins
    this.measureStateSize();
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`${client.sessionId} left!`);
    const player = this.state.players.get(client.sessionId);
    if (player) {
      // Broadcast player left activity
      this.broadcast('activity', {
        type: 'leave',
        text: `${player.name} left the game`
      });
    }
    
    // Clean up player from their current map
    const playerMapState = this.playerMapStates.get(client.sessionId);
    if (playerMapState) {
      const currentSeed = playerMapState.seedHistory.get(playerMapState.currentDepth);
      if (currentSeed !== undefined) {
        const mapKey = this.getMapKey(playerMapState.currentDepth, currentSeed);
        const activeMap = this.activeMaps.get(mapKey);
        if (activeMap) {
          activeMap.players.delete(client.sessionId);
        }
      }
      // Remove player's map state
      this.playerMapStates.delete(client.sessionId);
    }
    
    this.state.players.delete(client.sessionId);

    // Handle host leaving before game starts - transfer host to next player
    if (client.sessionId === this.state.hostSessionId && !this.state.gameStarted) {
      // Find next player to be host
      const remainingPlayers = Array.from(this.state.players.keys());
      if (remainingPlayers.length > 0) {
        const newHostId = remainingPlayers[0];
        const newHost = this.state.players.get(newHostId);
        this.state.hostSessionId = newHostId;
        
        console.log(`👑 Host transferred to ${newHost?.name} (${newHostId})`);
        
        // Broadcast host change
        this.broadcast('hostChanged', {
          newHostId: newHostId,
          newHostName: newHost?.name || 'Unknown'
        });
        
        this.broadcast('activity', {
          type: 'level',
          text: `${newHost?.name} is now the host`
        });

        // Update metadata
        this.setMetadata({
          roomName: this.state.roomName || 'Unnamed Room',
          hostName: newHost?.name || 'Unknown',
          currentLevel: this.state.currentLevel,
          totalLevels: this.state.totalLevels,
          currentLevelKills: this.state.currentLevelKills,
          killsNeededForNextLevel: this.state.killsNeededForNextLevel,
          gameStarted: this.state.gameStarted
        });
      }
    }
    
    // Cleanup empty maps
    this.cleanupEmptyMaps();
  }

  onDispose() {
    console.log("Room disposed");
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }

  /**
   * Start the game update loop
   */
  private startGameLoop(): void {
    const FPS = 30;
    const DELTA_TIME = 1000 / FPS;

    this.updateInterval = setInterval(() => {
      this.updateBullets(DELTA_TIME / 1000);
      
      // Only update bots and check bot collisions if game has started
      if (this.state.gameStarted) {
        this.enemyBotManager.updateBots(DELTA_TIME / 1000, this.state.players);
        this.checkCollisions();
      }
    }, DELTA_TIME);

    // Broadcast bot paths for debugging (every 500ms to reduce network traffic)
    setInterval(() => {
      const botPaths = this.enemyBotManager.getBotPaths();
      const pathsData: { [key: string]: Array<{ x: number; y: number }> } = {};
      
      botPaths.forEach((path, botId) => {
        pathsData[botId] = path;
      });
      
      this.broadcast('botPaths', pathsData);
    }, 500);
  }

  /**
   * Create a bullet
   */
  private createBullet(x: number, y: number, angle: number, playerId: string): void {
    const bullet = new Bullet();
    bullet.id = `bullet_${this.bulletIdCounter++}`;
    bullet.playerId = playerId;

    // Always spawn bullet at player's grid-centered position (center of current tile)
    // This keeps bullets spawning from the same point as you rotate
    const playerTileX = Math.floor(x);
    const playerTileY = Math.floor(y);

    // Spawn at the center of the player's tile
    bullet.x = playerTileX + 0.5;
    bullet.y = playerTileY + 0.5;

    // Reduced speed from 10 to 7 tiles/sec for better visibility
    const BULLET_SPEED = 7;
    bullet.velocityX = Math.cos(angle) * BULLET_SPEED;
    bullet.velocityY = Math.sin(angle) * BULLET_SPEED;

    this.state.bullets.set(bullet.id, bullet);
  }

  /**
   * Update all bullets
   */
  private updateBullets(deltaTime: number): void {
    const bulletsToRemove: string[] = [];

    this.state.bullets.forEach((bullet, bulletId) => {
      // Move bullet
      bullet.x += bullet.velocityX * deltaTime;
      bullet.y += bullet.velocityY * deltaTime;

      // Check if bullet is out of bounds or hit a wall
      const tileX = Math.floor(bullet.x);
      const tileY = Math.floor(bullet.y);

      if (
        tileX < 0 || tileX >= this.state.width ||
        tileY < 0 || tileY >= this.state.height ||
        this.dungeonData.grid[tileY][tileX] === TileType.WALL ||
        this.dungeonData.grid[tileY][tileX] === TileType.OBSTACLE
      ) {
        bulletsToRemove.push(bulletId);
      }
    });

    // Remove bullets
    bulletsToRemove.forEach(id => this.state.bullets.delete(id));
  }





  /**
   * Check all collisions
   */
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

        console.log(`💀 Bot ${event.botId} killed by ${event.playerId}. Level kills: ${this.state.currentLevelKills}/${this.state.killsNeededForNextLevel}`);

        // Broadcast kill activity
        this.broadcast('activity', {
          type: 'kill',
          text: `${player.name} killed a bot (${this.state.currentLevelKills}/${this.state.killsNeededForNextLevel})`
        });

        if (this.state.currentLevelKills >= this.state.killsNeededForNextLevel) {
          this.advanceToNextLevel(event.playerId);
        } else {
          // Spawn new bot
          if (this.state.bots.size < this.enemyBotManager.getBotsForLevel(this.state.currentLevel)) {
            this.enemyBotManager.spawnBots(1, this.state.players);
            
            // Broadcast bot spawn activity
            this.broadcast('activity', {
              type: 'spawn',
              text: '1 bot spawned'
            });
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
      const player = this.state.players.get(event.playerId);
      if (!player) return;

      if (event.livesRemaining > 0) {
        // Broadcast player hit activity
        this.broadcast('activity', {
          type: 'death',
          text: `${player.name} lost a life! (${event.livesRemaining} remaining)`
        });

        this.broadcast("playerHit", {
          playerId: event.playerId,
          livesRemaining: event.livesRemaining,
          invincibilitySeconds: 3
        });
      } else {
        // Broadcast game over activity
        this.broadcast('activity', {
          type: 'death',
          text: `${player.name} ran out of lives`
        });

        this.broadcast("gameOver", { playerId: event.playerId });
      }
    });
  }

  /**
   * Advance all players to the next level
   */
  private advanceToNextLevel(triggerPlayerSessionId: string): void {
    const nextLevel = this.state.currentLevel + 1;
    const player = this.state.players.get(triggerPlayerSessionId);

    if (nextLevel > this.state.totalLevels) {
      // Completed all levels!
      console.log(`🎉 Player ${triggerPlayerSessionId} completed all ${this.state.totalLevels} levels!`);
      
      // Broadcast game completion activity
      this.broadcast('activity', {
        type: 'level',
        text: `${player?.name || 'A player'} completed all ${this.state.totalLevels} levels!`
      });

      this.broadcast("gameCompleted", {
        triggerPlayer: triggerPlayerSessionId,
        totalKills: this.state.totalKills
      });

      // Restart from level 1
      this.state.currentLevel = 1;
      this.state.currentLevelKills = 0;
      this.state.killsNeededForNextLevel = this.getKillsForLevel(1);
      this.generateLevel(1);
    } else {
      // Advance to next level
      console.log(`🎯 Level ${this.state.currentLevel} complete! Advancing to Level ${nextLevel}...`);
      
      // Broadcast level advance activity
      this.broadcast('activity', {
        type: 'level',
        text: `Level ${nextLevel} started! ${player?.name || 'A player'} completed level ${this.state.currentLevel}!`
      });

      this.state.currentLevel = nextLevel;
      this.state.currentLevelKills = 0;
      this.state.killsNeededForNextLevel = this.getKillsForLevel(nextLevel);

      // Keep same dungeon but increase difficulty (or regenerate)
      // this.generateLevel(nextLevel);
    }

    // Clear all existing bots and spawn new ones with updated health for new level
    this.enemyBotManager.clearAllBots();
    this.enemyBotManager.spawnBots(
      this.enemyBotManager.getBotsForLevel(this.state.currentLevel),
      this.state.players
    );

    // Move all players to spawn point (ensure integer coordinates)
    this.state.players.forEach((player) => {
      player.x = Math.floor(this.dungeonData.spawnPoint.x);
      player.y = Math.floor(this.dungeonData.spawnPoint.y);
    });

    // Update metadata for lobby
    const hostPlayer = this.state.players.size > 0 ? Array.from(this.state.players.values())[0] : null;
    this.setMetadata({
      roomName: this.state.roomName || 'Unnamed Room',
      hostName: hostPlayer?.name || 'Unknown',
      currentLevel: this.state.currentLevel,
      totalLevels: this.state.totalLevels,
      currentLevelKills: this.state.currentLevelKills,
      killsNeededForNextLevel: this.state.killsNeededForNextLevel
    });

    // Broadcast level change to all clients
    this.broadcast("levelAdvanced", {
      newLevel: this.state.currentLevel,
      totalLevels: this.state.totalLevels,
      killsNeeded: this.state.killsNeededForNextLevel,
      triggerPlayer: triggerPlayerSessionId
    });
  }

  /**
   * Generate a specific level (legacy - now uses map depth 0 for initial generation)
   */
  private generateLevel(level: number): void {
    const seed = this.levelSeeds[level - 1];
    const generator = new DungeonGenerator(120, 120, seed);
    // Use mapDepth 0 for initial map generation
    this.dungeonData = generator.generate(0);

    // Set dungeon state (seed-based - clients will regenerate from seed)
    this.state.seed = generator.seed;
    this.state.width = this.dungeonData.width;
    this.state.height = this.dungeonData.height;
    this.state.exitX = this.dungeonData.exitPoint.x;
    this.state.exitY = this.dungeonData.exitPoint.y;
    
    // Set initial portal positions from dungeon data
    this.state.currentMapDepth = 0;
    this.state.entryPortalX = this.dungeonData.entryPortalPoint?.x ?? -1;
    this.state.entryPortalY = this.dungeonData.entryPortalPoint?.y ?? -1;
    this.state.exitPortalX = this.dungeonData.exitPortalPoint.x;
    this.state.exitPortalY = this.dungeonData.exitPortalPoint.y;

    // Clear and reinitialize active transports
    this.state.activeTransports.clear();
    this.dungeonData.transportPoints.forEach((tp: { x: number; y: number }) => {
      const transport = new Transport();
      transport.x = tp.x;
      transport.y = tp.y;
      this.state.activeTransports.push(transport);
    });

    console.log(`\n🎮 LEVEL ${level} GENERATED`);
    console.log(`   Rooms: ${this.dungeonData.rooms.length}`);
    console.log(`   Seed: ${this.state.seed}`);
    console.log(`   Map Depth: 0`);
    console.log(`   Spawn: (${this.dungeonData.spawnPoint.x}, ${this.dungeonData.spawnPoint.y})`);
    console.log(`   Exit Portal: (${this.state.exitPortalX}, ${this.state.exitPortalY})`);
    console.log(`   Transports: ${this.state.activeTransports.length} portals\n`);
  }

  /**
   * Handle player stepping on a transport portal
   */
  private handleTransport(player: Player, sessionId: string, client: Client): void {
    // Check if player is on an active transport (use floored comparison for robustness)
    const transportIndex = this.state.activeTransports.findIndex(
      t => Math.floor(t.x) === Math.floor(player.x) && Math.floor(t.y) === Math.floor(player.y)
    );

    if (transportIndex !== -1) {
      const transport = this.state.activeTransports[transportIndex];
      console.log(`Player ${sessionId} used transport at (${transport.x}, ${transport.y})`);

      // Teleport player to a random walkable location
      const newLocation = this.findRandomWalkableLocation();
      if (newLocation) {
        // Enforce integer coordinates (belt-and-suspenders approach)
        player.x = Math.floor(newLocation.x);
        player.y = Math.floor(newLocation.y);
        console.log(`🌀 Teleported player ${sessionId} from (${transport.x}, ${transport.y}) → (${player.x}, ${player.y})`);

        // Send teleport notification to the specific player
        this.send(client, "teleported", {
          fromX: transport.x,
          fromY: transport.y,
          toX: player.x,
          toY: player.y
        });
      }

      // Mark the old transport location as inactive (blue tile)
      this.dungeonData.grid[transport.y][transport.x] = TileType.TRANSPORT_INACTIVE;

      // Broadcast to all clients that this transport was used
      this.broadcast("transportUsed", { x: transport.x, y: transport.y });

      // Remove this transport from active list
      this.state.activeTransports.splice(transportIndex, 1);

      // Spawn a new transport elsewhere
      const newTransport = this.spawnNewTransport();
      if (newTransport) {
        this.state.activeTransports.push(newTransport);
        console.log(`  → New transport spawned at (${newTransport.x}, ${newTransport.y})`);
      }
    }
  }

  /**
   * Find a random walkable location on the map
   */
  private findRandomWalkableLocation(): { x: number; y: number } | null {
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const tileX = Math.floor(Math.random() * this.state.width);
      const tileY = Math.floor(Math.random() * this.state.height);

      const tile = this.dungeonData.grid[tileY][tileX];
      if (tile === TileType.FLOOR || tile === TileType.SPAWN) {
        // Return integer tile coordinates (client will handle visual centering)
        return { x: tileX, y: tileY };
      }

      attempts++;
    }

    return null;
  }



  /**
   * Spawn a new transport at a random floor location
   */
  private spawnNewTransport(): Transport | null {
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const x = Math.floor(Math.random() * this.state.width);
      const y = Math.floor(Math.random() * this.state.height);

      // Must be on floor, not near spawn/exit, and not on existing transport
      const tile = this.dungeonData.grid[y][x];
      const isFloor = tile === TileType.FLOOR;
      const notNearSpawn = Math.abs(x - this.dungeonData.spawnPoint.x) > 3 ||
                           Math.abs(y - this.dungeonData.spawnPoint.y) > 3;
      const notNearExit = Math.abs(x - this.state.exitX) > 3 ||
                          Math.abs(y - this.state.exitY) > 3;
      const notOnExistingTransport = !this.state.activeTransports.some(t => t.x === x && t.y === y);

      if (isFloor && notNearSpawn && notNearExit && notOnExistingTransport) {
        const transport = new Transport();
        transport.x = x;
        transport.y = y;
        return transport;
      }

      attempts++;
    }

    return null;
  }

  private isValidMove(x: number, y: number): boolean {
    if (x < 0 || x >= this.state.width || y < 0 || y >= this.state.height) {
      return false;
    }

    // Round coordinates to grid indices (handles float coordinates from teleports)
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);

    // Check against server-side dungeon data
    const tile = this.dungeonData.grid[gridY][gridX];

    // Can walk on floor, spawn, exit, inactive transports, and portal tiles - but NOT obstacles or walls
    return tile === TileType.FLOOR || 
           tile === TileType.SPAWN || 
           tile === TileType.EXIT || 
           tile === TileType.TRANSPORT_INACTIVE ||
           tile === TileType.ENTRY_PORTAL ||
           tile === TileType.EXIT_PORTAL ||
           tile === TileType.HOME_MARKER;
  }



  /**
   * Measure and log the size of the current state
   */
  private measureStateSize() {
    try {
      // Serialize state to JSON to estimate size
      const stateJSON = JSON.stringify({
        seed: this.state.seed,
        width: this.state.width,
        height: this.state.height,
        exitX: this.state.exitX,
        exitY: this.state.exitY,
        currentLevel: this.state.currentLevel,
        totalLevels: this.state.totalLevels,
        players: Array.from(this.state.players.entries()).map(([id, p]) => ({
          id,
          x: p.x,
          y: p.y,
          sessionId: p.sessionId
        }))
      });

      const sizeInBytes = new TextEncoder().encode(stateJSON).length;
      const sizeInKB = (sizeInBytes / 1024).toFixed(2);

      console.log(`\n📊 STATE SIZE MEASUREMENT:`);
      console.log(`   Players: ${this.state.players.size}`);
      console.log(`   Estimated state: ${sizeInBytes} bytes (${sizeInKB} KB)`);
      console.log(`   Memory usage: ${this.getMemoryUsage()}\n`);
    } catch (error) {
      console.error("Error measuring state size:", error);
    }
  }

  /**
   * Get current Node.js process memory usage
   */
  private getMemoryUsage(): string {
    const usage = process.memoryUsage();
    return `RSS: ${(usage.rss / 1024 / 1024).toFixed(2)} MB, ` +
           `Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`;
  }

  /**
   * Get kills needed for a specific level
   */
  private getKillsForLevel(level: number): number {
    if (level === 1) return 10;
    if (level === 2) return 15;
    // Levels 3-5: increment by 5 (20, 25, 30)
    return 15 + (level - 2) * 5;
  }

  // ==========================================
  // MULTI-MAP MANAGEMENT METHODS
  // ==========================================

  /**
   * Generate a unique map key from depth and seed
   */
  private getMapKey(depth: number, seed: number): string {
    return `${depth}_${seed}`;
  }

  /**
   * Get or create an active map instance
   * If the map exists, return it. Otherwise, generate and initialize it.
   */
  private getOrCreateMap(depth: number, seed: number, cachedState?: CachedMapState): ActiveMap {
    const mapKey = this.getMapKey(depth, seed);
    
    // Return existing map if active
    const existingMap = this.activeMaps.get(mapKey);
    if (existingMap) {
      existingMap.lastActivity = Date.now();
      return existingMap;
    }

    // Generate new dungeon data for this depth/seed
    const generator = new DungeonGenerator(120, 120, seed);
    const dungeonData = generator.generate(depth);

    // Create bot manager and collision manager for this map
    const botManager = new EnemyBotManager(this.state, dungeonData);
    const collisionManager = new CollisionManager(this.state, dungeonData);

    // Create new active map
    const activeMap: ActiveMap = {
      seed,
      depth,
      dungeonData,
      bots: new MapSchema<Bot>(),
      botManager,
      collisionManager,
      players: new Set(),
      lastActivity: Date.now()
    };

    // If we have cached state, restore bots from cache
    if (cachedState) {
      this.restoreBotsFromCache(activeMap, cachedState);
    } else {
      // New map - spawn fresh bots based on difficulty
      const difficulty = getDifficultyForDepth(depth);
      // Bots will be spawned when player enters and game starts
      console.log(`🗺️ Created new map at depth ${depth} with seed ${seed}`);
      console.log(`   Difficulty: ${difficulty.botCount} bots, ${difficulty.botHealth} HP, ${difficulty.botSpeed}ms speed`);
    }

    this.activeMaps.set(mapKey, activeMap);
    return activeMap;
  }

  /**
   * Restore bots from cached state (when player returns to a previously visited map)
   */
  private restoreBotsFromCache(activeMap: ActiveMap, cachedState: CachedMapState): void {
    console.log(`♻️ Restoring ${cachedState.bots.length} bots from cache for depth ${cachedState.depth}`);
    
    cachedState.bots.forEach(botData => {
      const bot = new Bot();
      bot.id = botData.id;
      bot.x = botData.x;
      bot.y = botData.y;
      bot.health = botData.health;
      bot.maxHealth = botData.maxHealth;
      bot.targetX = botData.targetX;
      bot.targetY = botData.targetY;
      bot.moveStartTime = Date.now();
      activeMap.bots.set(bot.id, bot);
    });
  }

  /**
   * Cache the current map state for a player (called when player leaves a map)
   */
  private cacheMapStateForPlayer(sessionId: string, activeMap: ActiveMap, playerX: number, playerY: number): void {
    const playerState = this.playerMapStates.get(sessionId);
    if (!playerState) return;

    // Create cached state
    const cachedState: CachedMapState = {
      seed: activeMap.seed,
      depth: activeMap.depth,
      bots: [],
      usedTransports: [],
      playerLastPosition: { x: playerX, y: playerY },
      exitPortalPoint: activeMap.dungeonData.exitPortalPoint,
      entryPortalPoint: activeMap.dungeonData.entryPortalPoint
    };

    // Cache bot states
    activeMap.bots.forEach((bot, botId) => {
      cachedState.bots.push({
        id: botId,
        x: bot.x,
        y: bot.y,
        health: bot.health,
        maxHealth: bot.maxHealth,
        targetX: bot.targetX,
        targetY: bot.targetY
      });
    });

    // Store in player's cache (with limit)
    playerState.mapCache.set(activeMap.depth, cachedState);
    playerState.seedHistory.set(activeMap.depth, activeMap.seed);

    // Enforce cache limit - remove oldest entries beyond limit
    if (playerState.mapCache.size > MAP_CACHE_LIMIT) {
      const depths = Array.from(playerState.mapCache.keys()).sort((a, b) => a - b);
      const depthsToRemove = depths.slice(0, depths.length - MAP_CACHE_LIMIT);
      depthsToRemove.forEach(d => playerState.mapCache.delete(d));
    }

    console.log(`💾 Cached map state for player ${sessionId} at depth ${activeMap.depth} (${cachedState.bots.length} bots)`);
  }

  /**
   * Initialize player map state when they join
   */
  private initializePlayerMapState(sessionId: string, initialSeed: number): PlayerMapState {
    const playerState: PlayerMapState = {
      sessionId,
      currentDepth: 0,
      mapCache: new Map(),
      seedHistory: new Map([[0, initialSeed]]) // Depth 0 uses initial seed
    };
    this.playerMapStates.set(sessionId, playerState);
    return playerState;
  }

  /**
   * Handle player stepping on EXIT portal (green) - go to NEXT map (deeper)
   */
  private handleExitPortal(player: Player, sessionId: string, client: Client): void {
    const playerState = this.playerMapStates.get(sessionId);
    if (!playerState) return;

    const currentDepth = playerState.currentDepth;
    const nextDepth = currentDepth + 1;
    
    // Get current map and cache its state
    const currentSeed = playerState.seedHistory.get(currentDepth);
    if (currentSeed !== undefined) {
      const currentMapKey = this.getMapKey(currentDepth, currentSeed);
      const currentMap = this.activeMaps.get(currentMapKey);
      if (currentMap) {
        this.cacheMapStateForPlayer(sessionId, currentMap, player.x, player.y);
        currentMap.players.delete(sessionId);
      }
    }

    // Generate or retrieve seed for next depth
    let nextSeed = playerState.seedHistory.get(nextDepth);
    if (nextSeed === undefined) {
      // Generate new seed for unexplored depth
      nextSeed = generateNextSeed(currentSeed || Date.now());
      playerState.seedHistory.set(nextDepth, nextSeed);
    }

    // Check if we have cached state for the next map
    const cachedState = playerState.mapCache.get(nextDepth);

    // Get or create the next map
    const nextMap = this.getOrCreateMap(nextDepth, nextSeed, cachedState);
    nextMap.players.add(sessionId);

    // Update player state
    playerState.currentDepth = nextDepth;
    player.currentMapDepth = nextDepth;
    player.currentMapSeed = nextSeed;

    // Position player at the entry portal of the new map (or spawn if first visit)
    if (cachedState && cachedState.entryPortalPoint) {
      player.x = cachedState.entryPortalPoint.x;
      player.y = cachedState.entryPortalPoint.y;
    } else if (nextMap.dungeonData.entryPortalPoint) {
      player.x = nextMap.dungeonData.entryPortalPoint.x;
      player.y = nextMap.dungeonData.entryPortalPoint.y;
    } else {
      player.x = nextMap.dungeonData.spawnPoint.x;
      player.y = nextMap.dungeonData.spawnPoint.y;
    }

    // Update shared state for this player's view
    this.state.currentMapDepth = nextDepth;
    this.state.entryPortalX = nextMap.dungeonData.entryPortalPoint?.x ?? -1;
    this.state.entryPortalY = nextMap.dungeonData.entryPortalPoint?.y ?? -1;
    this.state.exitPortalX = nextMap.dungeonData.exitPortalPoint.x;
    this.state.exitPortalY = nextMap.dungeonData.exitPortalPoint.y;

    // Notify client of map change
    this.send(client, "mapChanged", {
      newDepth: nextDepth,
      newSeed: nextSeed,
      spawnX: player.x,
      spawnY: player.y,
      entryPortalX: this.state.entryPortalX,
      entryPortalY: this.state.entryPortalY,
      exitPortalX: this.state.exitPortalX,
      exitPortalY: this.state.exitPortalY
    });

    console.log(`🟢 Player ${sessionId} used EXIT portal: depth ${currentDepth} → ${nextDepth}`);

    // Spawn bots for new map if needed and game is running
    if (this.state.gameStarted && nextMap.bots.size === 0) {
      const difficulty = getDifficultyForDepth(nextDepth);
      nextMap.botManager.spawnBots(difficulty.botCount, this.state.players);
      console.log(`🤖 Spawned ${difficulty.botCount} bots for depth ${nextDepth}`);
    }

    // Broadcast activity
    this.broadcast('activity', {
      type: 'portal',
      text: `${player.name} entered map depth ${nextDepth}`
    });

    // Cleanup empty maps
    this.cleanupEmptyMaps();
  }

  /**
   * Handle player stepping on ENTRY portal (purple) - go to PREVIOUS map (shallower)
   */
  private handleEntryPortal(player: Player, sessionId: string, client: Client): void {
    const playerState = this.playerMapStates.get(sessionId);
    if (!playerState) return;

    const currentDepth = playerState.currentDepth;
    
    // Can't go back from depth 0 (home)
    if (currentDepth <= 0) {
      console.log(`⚠️ Player ${sessionId} tried to use entry portal at depth 0 (home)`);
      return;
    }

    const previousDepth = currentDepth - 1;
    
    // Get current map and cache its state
    const currentSeed = playerState.seedHistory.get(currentDepth);
    if (currentSeed !== undefined) {
      const currentMapKey = this.getMapKey(currentDepth, currentSeed);
      const currentMap = this.activeMaps.get(currentMapKey);
      if (currentMap) {
        this.cacheMapStateForPlayer(sessionId, currentMap, player.x, player.y);
        currentMap.players.delete(sessionId);
      }
    }

    // Get seed for previous depth (should always exist since we came from there)
    const previousSeed = playerState.seedHistory.get(previousDepth);
    if (previousSeed === undefined) {
      console.error(`❌ No seed found for previous depth ${previousDepth}`);
      return;
    }

    // Check if we have cached state for the previous map
    const cachedState = playerState.mapCache.get(previousDepth);

    // Get or create the previous map
    const previousMap = this.getOrCreateMap(previousDepth, previousSeed, cachedState);
    previousMap.players.add(sessionId);

    // Update player state
    playerState.currentDepth = previousDepth;
    player.currentMapDepth = previousDepth;
    player.currentMapSeed = previousSeed;

    // Position player at the exit portal of the previous map (where they left to go deeper)
    if (cachedState && cachedState.exitPortalPoint) {
      player.x = cachedState.exitPortalPoint.x;
      player.y = cachedState.exitPortalPoint.y;
    } else if (previousMap.dungeonData.exitPortalPoint) {
      player.x = previousMap.dungeonData.exitPortalPoint.x;
      player.y = previousMap.dungeonData.exitPortalPoint.y;
    } else {
      player.x = previousMap.dungeonData.spawnPoint.x;
      player.y = previousMap.dungeonData.spawnPoint.y;
    }

    // Update shared state for this player's view
    this.state.currentMapDepth = previousDepth;
    this.state.entryPortalX = previousMap.dungeonData.entryPortalPoint?.x ?? -1;
    this.state.entryPortalY = previousMap.dungeonData.entryPortalPoint?.y ?? -1;
    this.state.exitPortalX = previousMap.dungeonData.exitPortalPoint.x;
    this.state.exitPortalY = previousMap.dungeonData.exitPortalPoint.y;

    // Notify client of map change
    this.send(client, "mapChanged", {
      newDepth: previousDepth,
      newSeed: previousSeed,
      spawnX: player.x,
      spawnY: player.y,
      entryPortalX: this.state.entryPortalX,
      entryPortalY: this.state.entryPortalY,
      exitPortalX: this.state.exitPortalX,
      exitPortalY: this.state.exitPortalY
    });

    console.log(`🟣 Player ${sessionId} used ENTRY portal: depth ${currentDepth} → ${previousDepth}`);

    // Spawn bots for previous map if needed and game is running
    if (this.state.gameStarted && previousMap.bots.size === 0) {
      const difficulty = getDifficultyForDepth(previousDepth);
      previousMap.botManager.spawnBots(difficulty.botCount, this.state.players);
      console.log(`🤖 Spawned ${difficulty.botCount} bots for depth ${previousDepth}`);
    }

    // Broadcast activity
    this.broadcast('activity', {
      type: 'portal',
      text: `${player.name} returned to map depth ${previousDepth}`
    });

    // Cleanup empty maps
    this.cleanupEmptyMaps();
  }

  /**
   * Check if player stepped on a portal tile and handle it
   */
  private checkPortalCollision(player: Player, sessionId: string, client: Client): void {
    const gridX = Math.floor(player.x);
    const gridY = Math.floor(player.y);
    
    // Get player's current map
    const playerState = this.playerMapStates.get(sessionId);
    if (!playerState) return;
    
    const currentSeed = playerState.seedHistory.get(playerState.currentDepth);
    if (currentSeed === undefined) return;
    
    const mapKey = this.getMapKey(playerState.currentDepth, currentSeed);
    const activeMap = this.activeMaps.get(mapKey);
    if (!activeMap) return;
    
    const tile = activeMap.dungeonData.grid[gridY]?.[gridX];
    
    if (tile === TileType.EXIT_PORTAL) {
      this.handleExitPortal(player, sessionId, client);
    } else if (tile === TileType.ENTRY_PORTAL) {
      this.handleEntryPortal(player, sessionId, client);
    }
  }

  /**
   * Cleanup maps with no active players (memory management)
   */
  private cleanupEmptyMaps(): void {
    const now = Date.now();
    const CLEANUP_THRESHOLD = 60000; // 1 minute with no players

    const mapsToRemove: string[] = [];
    
    this.activeMaps.forEach((map, key) => {
      if (map.players.size === 0 && (now - map.lastActivity) > CLEANUP_THRESHOLD) {
        mapsToRemove.push(key);
      }
    });

    mapsToRemove.forEach(key => {
      const map = this.activeMaps.get(key);
      if (map) {
        map.bots.clear();
        map.botManager.clearAllBots();
        console.log(`🧹 Cleaned up empty map: ${key}`);
      }
      this.activeMaps.delete(key);
    });

    if (mapsToRemove.length > 0) {
      console.log(`🧹 Cleaned up ${mapsToRemove.length} empty maps. Active maps: ${this.activeMaps.size}`);
    }
  }

}
