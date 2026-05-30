"use strict";

const { requireAdmin } = require("../utils/admin");
const logger = require("../utils/logger");

module.exports = {
  name: "restart",
  description: "يعيد تشغيل البوت (للمشرفين فقط)",
  usage: "restart",
  adminOnly: true,

  async execute(api, event) {
    if (!(await requireAdmin(api, event))) return;

    await new Promise((resolve) => {
      api.sendMessage("🔄 جارٍ إعادة التشغيل…", event.threadID, () => resolve());
    });

    logger.warn("Restart requested by admin: " + event.senderID);

    setTimeout(() => process.exit(0), 800);
  },
};
