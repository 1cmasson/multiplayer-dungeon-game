import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") sessionId: string = "";
  @type("number") lives: number = 3;
  @type("number") angle: number = 0; // Direction player is facing (for triangle)
  @type("number") score: number = 0; // Kills
  @type("number") invincibleUntil: number = 0; // Timestamp when invincibility ends
}

export class Bot extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") maxHealth: number = 100;
  
  // Interpolation support for smooth client-side rendering
  @type("number") targetX: number = 0;  // Target tile bot is moving to
  @type("number") targetY: number = 0;  // Target tile bot is moving to
  @type("number") moveStartTime: number = 0;  // When movement began (for interpolation)
}

export class Bullet extends Schema {
  @type("string") id: string = "";
  @type("string") playerId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") velocityX: number = 0;
  @type("number") velocityY: number = 0;
}

export class Transport extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
}

export class DungeonState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bot }) bots = new MapSchema<Bot>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
  @type([Transport]) activeTransports = new ArraySchema<Transport>(); // Active (invisible) transports
  @type("number") seed: number = 0; // Seed for current level's dungeon generation
  @type("number") width: number = 50;
  @type("number") height: number = 50;
  @type("number") exitX: number = 0;
  @type("number") exitY: number = 0;
  @type("number") currentLevel: number = 1; // Current level (1-5)
  @type("number") totalLevels: number = 5; // Total number of levels
  @type("number") totalKills: number = 0; // Total bots killed across all levels
  @type("number") currentLevelKills: number = 0; // Kills in current level
  @type("number") killsNeededForNextLevel: number = 10; // Dynamic target per level
}
