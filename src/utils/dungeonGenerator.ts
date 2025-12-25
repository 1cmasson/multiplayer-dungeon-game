/**
 * Seeded Random Number Generator
 * Uses Linear Congruential Generator algorithm for deterministic randomness
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }

  /**
   * Returns a pseudo-random number between 0 and 1
   */
  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /**
   * Returns a pseudo-random integer between min (inclusive) and max (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum TileType {
  WALL = 0,
  FLOOR = 1,
  EXIT = 2,           // Legacy - keeping for backwards compatibility
  SPAWN = 3,
  OBSTACLE = 4,
  TRANSPORT_INACTIVE = 5, // Blue tile after transport is used
  ENTRY_PORTAL = 6,   // Purple portal - return to previous map
  EXIT_PORTAL = 7,    // Green portal - go to next map
  HOME_MARKER = 8,    // Gold marker - starting map (depth 0), can't go back
}

/**
 * Difficulty scaling configuration for multi-map progression
 * Each map depth increases difficulty
 */
export const DIFFICULTY_CONFIG = {
  // Base values at map depth 0
  baseBotsCount: 5,
  baseBotHealth: 100,
  baseBotSpeed: 333,           // ms between moves (lower = faster)
  baseObstaclePercent: 5,      // percentage of floor tiles
  
  // Per-map-depth scaling
  botsPerDepth: 2,             // +2 bots per map depth
  healthPerDepth: 25,          // +25 HP per map depth  
  speedReductionPerDepth: 15,  // -15ms per depth (faster movement)
  obstaclePercentPerDepth: 1,  // +1% obstacles per depth
  
  // Caps to prevent impossibility (or remove for true insanity)
  maxBots: 30,
  maxHealth: 300,
  minSpeed: 150,               // Can't go below 150ms
  maxObstaclePercent: 15,
};

/**
 * Calculate difficulty parameters for a given map depth
 */
export function getDifficultyForDepth(mapDepth: number) {
  return {
    botCount: Math.min(
      DIFFICULTY_CONFIG.baseBotsCount + (mapDepth * DIFFICULTY_CONFIG.botsPerDepth),
      DIFFICULTY_CONFIG.maxBots
    ),
    botHealth: Math.min(
      DIFFICULTY_CONFIG.baseBotHealth + (mapDepth * DIFFICULTY_CONFIG.healthPerDepth),
      DIFFICULTY_CONFIG.maxHealth
    ),
    botSpeed: Math.max(
      DIFFICULTY_CONFIG.baseBotSpeed - (mapDepth * DIFFICULTY_CONFIG.speedReductionPerDepth),
      DIFFICULTY_CONFIG.minSpeed
    ),
    obstaclePercent: Math.min(
      DIFFICULTY_CONFIG.baseObstaclePercent + (mapDepth * DIFFICULTY_CONFIG.obstaclePercentPerDepth),
      DIFFICULTY_CONFIG.maxObstaclePercent
    ) / 100, // Convert to decimal
  };
}

export interface SpawnZone {
  x: number;
  y: number;
  radius: number;
  direction: 'north' | 'south' | 'east' | 'west'; // Relative to spawn point
}

export interface DungeonData {
  grid: number[][];
  rooms: Room[];
  width: number;
  height: number;
  spawnPoint: { x: number; y: number };
  exitPoint: { x: number; y: number };           // Legacy exit point
  transportPoints: Array<{ x: number; y: number }>; // Active transport locations
  spawnZones: SpawnZone[]; // Bot spawn zones distributed around the map
  // Multi-map portal system
  entryPortalPoint: { x: number; y: number } | null;  // Where player entered (null on first map)
  exitPortalPoint: { x: number; y: number };          // Portal to next map
  mapDepth: number;                                    // Current map depth (0 = starting map)
}

export class DungeonGenerator {
  private width: number;
  private height: number;
  private grid: number[][];
  private rooms: Room[] = [];
  private rng: SeededRandom;
  public readonly seed: number;

  constructor(width: number = 120, height: number = 120, seed?: number) {
    this.width = width;
    this.height = height;
    this.seed = seed ?? Date.now();
    this.rng = new SeededRandom(this.seed);
    this.grid = this.createEmptyGrid();
  }

  private createEmptyGrid(): number[][] {
    return Array(this.height)
      .fill(0)
      .map(() => Array(this.width).fill(TileType.WALL));
  }

  private randomInt(min: number, max: number): number {
    return this.rng.nextInt(min, max);
  }

  private doesRoomOverlap(newRoom: Room): boolean {
    for (const room of this.rooms) {
      // Add 1 tile padding between rooms
      if (
        newRoom.x < room.x + room.width + 1 &&
        newRoom.x + newRoom.width + 1 > room.x &&
        newRoom.y < room.y + room.height + 1 &&
        newRoom.y + newRoom.height + 1 > room.y
      ) {
        return true;
      }
    }
    return false;
  }

  private createRoom(x: number, y: number, width: number, height: number): void {
    for (let i = y; i < y + height; i++) {
      for (let j = x; j < x + width; j++) {
        if (i >= 0 && i < this.height && j >= 0 && j < this.width) {
          this.grid[i][j] = TileType.FLOOR;
        }
      }
    }
  }

  private createHorizontalCorridor(x1: number, x2: number, y: number): void {
    const startX = Math.min(x1, x2);
    const endX = Math.max(x1, x2);

    // Make corridor 4 tiles wide for better multiplayer navigation
    for (let x = startX; x <= endX; x++) {
      for (let offset = 0; offset < 4; offset++) {
        const corridorY = y + offset;
        if (corridorY >= 0 && corridorY < this.height && x >= 0 && x < this.width) {
          this.grid[corridorY][x] = TileType.FLOOR;
        }
      }
    }
  }

  private createVerticalCorridor(y1: number, y2: number, x: number): void {
    const startY = Math.min(y1, y2);
    const endY = Math.max(y1, y2);

    // Make corridor 4 tiles wide for better multiplayer navigation
    for (let y = startY; y <= endY; y++) {
      for (let offset = 0; offset < 4; offset++) {
        const corridorX = x + offset;
        if (y >= 0 && y < this.height && corridorX >= 0 && corridorX < this.width) {
          this.grid[y][corridorX] = TileType.FLOOR;
        }
      }
    }
  }

  private connectRooms(room1: Room, room2: Room): void {
    // Get center points of each room
    const center1X = Math.floor(room1.x + room1.width / 2);
    const center1Y = Math.floor(room1.y + room1.height / 2);
    const center2X = Math.floor(room2.x + room2.width / 2);
    const center2Y = Math.floor(room2.y + room2.height / 2);

    // Create L-shaped corridor
    if (this.rng.next() < 0.5) {
      this.createHorizontalCorridor(center1X, center2X, center1Y);
      this.createVerticalCorridor(center1Y, center2Y, center2X);
    } else {
      this.createVerticalCorridor(center1Y, center2Y, center1X);
      this.createHorizontalCorridor(center1X, center2X, center2Y);
    }
  }

  private placeObstacles(spawnX: number, spawnY: number, exitX: number, exitY: number, difficulty: number): void {
    // Calculate number of obstacles based on difficulty
    // More obstacles = harder to navigate
    const totalFloorTiles = this.grid.flat().filter(tile => tile === TileType.FLOOR).length;
    const obstaclePercentage = Math.min(0.05 + (difficulty * 0.02), 0.15); // 5-15% of floor tiles
    const numObstacles = Math.floor(totalFloorTiles * obstaclePercentage);

    // Track obstacle positions for spacing checks
    const obstaclePositions: Array<{ x: number; y: number }> = [];
    const MIN_OBSTACLE_SPACING = 4; // Minimum tiles between obstacles

    let obstaclesPlaced = 0;
    let attempts = 0;
    const maxAttempts = numObstacles * 10;

    while (obstaclesPlaced < numObstacles && attempts < maxAttempts) {
      const x = this.randomInt(0, this.width - 1);
      const y = this.randomInt(0, this.height - 1);

      // Only place on floor tiles, not on spawn or exit
      if (
        this.grid[y][x] === TileType.FLOOR &&
        !(x === spawnX && y === spawnY) &&
        !(x === exitX && y === exitY)
      ) {
        // Don't place obstacles directly adjacent to spawn or exit
        const isNearSpawn = this.getManhattanDistance(x, y, spawnX, spawnY) <= 3;
        const isNearExit = this.getManhattanDistance(x, y, exitX, exitY) <= 3;

        // Check spacing from other obstacles
        const tooCloseToOtherObstacle = obstaclePositions.some(obs =>
          this.getManhattanDistance(x, y, obs.x, obs.y) < MIN_OBSTACLE_SPACING
        );

        if (!isNearSpawn && !isNearExit && !tooCloseToOtherObstacle) {
          // Place the obstacle
          this.grid[y][x] = TileType.OBSTACLE;
          obstaclePositions.push({ x, y });
          obstaclesPlaced++;
        }
      }

      attempts++;
    }
  }

  /**
   * Calculate Manhattan distance between two points
   */
  private getManhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Place transport portals on the map (invisible, on floor tiles)
   */
  private placeTransports(spawnX: number, spawnY: number, exitX: number, exitY: number): Array<{ x: number; y: number }> {
    const transports: Array<{ x: number; y: number }> = [];
    const NUM_TRANSPORTS = 5; // More transports for larger map
    let attempts = 0;
    const maxAttempts = 100;

    while (transports.length < NUM_TRANSPORTS && attempts < maxAttempts) {
      const x = this.randomInt(0, this.width - 1);
      const y = this.randomInt(0, this.height - 1);

      // Only place on floor tiles
      if (this.grid[y][x] === TileType.FLOOR) {
        // Don't place near spawn or exit
        const isNearSpawn = this.getManhattanDistance(x, y, spawnX, spawnY) <= 3;
        const isNearExit = this.getManhattanDistance(x, y, exitX, exitY) <= 3;

        // Don't place too close to other transports
        const tooCloseToOtherTransport = transports.some(t =>
          this.getManhattanDistance(x, y, t.x, t.y) <= 5
        );

        if (!isNearSpawn && !isNearExit && !tooCloseToOtherTransport) {
          transports.push({ x, y });
        }
      }

      attempts++;
    }

    return transports;
  }

  /**
   * Create spawn zones distributed in 4 cardinal directions from spawn point
   * This prevents camping by spawning bots from different angles
   */
  private createSpawnZones(spawnX: number, spawnY: number): SpawnZone[] {
    const zones: SpawnZone[] = [];
    const MIN_DISTANCE = 20; // Farther for larger 120x120 map
    const ZONE_RADIUS = 10; // Larger zones for more spawn options
    
    // Try to place zones in each cardinal direction
    const directions: Array<{ dx: number; dy: number; dir: SpawnZone['direction'] }> = [
      { dx: 0, dy: -1, dir: 'north' },
      { dx: 0, dy: 1, dir: 'south' },
      { dx: -1, dy: 0, dir: 'west' },
      { dx: 1, dy: 0, dir: 'east' },
    ];

    for (const { dx, dy, dir } of directions) {
      let bestZone: { x: number; y: number } | null = null;
      let bestWalkableCount = 0;

      // Try to find a good zone location in this direction
      for (let distance = MIN_DISTANCE; distance < MIN_DISTANCE + 20; distance += 2) {
        const centerX = Math.floor(spawnX + dx * distance);
        const centerY = Math.floor(spawnY + dy * distance);

        // Check if center is in bounds
        if (centerX < 0 || centerX >= this.width || centerY < 0 || centerY >= this.height) {
          continue;
        }

        // Count walkable tiles around this point
        let walkableCount = 0;
        for (let ry = -ZONE_RADIUS; ry <= ZONE_RADIUS; ry++) {
          for (let rx = -ZONE_RADIUS; rx <= ZONE_RADIUS; rx++) {
            const x = centerX + rx;
            const y = centerY + ry;
            
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
              if (this.grid[y][x] === TileType.FLOOR || this.grid[y][x] === TileType.SPAWN) {
                walkableCount++;
              }
            }
          }
        }

        // Keep the location with most walkable tiles
        if (walkableCount > bestWalkableCount) {
          bestWalkableCount = walkableCount;
          bestZone = { x: centerX, y: centerY };
        }
      }

      // Add the zone if we found a decent location
      if (bestZone && bestWalkableCount > 10) {
        zones.push({
          x: bestZone.x,
          y: bestZone.y,
          radius: ZONE_RADIUS,
          direction: dir,
        });
      }
    }

    return zones;
  }

  public generate(mapDepth: number = 0): DungeonData {
    this.grid = this.createEmptyGrid();
    this.rooms = [];

    // Get difficulty parameters based on map depth
    const difficultyParams = getDifficultyForDepth(mapDepth);

    // Number of rooms based on map depth (8-15 rooms for larger map)
    const numRooms = Math.min(8 + mapDepth, 15);
    const minRoomSize = 6;  // Larger rooms for 8 players
    const maxRoomSize = 12;

    // Try to place rooms
    let attempts = 0;
    const maxAttempts = 100;

    while (this.rooms.length < numRooms && attempts < maxAttempts) {
      const width = this.randomInt(minRoomSize, maxRoomSize);
      const height = this.randomInt(minRoomSize, maxRoomSize);
      const x = this.randomInt(1, this.width - width - 1);
      const y = this.randomInt(1, this.height - height - 1);

      const newRoom: Room = { x, y, width, height };

      if (!this.doesRoomOverlap(newRoom)) {
        this.createRoom(x, y, width, height);
        this.rooms.push(newRoom);

        // Connect to previous room
        if (this.rooms.length > 1) {
          this.connectRooms(this.rooms[this.rooms.length - 2], newRoom);
        }
      }

      attempts++;
    }

    // Place spawn in first room (center)
    const firstRoom = this.rooms[0];
    const spawnX = Math.floor(firstRoom.x + firstRoom.width / 2);
    const spawnY = Math.floor(firstRoom.y + firstRoom.height / 2);
    
    // Entry portal or home marker at spawn point based on map depth
    if (mapDepth === 0) {
      // First map - place HOME_MARKER (gold) - can't go back
      this.grid[spawnY][spawnX] = TileType.HOME_MARKER;
    } else {
      // Subsequent maps - place ENTRY_PORTAL (purple) - return to previous map
      this.grid[spawnY][spawnX] = TileType.ENTRY_PORTAL;
    }

    // Find a suitable exit portal point that's far from spawn
    // Minimum distance should be at least 60 tiles for a good journey on 120x120 map
    const MIN_DISTANCE = 60;
    let exitRoomIndex = this.rooms.length - 1;
    let exitPortalX = 0;
    let exitPortalY = 0;

    // Start from the last room and work backwards if needed
    while (exitRoomIndex >= 0) {
      const exitRoom = this.rooms[exitRoomIndex];
      const tempExitX = Math.floor(exitRoom.x + exitRoom.width / 2);
      const tempExitY = Math.floor(exitRoom.y + exitRoom.height / 2);

      const distance = this.getManhattanDistance(spawnX, spawnY, tempExitX, tempExitY);

      if (distance >= MIN_DISTANCE) {
        // Found a good exit location
        exitPortalX = tempExitX;
        exitPortalY = tempExitY;
        break;
      }

      exitRoomIndex--;
    }

    // If no room is far enough, use the farthest room available
    if (exitRoomIndex < 0) {
      exitRoomIndex = this.rooms.length - 1;
      const exitRoom = this.rooms[exitRoomIndex];
      exitPortalX = Math.floor(exitRoom.x + exitRoom.width / 2);
      exitPortalY = Math.floor(exitRoom.y + exitRoom.height / 2);
    }

    // Place EXIT_PORTAL (green) - leads to next map
    this.grid[exitPortalY][exitPortalX] = TileType.EXIT_PORTAL;

    // Place obstacles throughout the dungeon (using depth-scaled percentage)
    this.placeObstaclesWithPercent(spawnX, spawnY, exitPortalX, exitPortalY, difficultyParams.obstaclePercent);

    // Place transport portals (invisible teleport spots within the map)
    const transportPoints = this.placeTransports(spawnX, spawnY, exitPortalX, exitPortalY);

    // Create spawn zones for bot spawning
    const spawnZones = this.createSpawnZones(spawnX, spawnY);

    return {
      grid: this.grid,
      rooms: this.rooms,
      width: this.width,
      height: this.height,
      spawnPoint: { x: spawnX, y: spawnY },
      exitPoint: { x: exitPortalX, y: exitPortalY },  // Legacy compatibility
      transportPoints: transportPoints,
      spawnZones: spawnZones,
      // Multi-map portal system
      entryPortalPoint: mapDepth === 0 ? null : { x: spawnX, y: spawnY },
      exitPortalPoint: { x: exitPortalX, y: exitPortalY },
      mapDepth: mapDepth,
    };
  }

  /**
   * Place obstacles with a specific percentage (used by depth-based difficulty)
   */
  private placeObstaclesWithPercent(
    spawnX: number, 
    spawnY: number, 
    exitX: number, 
    exitY: number, 
    obstaclePercent: number
  ): void {
    const totalFloorTiles = this.grid.flat().filter(tile => tile === TileType.FLOOR).length;
    const numObstacles = Math.floor(totalFloorTiles * obstaclePercent);

    // Track obstacle positions for spacing checks
    const obstaclePositions: Array<{ x: number; y: number }> = [];
    const MIN_OBSTACLE_SPACING = 4;

    let obstaclesPlaced = 0;
    let attempts = 0;
    const maxAttempts = numObstacles * 10;

    while (obstaclesPlaced < numObstacles && attempts < maxAttempts) {
      const x = this.randomInt(0, this.width - 1);
      const y = this.randomInt(0, this.height - 1);

      if (this.grid[y][x] === TileType.FLOOR) {
        const isNearSpawn = this.getManhattanDistance(x, y, spawnX, spawnY) <= 3;
        const isNearExit = this.getManhattanDistance(x, y, exitX, exitY) <= 3;
        const tooCloseToOtherObstacle = obstaclePositions.some(obs =>
          this.getManhattanDistance(x, y, obs.x, obs.y) < MIN_OBSTACLE_SPACING
        );

        if (!isNearSpawn && !isNearExit && !tooCloseToOtherObstacle) {
          this.grid[y][x] = TileType.OBSTACLE;
          obstaclePositions.push({ x, y });
          obstaclesPlaced++;
        }
      }

      attempts++;
    }
  }
}
