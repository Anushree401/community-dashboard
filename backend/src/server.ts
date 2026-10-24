import "dotenv/config";
import app from "./app.js";
import prisma from "./lib/prisma.js";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`CEH API running at http://127.0.0.1:${port}`);
});

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  server.close(async (error) => {
    if (error) {
      console.error("Error closing HTTP server:", error);
      process.exitCode = 1;
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error("Error disconnecting Prisma:", disconnectError);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
