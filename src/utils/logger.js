"use strict";

/**
 * Professional logger with colored terminal output.
 * Uses chalk v4 (CommonJS-compatible).
 */

const chalk = require("chalk");
const moment = require("moment-timezone");
const config = require("../../config.json");

const TIMEZONE = config.timezone || "UTC";

/** Returns formatted timestamp in the configured timezone */
function timestamp() {
  return moment().tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");
}

/** Pads label to fixed width for aligned output */
function label(text, width = 7) {
  return text.padEnd(width);
}

const logger = {
  info(msg) {
    console.log(
      chalk.gray(`[${timestamp()}]`) +
        " " +
        chalk.bgBlue.white.bold(` ${label("INFO")} `) +
        " " +
        chalk.white(msg)
    );
  },

  success(msg) {
    console.log(
      chalk.gray(`[${timestamp()}]`) +
        " " +
        chalk.bgGreen.black.bold(` ${label("OK")} `) +
        " " +
        chalk.green(msg)
    );
  },

  warn(msg) {
    console.warn(
      chalk.gray(`[${timestamp()}]`) +
        " " +
        chalk.bgYellow.black.bold(` ${label("WARN")} `) +
        " " +
        chalk.yellow(msg)
    );
  },

  error(msg, err) {
    console.error(
      chalk.gray(`[${timestamp()}]`) +
        " " +
        chalk.bgRed.white.bold(` ${label("ERROR")} `) +
        " " +
        chalk.red(msg)
    );
    if (err && err.stack) {
      console.error(chalk.red(err.stack));
    }
  },

  message(senderID, threadID, body) {
    console.log(
      chalk.gray(`[${timestamp()}]`) +
        " " +
        chalk.bgCyan.black.bold(` ${label("MSG")} `) +
        " " +
        chalk.cyan(`[${threadID}] ${senderID}`) +
        chalk.white(` → `) +
        chalk.white(body)
    );
  },

  command(command, senderID) {
    console.log(
      chalk.gray(`[${timestamp()}]`) +
        " " +
        chalk.bgMagenta.white.bold(` ${label("CMD")} `) +
        " " +
        chalk.magenta(`${command}`) +
        chalk.white(` by `) +
        chalk.magenta(senderID)
    );
  },

  banner(title) {
    const line = "─".repeat(50);
    console.log("\n" + chalk.cyan(line));
    console.log(chalk.cyan.bold(`  🤖  ${title}`));
    console.log(chalk.cyan(line) + "\n");
  },
};

module.exports = logger;
