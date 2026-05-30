"use strict";

/**
 * humanSim.js — Human Activity Simulator
 *
 * Periodically makes innocuous API calls that mimic what a real user does
 * in the Messenger/Facebook app, reducing bot-detection signals.
 *
 * Activities (chosen randomly on each tick):
 *   • getUserInfo   — checking own profile
 *   • getThreadList — browsing the inbox
 *   • markAsSeen    — acknowledging the inbox
 *
 * Timing is randomised so no two ticks are at the same interval.
 */

const logger = require("./logger");

// Interval range in milliseconds (default: 8–25 minutes)
const MIN_INTERVAL = 8  * 60 * 1_000;
const MAX_INTERVAL = 25 * 60 * 1_000;

let _api       = null;
let _ownUID    = null;
let _timer     = null;
let _running   = false;

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
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Individual simulation actions ───────────────────────────────────────────

async function actGetOwnInfo() {
  return new Promise((resolve) => {
    _api.getUserInfo(_ownUID, (err) => {
      if (err) logger.warn("[HumanSim] getUserInfo failed (non-fatal)");
      resolve();
    });
  });
}

async function actBrowseInbox() {
  return new Promise((resolve) => {
    _api.getThreadList(5, null, ["INBOX"], (err) => {
      if (err) logger.warn("[HumanSim] getThreadList failed (non-fatal)");
      resolve();
    });
  });
}

async function actMarkSeen() {
  return new Promise((resolve) => {
    _api.markAsSeen((err) => {
      if (err) logger.warn("[HumanSim] markAsSeen failed (non-fatal)");
      resolve();
    });
  });
}

// ─── Activity pool ───────────────────────────────────────────────────────────

const ACTIVITIES = [
  { name: "getUserInfo",   fn: actGetOwnInfo   },
  { name: "browseInbox",   fn: actBrowseInbox  },
  { name: "markAsSeen",    fn: actMarkSeen     },
];

async function runTick() {
  if (!_running || !_api) return;

  const pick = ACTIVITIES[randInt(0, ACTIVITIES.length - 1)];
  logger.info(`[HumanSim] Activity → ${pick.name}`);

  try {
    await pick.fn();
  } catch (err) {
    // Never crash the bot due to a simulation activity
    logger.warn(`[HumanSim] Unhandled error in ${pick.name}: ${err.message || err}`);
  }

  scheduleNext();
}

function scheduleNext() {
  if (!_running) return;
  const delay = randInt(MIN_INTERVAL, MAX_INTERVAL);
  logger.info(`[HumanSim] Next activity in ${Math.round(delay / 60_000)}m`);
  _timer = setTimeout(runTick, delay);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts the human simulator.
 * @param {object} api     - fca-unofficial API instance
 * @param {string} ownUID  - the bot's own Facebook UID
 */
function start(api, ownUID) {
  if (_running) stop();
  _api     = api;
  _ownUID  = ownUID;
  _running = true;
  scheduleNext();
  logger.success("[HumanSim] Started — periodic activity simulation active.");
}

/**
 * Stops the human simulator and clears any pending timers.
 */
function stop() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

module.exports = { start, stop };
