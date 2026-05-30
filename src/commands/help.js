"use strict";

const config = require("../../config.json");
const { isAdmin } = require("../utils/admin");

module.exports = {
  name: "help",
  description: "يعرض قائمة جميع الأوامر المتاحة",
  usage: "help",

  async execute(api, event, _args, commands) {
    const prefix = config.prefix;
    const callerIsAdmin = isAdmin(event.senderID);

    const lines = [`📋 أوامر ${config.botName}:\n`];

    for (const [, cmd] of commands.entries()) {
      const adminBadge = cmd.adminOnly ? " 👑" : "";
      if (cmd.adminOnly && !callerIsAdmin) continue;
      lines.push(`${prefix}${cmd.usage || cmd.name}${adminBadge}  —  ${cmd.description}`);
    }

    lines.push(`\n📌 البادئة: [ ${prefix} ]`);
    if (callerIsAdmin) lines.push(`👑 = أوامر المشرفين فقط`);

    await new Promise((resolve, reject) => {
      api.sendMessage(lines.join("\n"), event.threadID, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },
};
