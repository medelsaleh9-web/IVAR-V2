"use strict";

/**
 * Command: نيم
 * 1. Silent Guardian — protects the bot's own nickname in any thread.
 *    Called automatically on group nickname-change events.
 * 2. Control Attack — bulk-renames every participant in the thread.
 *
 * Requires listenEvents: true in bot login options (group events must flow).
 */

const { requireAdmin } = require("../utils/admin");
const logger = require("../utils/logger");

if (!global.botNicknameProtection) global.botNicknameProtection = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function promisify(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "نيم",
  description: "سحق الكنيات + حماية صامتة لكنية البوت (1.5 ثانية بين كل عضو)",
  usage: "نيم [الاسم]",
  adminOnly: true,

  /**
   * Silent Guardian — fires on group events (nickname changes).
   * Automatically restores the bot's nickname if someone changes it.
   */
  async handleEvent(api, event) {
    try {
      const { threadID, logMessageType, logMessageData, author } = event;
      if (logMessageType !== "log:user-nickname") return;

      const protection = global.botNicknameProtection[threadID];
      if (!protection) return;

      const botID = api.getCurrentUserID();
      if (logMessageData?.targetID === botID && author !== botID) {
        api.changeNickname(protection.name, threadID, botID, () => {});
      }
    } catch (err) {
      logger.warn("[نيم] handleEvent error: " + (err.message || err));
    }
  },

  /**
   * Bulk-rename all participants and activate the guardian.
   */
  async execute(api, event, args) {
    if (!(await requireAdmin(api, event))) return;

    const { threadID } = event;
    const name = args.join(" ").trim();

    if (!name) {
      return promisify(api.sendMessage.bind(api), "❌ حدد الاسم يا زعيم!", threadID);
    }

    const botID = api.getCurrentUserID();
    global.botNicknameProtection[threadID] = { name, botID };

    await promisify(
      api.sendMessage.bind(api),
      "👁️‍🗨️ أمرك أيها الزعيم.. جاري سحق هوياتهم بكل هدوء الآن!",
      threadID
    );

    let threadInfo;
    try {
      threadInfo = await promisify(api.getThreadInfo.bind(api), threadID);
    } catch (err) {
      logger.warn("[نيم] getThreadInfo failed: " + (err.message || err));
      return promisify(api.sendMessage.bind(api), "❌ تعذّر جلب قائمة الأعضاء.", threadID);
    }

    const allUsers = threadInfo.participantIDs || [];
    let changed = 0;

    for (const uid of allUsers) {
      try {
        await promisify(api.changeNickname.bind(api), name, threadID, uid);
        changed++;
      } catch (_) {}
      await sleep(1500);  // 1.5 s between each rename — human pacing
    }

    await promisify(
      api.sendMessage.bind(api),
      `✅ تم تغيير كنية ${changed}/${allUsers.length} عضو.\n🛡️ حماية كنية البوت مفعّلة.`,
      threadID
    );
  },
};
