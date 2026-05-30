"use strict";

const config = require("../../config.json");
const { requireAdmin } = require("../utils/admin");

module.exports = {
  name: "admins",
  description: "يعرض قائمة المشرفين (للمشرفين فقط)",
  usage: "admins",
  adminOnly: true,

  async execute(api, event) {
    if (!(await requireAdmin(api, event))) return;

    const admins = config.admins || [];

    const message =
      admins.length === 0
        ? "⚠️ لا يوجد مشرفون محددون في config.json."
        : `👑 المشرفون (${admins.length}):\n` +
          admins.map((id, i) => `${i + 1}. ${id}`).join("\n");

    await new Promise((resolve, reject) => {
      api.sendMessage(message, event.threadID, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },
};
