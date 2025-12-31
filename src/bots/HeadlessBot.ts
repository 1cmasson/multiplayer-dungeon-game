import { Client, Room } from "colyseus.js";
import { DungeonState, Player, Bot, Bullet } from "../rooms/schema/DungeonState";
import { DungeonGenerator } from "../utils/dungeonGenerator";
import { Strategy, GameState, Action } from "./ai/Strategy";

export interface BotStats {
  kills: number;
  deaths: number;
  shotsFired: number;
  damageDealt: number;
  survivalTime: number;
}

export interface HeadlessBotConfig {
  name: string;
  host?: string;
  port?: number;
  roomId?: string;
  updateInterval?: number; // Decision-making interval in ms
  verbose?: boolean;
}

/**
 * Headless AI bot that connects to the game server and plays autonomously
 */
export class HeadlessBot {
  private client: Client;
  private room: Room<DungeonState> | null = null;
  private sessionId: string = "";
  private config: Required<HeadlessBotConfig>;
  private strategy: Strategy;
  private dungeonGrid: number[][] = [];
  private updateLoop: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private stats: BotStats = {
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    damageDealt: 0,
    survivalTime: 0,
  };
  private isRunning: boolean = false;

  constructor(config: HeadlessBotConfig) {
    this.config = {
      name: config.name,
      host: config.host || "localhost",
      port: config.port || 2567,
      roomId: config.roomId || "",
      updateInterval: config.updateInterval || 100, // 100ms = 10 decisions/sec
      verbose: config.verbose || false,
    };

    this.client = new Client(`ws://${this.config.host}:${this.config.port}`);
    this.strategy = new Strategy();
  }

  /**
   * Connect to game server and start playing
   */
  async connect(): Promise<void> {
    try {
      if (this.config.verbose) {
        console.log(`[${this.config.name}] Connecting to game server...`);
      }

      // Join or create room
      if (this.config.roomId) {
        this.room = await this.client.joinById<DungeonState>(this.config.roomId);
      } else {
        this.room = await this.client.joinOrCreate<DungeonState>("dungeon", { difficulty: 1 });
      }

      this.sessionId = this.room.sessionId;
      this.startTime = Date.now();
      this.isRunning = true;

      if (this.config.verbose) {
        console.log(`[${this.config.name}] Connected! Room: ${this.room.roomId}, Session: ${this.sessionId}`);
      }

      // Set up state listeners
      this.setupStateListeners();

      // Start decision-making loop
      this.startUpdateLoop();
    } catch (error) {
      console.error(`[${this.config.name}] Failed to connect:`, error);
      throw error;
    }
  }

  /**
   * Set up listeners for game state changes
   */
  private setupStateListeners(): void {
    if (!this.room) return;

    // Initial state setup
    this.room.onStateChange.once((state: DungeonState) => {
      if (this.config.verbose) {
        console.log(`[${this.config.name}] Received initial state`);
      }

      // Generate dungeon from seed (use depth 0 for base generation)
      const generator = new DungeonGenerator(state.width, state.height, state.seed);
      const dungeonData = generator.generate(state.currentMapDepth);
      this.dungeonGrid = dungeonData.grid;

      if (this.config.verbose) {
        console.log(`[${this.config.name}] Dungeon generated: ${state.width}x${state.height}`);
      }

      // Track kills by monitoring bot count changes (after initial state is received)
      let previousBotCount = state.bots.size;
      this.room!.onStateChange(() => {
        if (!this.room) return;
        const currentBotCount = this.room.state.bots.size;
        if (currentBotCount < previousBotCount) {
          // A bot was removed, assume we contributed
          this.stats.kills += previousBotCount - currentBotCount;
        }
        previousBotCount = currentBotCount;
      });
    });

    // Listen for map changes (instead of level changes)
    this.room.onMessage("mapChanged", (message: any) => {
      if (this.config.verbose) {
        console.log(`[${this.config.name}] Map changed! New depth: ${message.depth}`);
      }

      // Regenerate dungeon with new seed
      if (this.room && this.room.state) {
        const state = this.room.state;
        const generator = new DungeonGenerator(state.width, state.height, state.seed);
        const dungeonData = generator.generate(state.currentMapDepth);
        this.dungeonGrid = dungeonData.grid;
        this.strategy.reset();
      }
    });

    // Listen for player hits
    this.room.onMessage("playerHit", (message: any) => {
      if (message.sessionId === this.sessionId) {
        this.stats.deaths++;
        if (this.config.verbose) {
          console.log(`[${this.config.name}] Hit! Lives remaining: ${message.lives}`);
        }
      }
    });

    // Listen for game over
    this.room.onMessage("gameOver", (message: any) => {
      if (message.sessionId === this.sessionId) {
        if (this.config.verbose) {
          console.log(`[${this.config.name}] Game Over!`);
        }
        this.stop();
      }
    });

    // Listen for game completion
    this.room.onMessage("gameCompleted", (message: any) => {
      if (this.config.verbose) {
        console.log(`[${this.config.name}] Game Completed! Total kills: ${message.totalKills}`);
      }
    });
  }

  /**
   * Start the decision-making loop
   */
  private startUpdateLoop(): void {
    this.updateLoop = setInterval(() => {
      this.update();
    }, this.config.updateInterval);
  }

  /**
   * Main update loop - decide and execute actions
   */
  private update(): void {
    if (!this.room || !this.room.state || !this.isRunning) return;

    const state = this.room.state;
    const myPlayer = state.players.get(this.sessionId);

    if (!myPlayer || myPlayer.lives <= 0) {
      return;
    }

    // Build game state for strategy
    const gameState: GameState = {
      myPlayer,
      bots: new Map(state.bots as any),
      bullets: new Map(state.bullets as any),
      grid: this.dungeonGrid,
    };

    // Decide next action
    const action = this.strategy.decideAction(gameState);

    // Execute action
    this.executeAction(action);

    // Update survival time
    this.stats.survivalTime = Date.now() - this.startTime;
  }

  /**
   * Execute an action by sending message to server
   */
  private executeAction(action: Action): void {
    if (!this.room) return;

    switch (action.type) {
      case "move":
        if (action.direction) {
          this.room.send("move", { direction: action.direction });
        }
        break;

      case "updateAngle":
        if (action.angle !== undefined) {
          this.room.send("updateAngle", { angle: action.angle });
        }
        break;

      case "shoot":
        if (action.angle !== undefined) {
          this.room.send("shoot", { angle: action.angle });
          this.stats.shotsFired++;
        }
        break;

      case "wait":
        // Do nothing
        break;
    }
  }

  /**
   * Stop the bot and disconnect
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.updateLoop) {
      clearInterval(this.updateLoop);
      this.updateLoop = null;
    }

    if (this.room) {
      await this.room.leave();
      this.room = null;
    }

    if (this.config.verbose) {
      console.log(`[${this.config.name}] Disconnected`);
    }
  }

  /**
   * Get current bot statistics
   */
  getStats(): BotStats {
    return { ...this.stats };
  }

  /**
   * Get bot name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Check if bot is currently running
   */
  isActive(): boolean {
    return this.isRunning && this.room !== null;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get room ID
   */
  getRoomId(): string {
    return this.room?.roomId || "";
  }
}
