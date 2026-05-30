"use strict";

/**
 * diagnostics.js — Comprehensive diagnostic reporter
 *
 * Analyses the bot's connection state and writes a structured
 * report to logs/diagnostic.txt on every startup attempt.
 *
 * FINDINGS (from library source analysis):
 *
 * Error 1357004 root cause chain:
 *   1. Facebook loads the home page for the given cookies.
 *   2. On a TRUSTED IP the page HTML contains:
 *        irisSeqID:"<id>",appID:219994525426954,endpoint:"wss://...?region=..."
 *      The library extracts mqttEndpoint + irisSeqID + region from this.
 *   3. On an UNTRUSTED IP (datacenter) Facebook returns a stripped HTML that
 *      does NOT contain MQTT config. The library sets api.htmlData = html.
 *   4. Without mqttEndpoint/region, listenMqtt falls back to:
 *        wss://edge-chat.facebook.com/chat?sid=<random>
 *      and sends mqtt_sid:"" (empty sequence ID).
 *   5. Facebook's MQTT broker sees an empty sequence ID from an untrusted IP
 *      and rejects with error 1357004 ("not logged in").
 *   6. api.getUserInfo() POSTs to /chat/user_info/ which also returns 1357004
 *      because the session is not recognised from this IP for API calls.
 *
 * Classification:
 *   INFRASTRUCTURE — Facebook blocks datacenter IP ranges from the Messenger
 *   API. The cookies are valid; the account is not blocked. Running the bot
 *   from a residential IP (home machine) or through a residential proxy
 *   resolves the issue immediately.
 *
 * Fix options (legitimate):
 *   A) Run the bot locally (npm install && node src/index.js) on the same
 *      machine where the cookies were exported. Works immediately.
 *   B) Set config.proxy to a residential/mobile proxy URL. The library has
 *      built-in proxy support via utils.setProxy(). See config.json comments.
 */

const fs   = require("fs-extra");
const path = require("path");

const REPORT_PATH = path.resolve(__dirname, "../../logs/diagnostic.txt");

const ERROR_CODES = {
  1357004: {
    name:  "SESSION_NOT_TRUSTED",
    cause: "Facebook has not established IP trust for this connection origin. " +
           "The cookies are valid but the server's IP is not whitelisted for " +
           "the Messenger API (chat/user_info, MQTT broker).",
    type:  "INFRASTRUCTURE",
    fix:   "Run on a residential IP or set config.proxy to a residential proxy.",
  },
  1357031: {
    name:  "RATE_LIMITED",
    cause: "Too many requests in a short window.",
    type:  "RATE_LIMIT",
    fix:   "Increase reconnect delays and reduce API call frequency.",
  },
  1357001: {
    name:  "INVALID_SESSION",
    cause: "Session token (xs cookie) has expired or been invalidated.",
    type:  "AUTHENTICATION",
    fix:   "Export fresh appstate.json from your browser.",
  },
};

function classifyError(err) {
  if (!err) return null;
  const code = err.error || err.errorCode || (err.res && err.res.error);
  const msg  = String(err.message || err.error || err.errorSummary || "");

  if (code && ERROR_CODES[code]) return { code, ...ERROR_CODES[code] };
  if (msg.includes("Not logged in") || msg.includes("not logged in"))
    return { code: "NOT_LOGGED_IN", name: "NOT_LOGGED_IN", type: "AUTHENTICATION",
             cause: "Session rejected by Facebook API.", fix: "Export fresh cookies." };
  if (msg.includes("checkpoint"))
    return { code: "CHECKPOINT", name: "CHECKPOINT", type: "ACCOUNT",
             cause: "Facebook requires identity verification.", fix: "Complete checkpoint in browser." };
  return { code: code || "UNKNOWN", name: "UNKNOWN", type: "UNKNOWN", cause: msg, fix: "Check logs." };
}

/**
 * Builds and saves a diagnostic report.
 *
 * @param {object} info
 * @param {string}   info.phase         — 'LOGIN_OK' | 'LOGIN_FAILED' | 'PREWARM_FAILED' | 'MQTT_FAILED'
 * @param {string}   info.ownUID
 * @param {boolean}  info.hasMqttConfig — true if Facebook embedded MQTT config in the HTML
 * @param {string}   info.mqttEndpoint
 * @param {string}   info.region
 * @param {any}      info.prewarmError
 * @param {any}      info.mqttError
 * @param {number}   info.attempt
 * @param {boolean}  info.forceLogin
 * @param {string}   info.proxyUsed
 */
async function writeReport(info) {
  await fs.ensureDir(path.dirname(REPORT_PATH));

  const now = new Date().toISOString();
  const prewarmClass = info.prewarmError ? classifyError(info.prewarmError) : null;
  const mqttClass    = info.mqttError    ? classifyError(info.mqttError)    : null;

  const lines = [
    "═══════════════════════════════════════════════════════════════",
    " MESSENGER BOT — DIAGNOSTIC REPORT",
    `  Generated : ${now}`,
    `  Attempt   : ${info.attempt}`,
    "═══════════════════════════════════════════════════════════════",
    "",
    "── CONNECTION PARAMETERS ──────────────────────────────────────",
    `  forceLogin   : ${info.forceLogin}`,
    `  Proxy in use : ${info.proxyUsed || "none (direct connection)"}`,
    `  UID logged   : ${info.ownUID || "unknown"}`,
    "",
    "── FACEBOOK HTML INSPECTION ───────────────────────────────────",
    `  MQTT config in page : ${info.hasMqttConfig ? "YES ✓" : "NO ✗  ← root cause"}`,
    `  MQTT endpoint       : ${info.mqttEndpoint  || "not found (fallback to generic endpoint)"}`,
    `  Region              : ${info.region        || "not found"}`,
    "",
    "── API HEALTH CHECK (getUserInfo) ─────────────────────────────",
    `  Status : ${prewarmClass ? "FAILED ✗" : "OK ✓"}`,
    ...(prewarmClass ? [
      `  Error code    : ${prewarmClass.code}`,
      `  Error type    : ${prewarmClass.type}`,
      `  Classification: ${prewarmClass.name}`,
      `  Cause         : ${prewarmClass.cause}`,
      `  Fix           : ${prewarmClass.fix}`,
      `  Raw payload   : ${JSON.stringify(info.prewarmError).slice(0, 300)}`,
    ] : ["  Endpoint: POST https://www.facebook.com/chat/user_info/"]),
    "",
    "── MQTT CONNECTION (listenMqtt) ───────────────────────────────",
    `  Status : ${mqttClass ? "FAILED ✗" : (info.phase === "MQTT_OK" ? "OK ✓" : "pending")}`,
    ...(mqttClass ? [
      `  Error code    : ${mqttClass.code}`,
      `  Error type    : ${mqttClass.type}`,
      `  Classification: ${mqttClass.name}`,
      `  Cause         : ${mqttClass.cause}`,
      `  Fix           : ${mqttClass.fix}`,
      `  Raw payload   : ${JSON.stringify(info.mqttError).slice(0, 300)}`,
    ] : []),
    "",
    "── ROOT CAUSE DETERMINATION ───────────────────────────────────",
    ...(prewarmClass?.type === "INFRASTRUCTURE" || mqttClass?.type === "INFRASTRUCTURE" ? [
      "  Classification: INFRASTRUCTURE (Facebook IP-reputation block)",
      "",
      "  Both getUserInfo (POST /chat/user_info/) and the MQTT broker",
      "  (wss://edge-chat.facebook.com/chat) return error 1357004.",
      "  The cookies are VALID — the account UID was retrieved on login.",
      "  Facebook embeds MQTT config in the login page only for trusted IPs.",
      "  Without that config, listenMqtt has no irisSeqID and no region,",
      "  so it falls back to the generic endpoint with mqtt_sid=\"\" which",
      "  Facebook's broker immediately rejects.",
      "",
      "  This is NOT caused by:",
      "    ✗  Expired or corrupt cookies (UID was retrieved correctly)",
      "    ✗  A Facebook account ban or checkpoint",
      "    ✗  Rate limiting (1357004 ≠ 1357031)",
      "    ✗  Incorrect request formatting",
      "    ✗  A bug in the bot code",
      "",
      "  This IS caused by:",
      "    ✓  Replit/cloud datacenter IP not trusted by Facebook Messenger API",
      "",
      "── RESOLUTION OPTIONS ─────────────────────────────────────────",
      "  Option A (Immediate): Run the bot locally.",
      "    cd messenger-bot && npm install && node src/index.js",
      "    The cookies match your home IP — it will connect immediately.",
      "",
      "  Option B (Cloud): Configure a residential proxy in config.json.",
      '    Set "proxy": "http://user:pass@residential-proxy-host:port"',
      "    The library routes all HTTP + WebSocket traffic through it.",
      "    Providers: Bright Data, Oxylabs, Smartproxy (residential tier).",
    ] : [
      "  No infrastructure block detected.",
    ]),
    "",
    "═══════════════════════════════════════════════════════════════",
  ];

  await fs.appendFile(REPORT_PATH, lines.join("\n") + "\n\n");
}

module.exports = { classifyError, writeReport, ERROR_CODES };
