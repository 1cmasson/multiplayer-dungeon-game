import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { DungeonRoom } from "./rooms/DungeonRoom";

const app = express();
app.use(cors());
app.use(express.json());

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

// Register room handlers with lobby listing enabled
// filterBy allows metadata to be included in room listings
gameServer.define("dungeon", DungeonRoom)
  .filterBy(['roomName'])
  .enableRealtimeListing();

// Room list API endpoint - query active rooms via matchMaker
// Using /api/rooms to avoid conflicts with Colyseus internal routes
app.get('/api/rooms/:roomName', async (req, res) => {
  try {
    const roomName = req.params.roomName;
    const rooms = await matchMaker.query({ name: roomName });
    
    // Format response with room details
    const roomList = rooms.map(room => ({
      roomId: room.roomId,
      name: room.name,
      clients: room.clients,
      maxClients: room.maxClients,
      metadata: room.metadata || {}
    }));
    
    console.log(`[API] Found ${roomList.length} rooms for "${roomName}"`);
    res.json(roomList);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Serve static files from public directory (AFTER API routes)
app.use(express.static("public"));

gameServer.listen(port);
console.log(`🎮 Game server is listening on ws://localhost:${port}`);
console.log(`🌐 Open http://localhost:${port} in your browser`);
