import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { DungeonRoom } from "./rooms/DungeonRoom";

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static("public"));

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

// Register room handlers
gameServer.define("dungeon", DungeonRoom);

gameServer.listen(port);
console.log(`🎮 Game server is listening on ws://localhost:${port}`);
console.log(`🌐 Open http://localhost:${port} in your browser`);
