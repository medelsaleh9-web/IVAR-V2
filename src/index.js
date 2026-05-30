"use strict";

/**
 * index.js — Entry point
 * Bootstraps the bot and installs global safety nets.
 */

require("dotenv").config();

const logger          = require("./utils/logger");
const { startBot, shutdown } = require("./bot");

// ─── Global Error Safety Nets ────────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  logger.error(
    "Unhandled Promise Rejection:",
    reason instanceof Error ? reason : new Error(String(reason))
  );
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  // Allow the process to continue — the bot must not exit on a single error.
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT — shutting down gracefully.");
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM — shutting down gracefully.");
  shutdown();
  process.exit(0);
});

// ─── Start ────────────────────────────────────────────────────────────────────

startBot().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
