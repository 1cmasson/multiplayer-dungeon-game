import { Pathfinding, Point } from "./Pathfinding";
import { Bot, Player, Bullet } from "../../rooms/schema/DungeonState";

export interface GameState {
  myPlayer: Player | null;
  bots: Map<string, Bot>;
  bullets: Map<string, Bullet>;
  grid: number[][];
}

export interface Action {
  type: "move" | "shoot" | "updateAngle" | "wait";
  direction?: "up" | "down" | "left" | "right";
  angle?: number;
}

/**
 * Bot behavioral states
 */
type BotState = "HUNT" | "KITE" | "RETREAT";

/**
 * State machine data
 */
interface StateData {
  currentState: BotState;
  huntTarget: Point | null;
  lastStateChange: number;
}

/**
 * Perception system for FOV and memory tracking
 */
interface PerceptionSystem {
  lastSeenPosition: Map<string, { x: number; y: number; timestamp: number }>;
  FOV_ANGLE: number; // 120 degrees
  VIEW_DISTANCE: number; // 20 tiles
  MEMORY_DURATION: number; // 5000ms (5 seconds)
}

/**
 * Combat strategy and decision-making for AI bots
 */
export class Strategy {
  private currentPath: Point[] = [];
  private currentTarget: Bot | null = null;
  private lastPathUpdate: number = 0;
  private readonly PATH_UPDATE_INTERVAL = 500; // Recompute path every 500ms
  
  // FOV + Memory System
  private perception = {
    lastSeenPosition: new Map<string, { x: number; y: number; timestamp: number }>(),
    FOV_ANGLE: (120 * Math.PI) / 180, // 120 degrees in radians
    VIEW_DISTANCE: 20,
    MEMORY_DURATION: 5000
  };
  
  // Reaction Delay System
  private targetAcquisitionTime = new Map<string, number>();
  private readonly REACTION_DELAY = 250; // 250ms delay
  
  // Aim Spread System
  private readonly AIM_SPREAD = 0.1; // ±0.1 radians (~5.7 degrees)
  
  // State Machine System
  private stateData: StateData = {
    currentState: "HUNT",
    huntTarget: null,
    lastStateChange: Date.now()
  };

  /**
   * Decide next action based on current game state (using tactical FSM)
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
   * Try to dodge nearby bullets
   */
  private tryDodgeBullet(state: GameState, myPos: Point): Action | null {
    if (!state.myPlayer) return null;

    const DANGER_DISTANCE = 3; // Tiles

    for (const [_, bullet] of state.bullets) {
      const bulletPos = { x: bullet.x, y: bullet.y };
      const distance = Pathfinding.distance(myPos, bulletPos);

      if (distance < DANGER_DISTANCE) {
        // Calculate bullet trajectory
        const bulletAngle = Math.atan2(bullet.velocityY, bullet.velocityX);

        // Move perpendicular to bullet trajectory
        const dodgeAngle = bulletAngle + Math.PI / 2;
        const dodgeX = Math.round(myPos.x + Math.cos(dodgeAngle));
        const dodgeY = Math.round(myPos.y + Math.sin(dodgeAngle));

        // Check if dodge position is valid
        if (this.isValidPosition(state.grid, dodgeX, dodgeY)) {
          return this.getDirectionToMove(myPos, { x: dodgeX, y: dodgeY });
        }
      }
    }

    return null;
  }

  /**
   * Find nearest enemy bot (using FOV and memory)
   */
  private findNearestBot(state: GameState, myPos: Point): Bot | null {
    if (!state.myPlayer) return null;
    
    let nearestBot: Bot | null = null;
    let minDistance = Infinity;

    for (const [botId, bot] of state.bots) {
      const botPos = { x: Math.round(bot.x), y: Math.round(bot.y) };
      
      // Check if we can currently see this bot
      const canSee = this.canSeeTarget(
        myPos,
        state.myPlayer.angle,
        botPos,
        state.grid
      );

      if (canSee) {
        // Update memory when we see a bot
        this.updateMemory(botId, botPos);

        const distance = Pathfinding.distance(myPos, botPos);
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

  /**
   * Navigate toward target using pathfinding
   */
  private navigateToTarget(state: GameState, myPos: Point, targetPos: Point): Action | null {
    const now = Date.now();

    // Check if we need to recompute path
    const needsRecompute =
      this.currentPath.length === 0 ||
      this.currentTarget === null ||
      now - this.lastPathUpdate > this.PATH_UPDATE_INTERVAL;

    if (needsRecompute) {
      this.currentPath = Pathfinding.findPath(state.grid, myPos, targetPos);
      this.lastPathUpdate = now;

      if (this.currentPath.length === 0) {
        // No path found
        return null;
      }
    }

    // Remove current position from path if we're already there
    if (this.currentPath.length > 0) {
      const nextStep = this.currentPath[0];
      if (nextStep.x === myPos.x && nextStep.y === myPos.y) {
        this.currentPath.shift();
      }
    }

    if (this.currentPath.length === 0) {
      return null;
    }

    // Get next step
    const nextStep = this.currentPath[0];
    const moveAction = this.getDirectionToMove(myPos, nextStep);

    if (moveAction && moveAction.type === "move") {
      // Calculate angle for movement direction
      const angle = this.getAngleForDirection(moveAction.direction!);
      if (state.myPlayer && Math.abs(state.myPlayer.angle - angle) > 0.1) {
        return { type: "updateAngle", angle };
      }
    }

    return moveAction;
  }

  /**
   * Get movement direction from current position to next position
   */
  private getDirectionToMove(from: Point, to: Point): Action | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (dx === 1) return { type: "move", direction: "right" };
    if (dx === -1) return { type: "move", direction: "left" };
    if (dy === 1) return { type: "move", direction: "down" };
    if (dy === -1) return { type: "move", direction: "up" };

    return null;
  }

  /**
   * Get angle in radians for movement direction
   */
  private getAngleForDirection(direction: string): number {
    switch (direction) {
      case "up":
        return -Math.PI / 2;
      case "down":
        return Math.PI / 2;
      case "left":
        return Math.PI;
      case "right":
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Check if position is valid (walkable)
   */
  private isValidPosition(grid: number[][], x: number, y: number): boolean {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) {
      return false;
    }

    const tile = grid[y][x];
    // TileType.WALL = 0, TileType.OBSTACLE = 4
    return tile !== 0 && tile !== 4;
  }

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

  /**
   * Add random spread to aim angle
   */
  private applyAimSpread(angle: number): number {
    const spread = (Math.random() - 0.5) * 2 * this.AIM_SPREAD;
    return angle + spread;
  }

  /**
   * Count how many enemies are visible within FOV
   */
  private countVisibleEnemies(state: GameState, myPos: Point): number {
    if (!state.myPlayer) return 0;
    
    let count = 0;
    for (const [_, bot] of state.bots) {
      const botPos = { x: Math.round(bot.x), y: Math.round(bot.y) };
      if (this.canSeeTarget(myPos, state.myPlayer.angle, botPos, state.grid)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Update state machine based on tactical situation
   */
  private updateState(state: GameState, myPos: Point, nearestBot: Bot | null): void {
    if (!state.myPlayer) return;
    
    const visibleEnemies = this.countVisibleEnemies(state, myPos);
    const livesRemaining = state.myPlayer.lives;
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

  /**
   * Transition to new state
   */
  private transitionTo(newState: BotState, timestamp: number): void {
    this.stateData.currentState = newState;
    this.stateData.lastStateChange = timestamp;
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
          return this.navigateToTarget(state, myPos, this.stateData.huntTarget) || { type: "wait" };
        }
      }
      return { type: "wait" };
    }

    // Enemy found - navigate toward it
    const targetPos = { x: Math.round(nearestBot.x), y: Math.round(nearestBot.y) };
    return this.navigateToTarget(state, myPos, targetPos) || { type: "wait" };
  }

  /**
   * KITE: Maintain safe distance while shooting (5-12 tiles)
   */
  private kiteBehavior(state: GameState, myPos: Point, target: Bot): Action {
    if (!state.myPlayer) return { type: "wait" };
    
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

      if (Math.abs(state.myPlayer.angle - angle) > 0.1) {
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
   * RETREAT: Run away to safe area, only shoot if cornered
   */
  private retreatBehavior(state: GameState, myPos: Point): Action {
    if (!state.myPlayer) return { type: "wait" };
    
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

        if (Math.abs(state.myPlayer.angle - angle) > 0.1) {
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

    return { x: Math.floor(width / 2), y: Math.floor(height / 2) }; // Fallback to center
  }

  /**
   * Reset strategy state (call when starting new level)
   */
  reset(): void {
    this.currentPath = [];
    this.currentTarget = null;
    this.lastPathUpdate = 0;
    this.perception.lastSeenPosition.clear();
    this.targetAcquisitionTime.clear();
    this.stateData = {
      currentState: "HUNT",
      huntTarget: null,
      lastStateChange: Date.now()
    };
  }
}
