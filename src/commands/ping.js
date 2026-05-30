"use strict";

module.exports = {
  name: "ping",
  description: "يتحقق من استجابة البوت ويعرض زمن الاستجابة",
  usage: "ping",

  async execute(api, event) {
    const start = Date.now();

    await new Promise((resolve, reject) => {
      api.sendMessage("🏓 Pong!", event.threadID, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const latency = Date.now() - start;

    await new Promise((resolve, reject) => {
      api.sendMessage(
        `⚡ Latency: ${latency}ms`,
        event.threadID,
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },
};
