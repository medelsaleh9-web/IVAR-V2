"use strict";

/**
 * Command: غراب
 * Sends the King Message every 30 seconds in the current thread.
 * Admins can stop it with: !غراب وقف
 *
 * Intervals are stored in global.malakIntervals so they persist across
 * command re-loads and are cleaned up properly on shutdown.
 */

const { requireAdmin } = require("../utils/admin");

if (!global.malakIntervals) global.malakIntervals = {};

const kingMessage =
  `𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙆-𐎅𐏍🔴-ⵣ-👹𒉺-𝙆-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝘼-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙎-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙊-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙈-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙊-𐎅𐏍🔴-ⵣ-👹𒉺𖢣-𝙆-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙐-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙍-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝘼-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙂-𐎅𐏍🔴-ⵣ-👹𒉺-𖢣-𝙀-𐎅𐏍🔴-ⵣ-👹𒉺\n\n       \n ➣🇦🇱 𝆺𝅥⃝𝗗𝗘𝗩𝗜𝗟 ۬༐ 𝗞𝗮𝗸𝘂🇦🇱𒁂 \n  ‌                 ⏤͟͟͞͞🔴                         \n     𝑺𝑶𝑼𝑳 𝑶𝑭 𝑨 𝑾𝑨𝑹𝑹𝑰𝑶𝑹     \n ‌ ‌     ─⃝͎̽𝙎𖤌˖𝘼ɵ⃪𝆭͜͡X͎𝆭̽ʌ𝆭⃟ɴ𝙄☠️𝆺𝅥⃝𝙈✬     \n ٛ  , 𝑪𝑹𝑶𝑾𝑺  ۬ ۬  ༐  𝗠𝗢𝗡𝗦𝗧𝗘𝗥𝗦`;

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
  name: "غراب",
  description: "يرسل رسالة الملك كل 30 ثانية (للمشرفين فقط)",
  usage: "غراب | غراب وقف",
  adminOnly: true,

  async execute(api, event, args) {
    if (!(await requireAdmin(api, event))) return;

    const { threadID } = event;
    const sub = args[0];

    // ── Stop ──────────────────────────────────────────────────────────────
    if (sub === "وقف") {
      if (global.malakIntervals[threadID]) {
        clearInterval(global.malakIntervals[threadID]);
        delete global.malakIntervals[threadID];
        return promisify(api.sendMessage.bind(api), "تم ايقاف الغراب 👑🪽", threadID);
      }
      return promisify(api.sendMessage.bind(api), "الغراب غير مفعّل أصلاً!", threadID);
    }

    // ── Already running ───────────────────────────────────────────────────
    if (global.malakIntervals[threadID]) {
      return promisify(
        api.sendMessage.bind(api),
        "الغراب مفعّل بالفعل! قل !غراب وقف لإيقافه.",
        threadID
      );
    }

    // ── Activate ──────────────────────────────────────────────────────────
    await promisify(api.sendMessage.bind(api), "تم تفعيل الغراب كل 30 ثانية 👑🪽", threadID);

    global.malakIntervals[threadID] = setInterval(() => {
      api.sendMessage(kingMessage, threadID, () => {});
    }, 30_000);
  },
};
