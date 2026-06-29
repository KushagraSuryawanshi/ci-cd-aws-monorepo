import "dotenv/config";
import { prisma } from "@repo/db";

import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 3001 });

wss.on("connection", async (socket) => {
  try {
    await prisma.user.create({
      data: {
        username: `kushagra ${Math.random()}`,
        password: `kushagra ${Math.random()}`,
      },
    });

    socket.send("hey there you are connected to the server");
  } catch (err) {
    console.log(err);
    socket.send("DB failed but websocket connected");
  }
});
