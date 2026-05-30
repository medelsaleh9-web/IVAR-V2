"use strict";

/**
 * rateLimiter.js — Per-user rate limiter, anti-spam, and auto-blacklist.
 *
 * Features:
 *  • Global per-user cooldown (default 3 s between any two commands)
 *  • Per-command cooldown overrides (set in each command module)
 *  • Violation counter: if a user fires >SPAM_THRESHOLD commands in
 *    SPAM_WINDOW ms, they are blacklisted for BLACKLIST_DURATION ms.
 *  • Admins are exempt from all limits.
 */

const config    = require("../../config.json");
const { isAdmin } = require("./admin");
const logger    = require("./logger");

// ─── Tunables ─────────────────────────────────────────────────────────────────

const DEFAULT_COOLDOWN    = (config.rateLimiter?.cooldown      ?? 3)    * 1000; // ms
const SPAM_THRESHOLD      = config.rateLimiter?.spamThreshold  ?? 5;    // commands
const SPAM_WINDOW         = (config.rateLimiter?.spamWindow    ?? 10)   * 1000; // ms
const BLACKLIST_DURATION  = (config.rateLimiter?.blacklistDuration ?? 300) * 1000; // ms

// ─── State ────────────────────────────────────────────────────────────────────

/** Map<userID, { lastUsed: number, violations: number[], blacklistedUntil: number }> */
const userState = new Map();

function getState(userID) {
  if (!userState.has(userID)) {
    userState.set(userID, { lastUsed: 0, violations: [], blacklistedUntil: 0 });
  }
  return userState.get(userID);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Prunes violation timestamps older than SPAM_WINDOW.
 */
function pruneViolations(state) {
  const cutoff = Date.now() - SPAM_WINDOW;
  state.violations = state.violations.filter((t) => t > cutoff);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a user is allowed to run a command right now.
 *
 * @param {string} userID       - Facebook UID of the sender
 * @param {object} [command]    - command module (may contain .cooldown in seconds)
 * @returns {{ allowed: boolean, reason: string|null, retryAfterMs: number }}
 */
function check(userID, command) {
  // Admins bypass all limits
  if (isAdmin(userID)) return { allowed: true, reason: null, retryAfterMs: 0 };

  const state = getState(userID);
  const now   = Date.now();

  // ── Blacklist check ──────────────────────────────────────────────────────
  if (state.blacklistedUntil > now) {
    const remaining = Math.ceil((state.blacklistedUntil - now) / 1000);
    return {
      allowed:     false,
      reason:      `blacklisted`,
      retryAfterMs: state.blacklistedUntil - now,
    };
  }

  // ── Cooldown check ───────────────────────────────────────────────────────
  const cmdCooldown = (command?.cooldown ?? 0) * 1000 || DEFAULT_COOLDOWN;
  const elapsed     = now - state.lastUsed;
  if (elapsed < cmdCooldown) {
    return {
      allowed:     false,
      reason:      `cooldown`,
      retryAfterMs: cmdCooldown - elapsed,
    };
  }

  // ── Spam check ───────────────────────────────────────────────────────────
  pruneViolations(state);
  state.violations.push(now);

  if (state.violations.length > SPAM_THRESHOLD) {
    state.blacklistedUntil = now + BLACKLIST_DURATION;
    state.violations = [];
    logger.warn(`[RateLimiter] User ${userID} blacklisted for ${BLACKLIST_DURATION / 1000}s (spam)`);
    return {
      allowed:     false,
      reason:      `blacklisted`,
      retryAfterMs: BLACKLIST_DURATION,
    };
  }

  // ── Allow ────────────────────────────────────────────────────────────────
  state.lastUsed = now;
  return { allowed: true, reason: null, retryAfterMs: 0 };
}

/**
 * Returns a human-readable denial message for sending back to the user.
 * @param {{ reason: string, retryAfterMs: number }} result
 * @returns {string}
 */
function denyMessage(result) {
  const sec = Math.ceil(result.retryAfterMs / 1000);
  if (result.reason === "blacklisted") {
    return `⛔ تم تقييدك مؤقتاً بسبب الإرسال المتكرر. حاول بعد ${sec} ثانية.`;
  }
  return `⏳ يرجى الانتظار ${sec} ثانية قبل استخدام أمر آخر.`;
}

/**
 * Manually blacklists a user (e.g. from an admin command).
 * @param {string} userID
 * @param {number} durationMs
 */
function blacklist(userID, durationMs) {
  const state = getState(userID);
  state.blacklistedUntil = Date.now() + durationMs;
}

/**
 * Removes a user from the blacklist.
 * @param {string} userID
 */
function unblacklist(userID) {
  const state = getState(userID);
  state.blacklistedUntil = 0;
  state.violations = [];
}

module.exports = { check, denyMessage, blacklist, unblacklist };
