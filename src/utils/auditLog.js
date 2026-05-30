"use strict";

/**
 * auditLog.js — Append-only command audit trail.
 *
 * Writes a structured line per event to logs/audit.log.
 * Rotates the file when it exceeds MAX_SIZE bytes (default 5 MB).
 *
 * Format:
 *   [ISO-timestamp] | TYPE | senderID | threadID | detail
 *
 * Types: CMD_OK | CMD_DENIED | CMD_ERROR | BOT_START | BOT_STOP | SESSION_EVENT
 */

const fs   = require("fs-extra");
const path = require("path");

const LOG_PATH = path.resolve(__dirname, "../../logs/audit.log");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

fs.ensureDirSync(path.dirname(LOG_PATH));

/**
 * Rotates the log file if it exceeds MAX_SIZE.
 */
async function maybeRotate() {
  try {
    const stat = await fs.stat(LOG_PATH).catch(() => null);
    if (stat && stat.size > MAX_SIZE) {
      const rotated = LOG_PATH + "." + Date.now() + ".bak";
      await fs.move(LOG_PATH, rotated, { overwrite: true });
    }
  } catch (_) {}
}

/**
 * Appends a line to the audit log.
 */
async function write(type, senderID, threadID, detail) {
  await maybeRotate();
  const line =
    `[${new Date().toISOString()}] | ${String(type).padEnd(14)} | ` +
    `${senderID || "-"} | ${threadID || "-"} | ${detail}\n`;
  await fs.appendFile(LOG_PATH, line).catch(() => {});
}

// ─── Convenience helpers ───────────────────────────────────────────────────

function logCommand(senderID, threadID, commandName, args) {
  const argsStr = args && args.length ? args.join(" ") : "";
  return write("CMD_OK", senderID, threadID, `!${commandName} ${argsStr}`.trim());
}

function logDenied(senderID, threadID, commandName, reason) {
  return write("CMD_DENIED", senderID, threadID, `!${commandName} — ${reason}`);
}

function logError(senderID, threadID, commandName, err) {
  const msg = err?.message || String(err);
  return write("CMD_ERROR", senderID, threadID, `!${commandName} — ${msg}`);
}

function logBotEvent(type, detail) {
  return write(type, null, null, detail);
}

module.exports = { logCommand, logDenied, logError, logBotEvent };
