"use strict";

/**
 * sessionGuard.js — Proactive session health monitor.
 *
 * Every CHECK_INTERVAL ms, calls api.getUserInfo(ownUID) to verify
 * the session is still valid. If the call fails, triggers a reconnect
 * BEFORE the MQTT connection silently drops — giving the bot a chance
 * to recover gracefully instead of waiting for a stale-connection timeout.
 *
 * The guard is paused automatically when no API instance is set (i.e.
 * during reconnection) and resumed once a new session is established.
 */

const logger = require("./logger");

const CHECK_INTERVAL = 12 * 60 * 1_000; // 12 minutes
const FAIL_THRESHOLD = 2;               // consecutive failures before reconnect

let _api             = null;
let _ownUID          = null;
let _onReconnect     = null;
let _timer           = null;
let _consecutiveFails = 0;
let _running         = false;

async function check() {
  if (!_running || !_api) return;

  try {
    await new Promise((resolve, reject) => {
      _api.getUserInfo(_ownUID, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Success — session is healthy
    if (_consecutiveFails > 0) {
      logger.success("[SessionGuard] Session healthy again.");
    }
    _consecutiveFails = 0;
  } catch (err) {
    _consecutiveFails++;
    const msg = err?.message || err?.error || JSON.stringify(err);
    logger.warn(`[SessionGuard] Health check failed (${_consecutiveFails}/${FAIL_THRESHOLD}): ${msg}`);

    if (_consecutiveFails >= FAIL_THRESHOLD) {
      logger.error("[SessionGuard] Session appears dead — triggering proactive reconnect.");
      _consecutiveFails = 0;
      stop();
      if (typeof _onReconnect === "function") _onReconnect();
      return;
    }
  }

  schedule();
}

function schedule() {
  if (!_running) return;
  _timer = setTimeout(check, CHECK_INTERVAL);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts the session guard.
 * @param {object}   api          - fca-unofficial API instance
 * @param {string}   ownUID       - the bot's Facebook UID
 * @param {Function} onReconnect  - callback fired when session appears dead
 */
function start(api, ownUID, onReconnect) {
  if (_running) stop();
  _api          = api;
  _ownUID       = ownUID;
  _onReconnect  = onReconnect;
  _running      = true;
  _consecutiveFails = 0;
  schedule();
  logger.success(`[SessionGuard] Started — health check every ${CHECK_INTERVAL / 60_000}m.`);
}

/**
 * Stops the session guard.
 */
function stop() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

module.exports = { start, stop };
