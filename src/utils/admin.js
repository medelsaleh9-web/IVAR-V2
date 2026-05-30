"use strict";

/**
 * admin.js
 * Utilities for checking admin permissions.
 * Admins are defined by their Facebook UID in config.json → admins[].
 */

const config = require("../../config.json");

/** Cached set of admin UIDs for O(1) lookup */
const ADMIN_SET = new Set(
  (config.admins || []).map((id) => String(id).trim())
);

/**
 * Returns true if the given senderID is in the admins list.
 * @param {string|number} senderID
 * @returns {boolean}
 */
function isAdmin(senderID) {
  return ADMIN_SET.has(String(senderID).trim());
}

/**
 * Sends an "access denied" message and returns false if not admin.
 * Returns true if the user IS an admin (caller may proceed).
 *
 * @param {object} api
 * @param {object} event
 * @returns {Promise<boolean>}
 */
async function requireAdmin(api, event) {
  if (isAdmin(event.senderID)) return true;

  await new Promise((resolve) => {
    api.sendMessage(
      "⛔ هذا الأمر مخصص للمشرفين فقط.",
      event.threadID,
      () => resolve()
    );
  });

  return false;
}

module.exports = { isAdmin, requireAdmin };
