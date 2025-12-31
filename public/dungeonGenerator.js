/**
 * IMPORTANT: This file must stay in sync with src/utils/dungeonGenerator.ts
 * Any changes to dungeon generation logic must be applied to BOTH files
 * to prevent client/server grid mismatches (invisible walls bug).
 * 
 * Both files use seed-based deterministic generation to produce identical
 * dungeon layouts from the same seed, allowing the server to send only
 * a seed (~8 bytes) instead of the full grid (~57KB).
 */

// Seeded Random Number Generator (must match server-side)
class SeededRandom {
  constructor(seed) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }

  next() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// Tile types (must match server-side TileType enum)
const TileType = {
  WALL: 0,
  FLOOR: 1,
  EXIT: 2,
  SPAWN: 3,
  OBSTACLE: 4,
  TRANSPORT_INACTIVE: 5, // Blue tile after transport is used
  ENTRY_PORTAL: 6,       // Purple portal - go back to previous map
  EXIT_PORTAL: 7,        // Green portal - go to next map
  HOME_MARKER: 8         // Gold marker - starting map indicator (can't go back)
};

// Client-side Dungeon Generator (must match server-side algorithm exactly)
class DungeonGenerator {
  constructor(width, height, seed) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    this.grid = this.createEmptyGrid();
    this.rooms = [];
  }

  createEmptyGrid() {
    return Array(this.height).fill(0).map(() => Array(this.width).fill(TileType.WALL));
  }

  randomInt(min, max) {
    return this.rng.nextInt(min, max);
  }

  doesRoomOverlap(newRoom) {
    for (const room of this.rooms) {
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

  createRoom(x, y, width, height) {
    for (let i = y; i < y + height; i++) {
      for (let j = x; j < x + width; j++) {
        if (i >= 0 && i < this.height && j >= 0 && j < this.width) {
          this.grid[i][j] = TileType.FLOOR;
        }
      }
    }
  }

  createHorizontalCorridor(x1, x2, y) {
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

  createVerticalCorridor(y1, y2, x) {
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

  connectRooms(room1, room2) {
    const center1X = Math.floor(room1.x + room1.width / 2);
    const center1Y = Math.floor(room1.y + room1.height / 2);
    const center2X = Math.floor(room2.x + room2.width / 2);
    const center2Y = Math.floor(room2.y + room2.height / 2);

    if (this.rng.next() < 0.5) {
      this.createHorizontalCorridor(center1X, center2X, center1Y);
      this.createVerticalCorridor(center1Y, center2Y, center2X);
    } else {
      this.createVerticalCorridor(center1Y, center2Y, center1X);
      this.createHorizontalCorridor(center1X, center2X, center2Y);
    }
  }

  /**
   * Get difficulty parameters for a given map depth (must match server!)
   */
  getDifficultyForDepth(mapDepth) {
    const DIFFICULTY_CONFIG = {
      baseBotsCount: 5,
      baseBotHealth: 100,
      baseBotSpeed: 333,
      baseObstaclePercent: 5,
      botsPerDepth: 2,
      healthPerDepth: 25,
      speedReductionPerDepth: 15,
      obstaclePercentPerDepth: 1,
      maxBots: 30,
      maxHealth: 300,
      minSpeed: 150,
      maxObstaclePercent: 15,
    };
    
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
      ) / 100, // Convert to decimal (0.05, 0.06, etc.)
    };
  }

  /**
   * Calculate Manhattan distance between two points
   */
  getManhattanDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Check if a tile is walkable (for pathfinding)
   * Must match server-side isWalkable() exactly!
   */
  isWalkable(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    const tile = this.grid[y][x];
    return tile === TileType.FLOOR || 
           tile === TileType.SPAWN || 
           tile === TileType.EXIT || 
           tile === TileType.ENTRY_PORTAL || 
           tile === TileType.EXIT_PORTAL || 
           tile === TileType.HOME_MARKER ||
           tile === TileType.TRANSPORT_INACTIVE;
  }

  /**
   * BFS to check if a path exists between two points
   * Must match server-side hasPath() exactly!
   */
  hasPath(startX, startY, endX, endY) {
    if (!this.isWalkable(startX, startY) || !this.isWalkable(endX, endY)) {
      return false;
    }

    const visited = new Set();
    const queue = [{ x: startX, y: startY }];
    visited.add(`${startX},${startY}`);

    const directions = [
      { dx: 0, dy: -1 }, // up
      { dx: 0, dy: 1 },  // down
      { dx: -1, dy: 0 }, // left
      { dx: 1, dy: 0 },  // right
    ];

    while (queue.length > 0) {
      const current = queue.shift();

      if (current.x === endX && current.y === endY) {
        return true;
      }

      for (const dir of directions) {
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;
        const key = `${nx},${ny}`;

        if (!visited.has(key) && this.isWalkable(nx, ny)) {
          visited.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    return false;
  }

  generate(mapDepth = 0) {
    this.grid = this.createEmptyGrid();
    this.rooms = [];

    // Get difficulty parameters based on map depth (must match server!)
    const difficultyParams = this.getDifficultyForDepth(mapDepth);

    const numRooms = Math.min(8 + mapDepth, 15);
    const minRoomSize = 6;
    const maxRoomSize = 12;

    let attempts = 0;
    const maxAttempts = 100;

    while (this.rooms.length < numRooms && attempts < maxAttempts) {
      const width = this.randomInt(minRoomSize, maxRoomSize);
      const height = this.randomInt(minRoomSize, maxRoomSize);
      const x = this.randomInt(1, this.width - width - 1);
      const y = this.randomInt(1, this.height - height - 1);

      const newRoom = { x, y, width, height };

      if (!this.doesRoomOverlap(newRoom)) {
        this.createRoom(x, y, width, height);
        this.rooms.push(newRoom);

        if (this.rooms.length > 1) {
          this.connectRooms(this.rooms[this.rooms.length - 2], newRoom);
        }
      }

      attempts++;
    }

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

    return {
      grid: this.grid,
      rooms: this.rooms,
      width: this.width,
      height: this.height,
      spawnPoint: { x: spawnX, y: spawnY },
      exitPoint: { x: exitPortalX, y: exitPortalY },
      entryPortalPoint: mapDepth === 0 ? null : { x: spawnX, y: spawnY },
      exitPortalPoint: { x: exitPortalX, y: exitPortalY },
      mapDepth: mapDepth,
      transportPoints: [] // Empty for client, server tracks actual transports
    };
  }

  /**
   * Place obstacles with a specific percentage (must match server exactly!)
   * Ensures a clear path always exists from spawn to exit
   */
  placeObstaclesWithPercent(spawnX, spawnY, exitX, exitY, obstaclePercent) {
    const totalFloorTiles = this.grid.flat().filter(tile => tile === TileType.FLOOR).length;
    const numObstacles = Math.floor(totalFloorTiles * obstaclePercent);

    // Track obstacle positions for spacing checks (must match server!)
    const obstaclePositions = [];
    const MIN_OBSTACLE_SPACING = 4;

    let obstaclesPlaced = 0;
    let attempts = 0;
    let pathBlockedCount = 0;
    const maxAttempts = numObstacles * 20; // Increased attempts since some will be rejected

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
          // Temporarily place the obstacle
          this.grid[y][x] = TileType.OBSTACLE;
          
          // Check if path still exists from spawn to exit
          if (this.hasPath(spawnX, spawnY, exitX, exitY)) {
            // Path is still valid, keep the obstacle
            obstaclePositions.push({ x, y });
            obstaclesPlaced++;
          } else {
            // Obstacle would block the path, remove it
            this.grid[y][x] = TileType.FLOOR;
            pathBlockedCount++;
          }
        }
      }

      attempts++;
    }
  }
}
