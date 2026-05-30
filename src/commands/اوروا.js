"use strict";

/**
 * Command: اوروا
 * Changes the group title and continuously protects it from being changed.
 * State is persisted to commands/data/malakState.json so it survives restarts.
 *
 * Usage:
 *   !اوروا [اسم]   — change title + activate protection
 *   !اوروا وقف     — deactivate protection
 */

const fs   = require("fs-extra");
const path = require("path");
const { requireAdmin } = require("../utils/admin");
const logger = require("../utils/logger");

const statePath = path.join(__dirname, "data/malakState.json");
fs.ensureDirSync(path.dirname(statePath));

function getState() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf-8")); }
  catch { return { locks: {}, botAdmins: {}, awrwa: {} }; }
}
function saveState(s) {
  try { fs.writeFileSync(statePath, JSON.stringify(s, null, 2)); }
  catch (e) { logger.warn("[اوروا] saveState failed: " + e.message); }
}

if (!global.awrwaIntervals) global.awrwaIntervals = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function promisify(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "اوروا",
  description: "يغير اسم الكروب ويمنع تغييره (للمشرفين فقط)",
  usage: "اوروا [الاسم] | اوروا وقف",
  adminOnly: true,
  cooldown: 3,

  async execute(api, event, args) {
    if (!(await requireAdmin(api, event))) return;

    const { threadID } = event;
    const sub = args[0];

    // ── Stop protection ────────────────────────────────────────────────────
    if (sub === "وقف") {
      if (global.awrwaIntervals[threadID]) {
        clearInterval(global.awrwaIntervals[threadID]);
        delete global.awrwaIntervals[threadID];
      }
      const state = getState();
      if (state.awrwa) delete state.awrwa[threadID];
      saveState(state);
      return promisify(api.sendMessage.bind(api), "تم إيقاف حماية الاسم ✅", threadID);
    }

    // ── Validate name ──────────────────────────────────────────────────────
    const newName = args.join(" ").trim();
    if (!newName) {
      return promisify(api.sendMessage.bind(api), "يرجى كتابة اسم الكروب الجديد!", threadID);
    }

    // ── Change title ───────────────────────────────────────────────────────
    try {
      await promisify(api.setTitle.bind(api), newName, threadID);
    } catch (e) {
      return promisify(
        api.sendMessage.bind(api),
        "❌ فشل في تغيير اسم الكروب: " + (e.message || e),
        threadID
      );
    }

    // Persist
    const state = getState();
    if (!state.awrwa) state.awrwa = {};
    state.awrwa[threadID] = newName;
    saveState(state);

    await promisify(
      api.sendMessage.bind(api),
      `✅ تم تغيير اسم الكروب إلى: ${newName}\n🔒 الاسم محمي من التغيير`,
      threadID
    );

    // ── Start protection interval ──────────────────────────────────────────
    if (global.awrwaIntervals[threadID]) clearInterval(global.awrwaIntervals[threadID]);

    global.awrwaIntervals[threadID] = setInterval(async () => {
      try {
        const info  = await promisify(api.getThreadInfo.bind(api), threadID);
        const st    = getState();
        const pName = st.awrwa?.[threadID];
        if (pName && info.threadName !== pName) {
          api.setTitle(pName, threadID, () => {});
        }
      } catch (_) {}
    }, 5000);
  },
};
