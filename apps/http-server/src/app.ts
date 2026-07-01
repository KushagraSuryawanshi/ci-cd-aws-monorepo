import "dotenv/config";
import { prisma } from "@repo/db";
import express, { type Request, type Response } from "express";
const app = express();

app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.json({
    service: "http-server",
    status: "running",
    message: "API is running on port 3000",
  });
});

app.post("/signup", async (req: Request, res: Response) => {
  try {
    const { username, password } = await req.body;
    const user = await prisma.user.create({
      data: {
        username,
        password,
      },
    });
    res.json(user);
  } catch (e) {
    console.log(e);
  }
});

app.listen(3000, () => {
  console.log("app is listening at port 3000");
});
