"use strict";

/**
 * groupEvent.js — Group/thread event dispatcher
 *
 * Called for every non-message MQTT event (type = "event").
 * Iterates all loaded commands and fires their handleEvent() method
 * if they define one — allowing commands to react to group activity
 * (nickname changes, title changes, admin changes, etc.) passively.
 */

const logger = require("../utils/logger");

/**
 * Dispatches a group event to all commands that implement handleEvent.
 *
 * @param {object} api         - fca-unofficial API instance
 * @param {object} event       - MQTT event object
 * @param {Map}    commands    - loaded command map
 */
async function handleGroupEvent(api, event, commands) {
  for (const [, cmd] of commands.entries()) {
    if (typeof cmd.handleEvent !== "function") continue;
    try {
      await cmd.handleEvent(api, event);
    } catch (err) {
      logger.warn(`[GroupEvent] handleEvent error in "${cmd.name}": ${err.message || err}`);
    }
  }
}

module.exports = { handleGroupEvent };
