"use strict";

/**
 * Event: message
 * Handles incoming Messenger messages with:
 *  • Per-user rate limiting (rateLimiter.js)
 *  • Typing indicator + random human-like delay before responding
 *  • Command audit logging (auditLog.js)
 */

const config      = require("../../config.json");
const logger      = require("../utils/logger");
const rateLimiter = require("../utils/rateLimiter");
const auditLog    = require("../utils/auditLog");

// Response delay range (ms) — makes the bot feel less robotic
const DELAY_MIN = config.response?.typingDelayMinMs ?? 600;
const DELAY_MAX = config.response?.typingDelayMaxMs ?? 2400;

/**
 * Returns a random integer in [min, max].
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleeps for ms milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a typing indicator and waits a human-like delay.
 * Errors are swallowed — a failed indicator should never block the response.
 */
async function humanDelay(api, threadID) {
  try {
    await new Promise((resolve) => {
      api.sendTypingIndicator(threadID, () => resolve());
    });
  } catch (_) {}

  await sleep(randInt(DELAY_MIN, DELAY_MAX));
}

/**
 * Sends a message, suppressing errors so the bot never crashes on a send failure.
 */
async function safeSend(api, text, threadID) {
  return new Promise((resolve) => {
    api.sendMessage(text, threadID, (err) => {
      if (err) logger.warn(`sendMessage failed in ${threadID}: ${err.message || err}`);
      resolve();
    });
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Handles a single incoming message event.
 *
 * @param {object} api
 * @param {object} event
 * @param {Map<string, object>} commands
 */
async function handleMessage(api, event, commands) {
  try {
    const { body, senderID, threadID } = event;

    // Ignore empty messages or messages from the bot itself
    if (!body || !body.trim()) return;
    if (senderID === api.getCurrentUserID()) return;

    const prefix = config.prefix;
    if (!body.startsWith(prefix)) return;

    const [rawCommand, ...args] = body.slice(prefix.length).trim().split(/\s+/);
    const commandName = rawCommand.toLowerCase();

    logger.message(senderID, threadID, body);

    // Unknown command — silent ignore (avoids spam)
    if (!commands.has(commandName)) return;

    const command = commands.get(commandName);

    // ── Rate limiter check ───────────────────────────────────────────────
    const rlResult = rateLimiter.check(senderID, command);
    if (!rlResult.allowed) {
      logger.warn(`[RateLimiter] Denied ${senderID} → ${commandName} (${rlResult.reason})`);
      auditLog.logDenied(senderID, threadID, commandName, rlResult.reason);
      // Only reply for cooldown (not blacklist — silence is more effective for spammers)
      if (rlResult.reason === "cooldown") {
        await humanDelay(api, threadID);
        await safeSend(api, rateLimiter.denyMessage(rlResult), threadID);
      }
      return;
    }

    logger.command(commandName, senderID);

    // ── Human-like delay before responding ──────────────────────────────
    await humanDelay(api, threadID);

    // ── Execute command ──────────────────────────────────────────────────
    try {
      await command.execute(api, event, args, commands);
      auditLog.logCommand(senderID, threadID, commandName, args);
    } catch (cmdErr) {
      logger.error(`Error in command "${commandName}":`, cmdErr);
      auditLog.logError(senderID, threadID, commandName, cmdErr);
      await safeSend(
        api,
        `⚠️ حدث خطأ أثناء تنفيذ الأمر "${commandName}". يرجى المحاولة لاحقاً.`,
        threadID
      );
    }
  } catch (err) {
    logger.error("Unhandled error in message event handler:", err);
  }
}

module.exports = { handleMessage };
