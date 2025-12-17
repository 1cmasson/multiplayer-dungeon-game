#!/usr/bin/env node

import { BotManager } from "./bots/BotManager";

/**
 * Parse command-line arguments
 */
function parseArgs(): {
  headless: number;
  visual: number;
  host: string;
  port: number;
  roomId: string;
  verbose: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  const config = {
    headless: 1,
    visual: 0,
    host: "localhost",
    port: 2567,
    roomId: "",
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--headless":
      case "-h":
        config.headless = parseInt(args[++i] || "1", 10);
        break;

      case "--visual":
      case "-v":
        config.visual = parseInt(args[++i] || "1", 10);
        break;

      case "--host":
        config.host = args[++i] || "localhost";
        break;

      case "--port":
      case "-p":
        config.port = parseInt(args[++i] || "2567", 10);
        break;

      case "--room":
      case "-r":
        config.roomId = args[++i] || "";
        break;

      case "--verbose":
        config.verbose = true;
        break;

      case "--help":
        config.help = true;
        break;

      default:
        console.error(`Unknown argument: ${arg}`);
        config.help = true;
        break;
    }
  }

  return config;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
🤖 AI Bot Runner - Multiplayer Dungeon Shooter

Usage:
  pnpm run bots [options]

Options:
  --headless, -h <N>     Number of headless (fast) bots (default: 1)
  --visual, -v <N>       Number of visual (Playwright) bots (default: 0)
  --host <HOST>          Server host (default: localhost)
  --port, -p <PORT>      Server port (default: 2567)
  --room, -r <ROOM_ID>   Join specific room ID (optional)
  --verbose              Enable verbose logging
  --help                 Show this help message

Examples:
  pnpm run bots                           # Run 1 headless bot
  pnpm run bots --headless 5              # Run 5 headless bots
  pnpm run bots --headless 10 --verbose   # Run 10 headless bots with detailed logs
  pnpm run bots -h 15                     # Run 15 headless bots (short form)
  pnpm run bots --host 192.168.1.100      # Connect to remote server

Notes:
  - Headless bots are fast AI clients that make decisions every 100ms
  - Visual bots (Playwright) are not yet fully implemented
  - Press Ctrl+C to stop all bots and see final statistics
  - Make sure the game server is running before starting bots

Stats:
  - Bots will print statistics every 10 seconds
  - Final statistics shown on shutdown
  - Track kills, deaths, shots fired, and survival time
  `);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const config = parseArgs();

  if (config.help) {
    printHelp();
    process.exit(0);
  }

  // Validate configuration
  if (config.headless < 0 || config.visual < 0) {
    console.error("❌ Error: Bot counts must be non-negative");
    process.exit(1);
  }

  if (config.headless === 0 && config.visual === 0) {
    console.error("❌ Error: Must specify at least one bot");
    console.log("\nUse --help for usage information");
    process.exit(1);
  }

  if (config.visual > 0) {
    console.log("⚠️  Warning: Visual bots require manual Claude integration with Playwright MCP");
    console.log("   For now, only headless bots will be spawned.");
    console.log("");
  }

  // Create and start bot manager
  const manager = new BotManager({
    host: config.host,
    port: config.port,
    numHeadlessBots: config.headless,
    numVisualBots: 0, // Visual bots not yet implemented
    roomId: config.roomId,
    verbose: config.verbose,
    statsInterval: 10000, // 10 seconds
  });

  try {
    await manager.start();

    // Keep process alive
    await new Promise(() => {
      // Process will exit on SIGINT/SIGTERM (handled in BotManager)
    });
  } catch (error) {
    console.error("❌ Error:", error);
    await manager.stop();
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
