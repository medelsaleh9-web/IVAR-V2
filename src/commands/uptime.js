"use strict";

const moment = require("moment-timezone");
const config = require("../../config.json");

const TIMEZONE  = config.timezone || "UTC";
const START_TIME = Date.now();

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0)    parts.push(`${days} يوم`);
  if (hours > 0)   parts.push(`${hours} ساعة`);
  if (minutes > 0) parts.push(`${minutes} دقيقة`);
  parts.push(`${seconds} ثانية`);

  return parts.join("، ");
}

module.exports = {
  name: "uptime",
  description: "يعرض مدة تشغيل البوت منذ آخر إعادة تشغيل",
  usage: "uptime",

  async execute(api, event) {
    const elapsed   = Date.now() - START_TIME;
    const duration  = formatDuration(elapsed);
    const startedAt = moment(START_TIME).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");

    const message =
      `⏱️ مدة التشغيل: ${duration}\n` +
      `🕐 بدأ التشغيل: ${startedAt}`;

    await new Promise((resolve, reject) => {
      api.sendMessage(message, event.threadID, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },
};
