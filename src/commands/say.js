"use strict";

const { requireAdmin } = require("../utils/admin");

module.exports = {
  name: "say",
  description: "يجعل البوت يرسل رسالة مخصصة (للمشرفين فقط)",
  usage: "say <النص>",
  adminOnly: true,

  async execute(api, event, args) {
    if (!(await requireAdmin(api, event))) return;

    if (!args || args.length === 0) {
      await new Promise((resolve) => {
        api.sendMessage(
          "⚠️ الاستخدام: !say <النص>",
          event.threadID,
          () => resolve()
        );
      });
      return;
    }

    const text = args.join(" ");

    await new Promise((resolve, reject) => {
      api.sendMessage(text, event.threadID, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },
};
