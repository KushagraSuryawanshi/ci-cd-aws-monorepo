import "dotenv/config";

import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 3001 });

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      service: "ws-server",
      status: "running",
      message: "WebSocket server is running on port 3001",
    }),
  );
});
