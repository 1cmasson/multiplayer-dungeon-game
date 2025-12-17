import { HeadlessBot, BotStats } from "./HeadlessBot";

export interface BotManagerConfig {
  host?: string;
  port?: number;
  numHeadlessBots?: number;
  numVisualBots?: number;
  roomId?: string;
  verbose?: boolean;
  statsInterval?: number; // How often to print stats (ms)
}

export interface ManagerStats {
  totalBots: number;
  activeBots: number;
  totalKills: number;
  totalDeaths: number;
  totalShots: number;
  avgSurvivalTime: number;
  botStats: Map<string, BotStats>;
}

/**
 * Bot Manager - Orchestrates multiple AI bots
 */
export class BotManager {
  private config: Required<BotManagerConfig>;
  private headlessBots: HeadlessBot[] = [];
  private statsInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config: BotManagerConfig) {
    this.config = {
      host: config.host || "localhost",
      port: config.port || 2567,
      numHeadlessBots: config.numHeadlessBots || 0,
      numVisualBots: config.numVisualBots || 0,
      roomId: config.roomId || "",
      verbose: config.verbose || false,
      statsInterval: config.statsInterval || 10000, // Print stats every 10 seconds
    };
  }

  /**
   * Start all bots
   */
  async start(): Promise<void> {
    console.log("🤖 Bot Manager Starting...");
    console.log(`   Headless Bots: ${this.config.numHeadlessBots}`);
    console.log(`   Visual Bots: ${this.config.numVisualBots} (not yet implemented)`);
    console.log(`   Host: ${this.config.host}:${this.config.port}`);
    console.log("");

    this.isRunning = true;

    // Spawn headless bots
    const headlessBotPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.numHeadlessBots; i++) {
      const bot = new HeadlessBot({
        name: `HeadlessBot-${i + 1}`,
        host: this.config.host,
        port: this.config.port,
        roomId: this.config.roomId,
        updateInterval: 100, // 10 updates/sec
        verbose: this.config.verbose,
      });

      this.headlessBots.push(bot);

      // Connect bots with slight delay to avoid overwhelming server
      const delay = i * 200; // 200ms between each bot
      headlessBotPromises.push(
        new Promise((resolve) => {
          setTimeout(async () => {
            try {
              await bot.connect();
              if (!this.config.verbose) {
                console.log(`✅ ${bot.getName()} connected (Room: ${bot.getRoomId()})`);
              }
              resolve();
            } catch (error) {
              console.error(`❌ ${bot.getName()} failed to connect:`, error);
              resolve();
            }
          }, delay);
        })
      );
    }

    // Wait for all bots to connect
    await Promise.all(headlessBotPromises);

    console.log("");
    console.log(`✅ All bots connected! Total: ${this.headlessBots.length}`);
    console.log("");

    // Start stats monitoring
    this.startStatsMonitoring();

    // Set up graceful shutdown
    this.setupShutdownHandlers();
  }

  /**
   * Start periodic stats monitoring
   */
  private startStatsMonitoring(): void {
    if (this.config.statsInterval <= 0) return;

    this.statsInterval = setInterval(() => {
      this.printStats();
    }, this.config.statsInterval);

    // Print initial stats
    setTimeout(() => this.printStats(), 2000);
  }

  /**
   * Print current statistics
   */
  private printStats(): void {
    const stats = this.getStats();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Bot Statistics");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   Active Bots: ${stats.activeBots}/${stats.totalBots}`);
    console.log(`   Total Kills: ${stats.totalKills}`);
    console.log(`   Total Deaths: ${stats.totalDeaths}`);
    console.log(`   Total Shots: ${stats.totalShots}`);
    console.log(`   Avg Survival Time: ${(stats.avgSurvivalTime / 1000).toFixed(1)}s`);
    console.log("");

    // Individual bot stats
    if (this.config.verbose) {
      console.log("Individual Bot Stats:");
      for (const [name, botStats] of stats.botStats) {
        console.log(
          `   ${name}: ` +
            `K:${botStats.kills} ` +
            `D:${botStats.deaths} ` +
            `S:${botStats.shotsFired} ` +
            `T:${(botStats.survivalTime / 1000).toFixed(1)}s`
        );
      }
      console.log("");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
  }

  /**
   * Get aggregated statistics
   */
  getStats(): ManagerStats {
    let totalKills = 0;
    let totalDeaths = 0;
    let totalShots = 0;
    let totalSurvivalTime = 0;
    let activeBots = 0;

    const botStats = new Map<string, BotStats>();

    for (const bot of this.headlessBots) {
      const stats = bot.getStats();
      botStats.set(bot.getName(), stats);

      totalKills += stats.kills;
      totalDeaths += stats.deaths;
      totalShots += stats.shotsFired;
      totalSurvivalTime += stats.survivalTime;

      if (bot.isActive()) {
        activeBots++;
      }
    }

    const avgSurvivalTime = this.headlessBots.length > 0 ? totalSurvivalTime / this.headlessBots.length : 0;

    return {
      totalBots: this.headlessBots.length,
      activeBots,
      totalKills,
      totalDeaths,
      totalShots,
      avgSurvivalTime,
      botStats,
    };
  }

  /**
   * Stop all bots and clean up
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("");
    console.log("🛑 Stopping all bots...");

    this.isRunning = false;

    // Stop stats monitoring
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Stop all headless bots
    const stopPromises = this.headlessBots.map((bot) => bot.stop());
    await Promise.all(stopPromises);

    // Print final stats
    console.log("");
    console.log("📊 Final Statistics:");
    this.printStats();

    console.log("✅ All bots stopped");
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      await this.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  /**
   * Check if manager is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get list of all bots
   */
  getBots(): HeadlessBot[] {
    return [...this.headlessBots];
  }
}
