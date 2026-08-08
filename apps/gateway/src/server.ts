import app from "./app.js";
import { bootGateway } from "./boot.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  try {
    await bootGateway();
  } catch (err) {
    logger.fatal({ err }, "gateway boot failed");
    process.exit(1);
  }

  const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info({ port: PORT }, "FreeLLM gateway listening");
  });

  function shutdown(signal: string) {
    logger.info({ signal }, "Shutdown signal received, draining connections...");
    server.close(() => {
      logger.info("All connections drained, exiting.");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forcefully shutting down after timeout.");
      process.exit(1);
    }, 8000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();
