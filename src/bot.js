"use strict";

/**
 * bot.js — Core bot engine
 *
 * ── ROOT CAUSE OF ERROR 1357004 (documented from library source analysis) ──
 *
 * Facebook returns two different HTML pages on login:
 *
 *   TRUSTED IP  → page contains:  irisSeqID, mqttEndpoint, region
 *                 listenMqtt uses the proper endpoint + sequence ID → works.
 *
 *   DATACENTER  → page contains no MQTT config (api.htmlData is set)
 *   IP (e.g.       listenMqtt falls back to the generic endpoint and sends
 *   Replit)         mqtt_sid:"" (empty). Facebook broker rejects with 1357004.
 *                  The /chat/user_info/ API also returns 1357004.
 *
 * The cookies are VALID — the account UID is always retrieved on login.
 * This is purely an IP-reputation block, not an authentication failure.
 *
 * RESOLUTION:
 *   A) Run the bot locally (same IP as the browser that exported cookies).
 *   B) Set config.proxy to a residential proxy URL (see config.json).
 *
 * ── RECONNECT STRATEGY ────────────────────────────────────────────────────
 *   • On INFRASTRUCTURE_BLOCK: slow-exponential backoff, max 15 retries.
 *   • On AUTHENTICATION error: exit immediately (no point retrying).
 *   • On CHECKPOINT: exit immediately (retrying worsens detection).
 *   • On transient MQTT errors: normal exponential backoff.
 *
 * ── OTHER FEATURES ────────────────────────────────────────────────────────
 *   • forceLogin alternates per attempt to maximise Facebook session trust.
 *   • humanSim + sessionGuard run only after a fully stable connection.
 *   • auditLog records every significant event.
 *   • Diagnostic report written to logs/diagnostic.txt on each attempt.
 */

const fs    = require("fs-extra");
const path  = require("path");
const login = require("@xaviabot/fca-unofficial");

const logger       = require("./utils/logger");
const humanSim     = require("./utils/humanSim");
const sessionGuard = require("./utils/sessionGuard");
const auditLog     = require("./utils/auditLog");
const diagnostics  = require("./utils/diagnostics");
const { handleMessage }    = require("./events/message");
const { handleGroupEvent } = require("./events/groupEvent");
const config       = require("../config.json");

// ─── Paths ────────────────────────────────────────────────────────────────────

const APPSTATE_PATH = path.resolve(__dirname, "../appstate.json");
const COMMANDS_DIR  = path.resolve(__dirname, "commands");

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_COOKIES = ["xs", "c_user"];
const BASE_DELAY       = config.reconnectDelay      || 7_000;
const MAX_DELAY        = 8 * 60 * 1_000;             // 8 minutes cap
const MAX_RETRIES      = config.maxReconnectAttempts || 15;
const STABLE_MS        = 45_000;                     // 45s of stable MQTT = healthy
const JITTER_MS        = 3_000;

// Error code classifications
const ERR_INFRA_BLOCK  = "INFRASTRUCTURE_BLOCK"; // 1357004 from untrusted IP
const ERR_AUTH         = "AUTHENTICATION";        // expired / invalidated session
const ERR_CHECKPOINT   = "CHECKPOINT";            // Facebook security challenge
const ERR_TRANSIENT    = "TRANSIENT";             // temporary / network errors

// ─── State ────────────────────────────────────────────────────────────────────

const commands = new Map();

let shuttingDown      = false;
let reconnectAttempts = 0;
let useForceLogin     = true;    // start with forceLogin:true on cloud IPs
let reconnectTimer    = null;
let stabilityTimer    = null;

// ─── Error Classification ─────────────────────────────────────────────────────

/**
 * Classifies a raw Facebook error object into one of the ERR_* categories.
 * @param {object|string} err
 * @returns {string} one of the ERR_* constants
 */
function classifyFbError(err) {
  if (!err) return ERR_TRANSIENT;

  const code = (typeof err === "object")
    ? (err.error || err.errorCode || (err.res && err.res.error))
    : null;
  const msg  = String(err.message || err.error || err.errorSummary || err || "");

  if (code === 1357004 || msg.includes("1357004")) return ERR_INFRA_BLOCK;
  if (code === 1357001)                             return ERR_AUTH;
  if (msg.toLowerCase().includes("checkpoint"))    return ERR_CHECKPOINT;
  if (msg.includes("Not logged in"))               return ERR_AUTH;

  return ERR_TRANSIENT;
}

// ─── Command Loading ──────────────────────────────────────────────────────────

async function loadCommands() {
  commands.clear();
  let files;
  try {
    files = (await fs.readdir(COMMANDS_DIR)).filter((f) => f.endsWith(".js"));
  } catch (err) {
    logger.error("Cannot read commands directory:", err);
    return;
  }

  for (const file of files) {
    try {
      const p = path.join(COMMANDS_DIR, file);
      delete require.cache[require.resolve(p)];
      const cmd = require(p);
      if (!cmd.name || typeof cmd.execute !== "function") {
        logger.warn(`Skipping ${file}: missing name or execute`);
        continue;
      }
      commands.set(cmd.name.toLowerCase(), cmd);
      logger.info(`Loaded command: ${config.prefix}${cmd.name}`);
    } catch (err) {
      logger.error(`Failed to load "${file}":`, err);
    }
  }
  logger.success(`${commands.size} command(s) loaded.`);
}

// ─── Appstate Handling ────────────────────────────────────────────────────────

async function readAppState() {
  let raw;

  // Railway Environment Variable
  if (process.env.APPSTATE) {
    try {
      raw = JSON.parse(process.env.APPSTATE);
      logger.info("Using APPSTATE from environment variable.");
    } catch (e) {
      throw new Error(
        "APPSTATE environment variable is not valid JSON: " + e.message
      );
    }
  } else {
    // Fallback to local file
    if (!(await fs.pathExists(APPSTATE_PATH))) {
      throw new Error(
        "appstate.json not found and APPSTATE variable is missing."
      );
    }

    try {
      raw = await fs.readJson(APPSTATE_PATH);
    } catch (e) {
      throw new Error("appstate.json is not valid JSON: " + e.message);
    }
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("AppState is empty or not a JSON array.");
  }

  const seen = new Map();
  const deduped = [];

  for (const c of raw) {
    const k = `${c.key}|${c.domain}|${c.path}`;
    if (!seen.has(k)) {
      seen.set(k, true);
      deduped.push(c);
    }
  }

  const keys = new Set(deduped.map((c) => c.key));
  const missing = REQUIRED_COOKIES.filter((k) => !keys.has(k));

  if (missing.length) {
    throw new Error(
      `AppState is missing required cookies: ${missing.join(", ")}`
    );
  }

  const cUser = deduped.find((c) => c.key === "c_user");

  logger.info(
    `AppState loaded — account UID: ${
      cUser ? cUser.value : "unknown"
    }`
  );

  logger.info(`Cookie count: ${deduped.length}`);

  return deduped;
}
    throw new Error("appstate.json is not valid JSON: " + e.message);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("appstate.json is empty or not a JSON array.");
  }

  // Deduplicate by composite key
  const seen    = new Map();
  const deduped = [];
  for (const c of raw) {
    const k = `${c.key}|${c.domain}|${c.path}`;
    if (!seen.has(k)) { seen.set(k, true); deduped.push(c); }
  }
  if (deduped.length < raw.length) {
    logger.warn(`Deduplicated appstate: ${raw.length} → ${deduped.length} cookies.`);
    await fs.writeJson(APPSTATE_PATH, deduped, { spaces: 2 });
  }

  // Validate required cookies
  const keys    = new Set(deduped.map((c) => c.key));
  const missing = REQUIRED_COOKIES.filter((k) => !keys.has(k));
  if (missing.length) {
    throw new Error(
      `appstate.json is missing required cookies: ${missing.join(", ")}. ` +
      "Export fresh cookies from your browser."
    );
  }

  const cUser = deduped.find((c) => c.key === "c_user");
  logger.info(`Appstate loaded — account UID: ${cUser ? cUser.value : "unknown"}`);
  logger.info(`Cookie count: ${deduped.length} | ` +
    `keys: ${deduped.map((c) => c.key).join(", ")}`);

  return deduped;
}

async function saveAppState(api) {
  try {
    const raw   = api.getAppState();
    const seen  = new Map();
    const clean = [];
    for (const c of raw) {
      const k = `${c.key}|${c.domain}|${c.path}`;
      if (!seen.has(k)) { seen.set(k, true); clean.push(c); }
    }
    await fs.writeJson(APPSTATE_PATH, clean, { spaces: 2 });
    logger.info(`Appstate refreshed and saved (${clean.length} cookies).`);
  } catch (err) {
    logger.warn("Could not save refreshed appstate: " + (err.message || err));
  }
}

// ─── Login Options ────────────────────────────────────────────────────────────

function loginOptions(forceLogin) {
  const opts = {
    logLevel:         "silent",
    selfListen:       false,
    listenEvents:     true,
    updatePresence:   false,
    autoMarkDelivery: false,
    autoMarkRead:     false,
    forceLogin:       Boolean(forceLogin),
    autoReconnect:    false,
    online:           false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  // Proxy support — set in config.json as "proxy": "http://host:port"
  // or "proxy": "socks5://user:pass@host:port"
  // A residential proxy resolves the 1357004 IP-reputation block.
  if (config.proxy && typeof config.proxy === "string") {
    opts.proxy = config.proxy;
    logger.info(`Using proxy: ${config.proxy.replace(/:[^:@]+@/, ":***@")}`);
  }

  return opts;
}

// ─── HTML Diagnostics ─────────────────────────────────────────────────────────

/**
 * Inspects api.htmlData and returns a classification string.
 * @returns {'checkpoint'|'suspicious'|'ip_mismatch'}
 */
function diagnoseHtmlData(htmlData) {
  const html = String(htmlData || "");
  if (
    html.includes("/checkpoint/block") ||
    html.includes("checkpoint/?next")  ||
    html.includes("id=\"checkpointSubmitButton\"")
  ) return "checkpoint";
  if (html.includes("suspicious") || html.includes("unusual activity"))
    return "suspicious";
  return "ip_mismatch";
}

// ─── Pre-warm ────────────────────────────────────────────────────────────────

/**
 * Calls api.getUserInfo to verify the session works for API calls.
 * Endpoint: POST https://www.facebook.com/chat/user_info/
 *
 * @returns {{ ok: boolean, error: any|null }}
 */
function preWarmSession(api, ownUID) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn("[PreWarm] Timed out after 15s — proceeding anyway.");
      resolve({ ok: false, error: new Error("timeout") });
    }, 15_000);

    logger.info("[PreWarm] POST https://www.facebook.com/chat/user_info/ ...");

    api.getUserInfo(ownUID, (err, data) => {
      clearTimeout(timeout);
      if (err) {
        const errClass = classifyFbError(err);
        const payload  = JSON.stringify(err);
        logger.warn(
          `[PreWarm] FAILED\n` +
          `  Endpoint    : POST https://www.facebook.com/chat/user_info/\n` +
          `  Error class : ${errClass}\n` +
          `  Error code  : ${err.error || "n/a"}\n` +
          `  Summary     : ${err.errorSummary || err.message || "n/a"}\n` +
          `  Description : ${err.errorDescription || "n/a"}\n` +
          `  Full payload: ${payload.slice(0, 400)}`
        );
        resolve({ ok: false, error: err });
      } else {
        const name = data && data[ownUID] ? data[ownUID].name : "unknown";
        logger.success(`[PreWarm] OK — session valid. Account name: "${name}"`);
        resolve({ ok: true, error: null });
      }
    });
  });
}

// ─── Reconnection ─────────────────────────────────────────────────────────────

/**
 * @param {boolean} flipForceLogin  — alternate forceLogin on next attempt
 * @param {string}  reason          — human-readable reason label for logs
 */
function scheduleReconnect(flipForceLogin = false, reason = "unknown") {
  if (shuttingDown) return;

  humanSim.stop();
  sessionGuard.stop();

  if (reconnectTimer)  { clearTimeout(reconnectTimer);  reconnectTimer  = null; }
  if (stabilityTimer)  { clearTimeout(stabilityTimer);  stabilityTimer  = null; }

  if (reconnectAttempts >= MAX_RETRIES) {
    logger.error(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `  ⛔  MAX RETRIES REACHED (${MAX_RETRIES})\n` +
      `  The bot cannot establish a connection from this server.\n` +
      `  See logs/diagnostic.txt for root cause and fix options.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
    auditLog.logBotEvent("BOT_STOP", `Max retries (${MAX_RETRIES}) reached — reason: ${reason}`);
    process.exit(1);
  }

  reconnectAttempts++;
  if (flipForceLogin) useForceLogin = !useForceLogin;

  const expDelay = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_DELAY);
  const jitter   = Math.floor(Math.random() * JITTER_MS);
  const delay    = expDelay + jitter;

  logger.warn(
    `Reconnecting in ${(delay / 1000).toFixed(1)}s… ` +
    `(attempt ${reconnectAttempts}/${MAX_RETRIES}, forceLogin:${useForceLogin}, reason:${reason})`
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (shuttingDown) return;
    try {
      await startBot();
    } catch (err) {
      logger.error("Re-login error:", err);
      scheduleReconnect(false, "re-login-exception");
    }
  }, delay);
}

function markStable() {
  if (reconnectAttempts > 0) {
    logger.success(`Connection stable for ${STABLE_MS / 1000}s — resetting retry counter.`);
  }
  reconnectAttempts = 0;
  // Do NOT reset useForceLogin here; keep whatever value worked so it stays consistent
}

// ─── Core Start ───────────────────────────────────────────────────────────────

async function startBot() {
  if (shuttingDown) return;

  logger.banner(`${config.botName} — Starting up`);
  auditLog.logBotEvent(
    "BOT_START",
    `attempt=${reconnectAttempts + 1} forceLogin=${useForceLogin} proxy=${config.proxy || "none"}`
  );

  await loadCommands();

  let appState;
  try {
    appState = await readAppState();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  logger.info(`Connecting to Facebook… (forceLogin: ${useForceLogin})`);

  login({ appState }, loginOptions(useForceLogin), async (loginErr, api) => {
    if (loginErr) {
      const errClass = classifyFbError(loginErr);
      const msg = loginErr instanceof Error
        ? loginErr.message
        : JSON.stringify(loginErr);

      logger.error(
        `Login failed [${errClass}]: ${msg.slice(0, 400)}`
      );

      // Authentication failures and checkpoints require manual intervention
      if (errClass === ERR_CHECKPOINT) {
        logger.error(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "  ⛔  CHECKPOINT — manual browser verification required.\n" +
          "  Log in on Facebook, complete the security check, then\n" +
          "  export fresh appstate.json and restart the bot.\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        );
        auditLog.logBotEvent("SESSION_EVENT", "CHECKPOINT — manual verification required");
        shuttingDown = true;
        process.exit(1);
      }

      scheduleReconnect(true, `login-failed:${errClass}`);
      return;
    }

    const ownUID = api.getCurrentUserID();
    logger.success(`Logged in — UID: ${ownUID}`);

    // ── Inspect HTML for MQTT config ───────────────────────────────────────
    const hasMqttConfig = !api.htmlData;
    let htmlDiagnosis   = null;
    let mqttEndpointLog = "(embedded in HTML — connection will use proper region)";

    if (api.htmlData) {
      htmlDiagnosis   = diagnoseHtmlData(api.htmlData);
      mqttEndpointLog = "(NOT found — fallback: wss://edge-chat.facebook.com/chat)";

      if (htmlDiagnosis === "checkpoint" || htmlDiagnosis === "suspicious") {
        logger.error(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "  ⛔  CHECKPOINT / SUSPICIOUS ACTIVITY DETECTED\n" +
          "  Facebook requires manual verification. Complete the\n" +
          "  security check in your browser then export fresh cookies.\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        );
        auditLog.logBotEvent("SESSION_EVENT", `${htmlDiagnosis.toUpperCase()} detected in HTML`);
        shuttingDown = true;
        process.exit(1);
      }

      // ip_mismatch — log clearly and fall through to attempt MQTT anyway
      logger.warn(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "  ⚠️  IP MISMATCH — Facebook did not embed MQTT config.\n" +
        `  Diagnosis  : ${htmlDiagnosis}\n` +
        `  MQTT host  : ${mqttEndpointLog}\n` +
        "  This server's IP is not trusted for the Messenger API.\n" +
        "  See logs/diagnostic.txt for resolution options.\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      );
      auditLog.logBotEvent("SESSION_EVENT", `IP_MISMATCH — htmlDiagnosis:${htmlDiagnosis}`);
    } else {
      logger.success("MQTT config found in HTML — region and endpoint ready.");
    }

    // ── Pre-warm: verify session works for API calls ───────────────────────
    logger.info("Verifying session health via getUserInfo…");
    const { ok: sessionOk, error: prewarmErr } = await preWarmSession(api, ownUID);

    if (!sessionOk) {
      const errClass = classifyFbError(prewarmErr);
      if (errClass === ERR_AUTH) {
        logger.error(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "  ⛔  SESSION INVALID — cookies have expired or been revoked.\n" +
          "  Export fresh appstate.json from your browser and restart.\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        );
        auditLog.logBotEvent("SESSION_EVENT", "SESSION_INVALID — cookies expired or revoked");
        process.exit(1);
      }
    }

    // ── Write diagnostic report ────────────────────────────────────────────
    diagnostics.writeReport({
      phase:        sessionOk ? "PREWARM_OK" : "PREWARM_FAILED",
      ownUID,
      hasMqttConfig,
      mqttEndpoint: mqttEndpointLog,
      region:       api.htmlData ? null : "(see MQTT endpoint URL)",
      prewarmError: prewarmErr,
      mqttError:    null,
      attempt:      reconnectAttempts + 1,
      forceLogin:   useForceLogin,
      proxyUsed:    config.proxy || null,
    }).catch(() => {});

    // ── Save refreshed appstate ────────────────────────────────────────────
    await saveAppState(api);

    logger.success(`Bot is online and listening for messages.`);
    logger.info(`Prefix: "${config.prefix}"  |  Commands: ${commands.size}`);
    if (!hasMqttConfig) {
      logger.warn(
        "MQTT is running without a sequence ID (IP mismatch). " +
        "If error 1357004 appears, see logs/diagnostic.txt for the fix."
      );
    }

    // ── Stability timer ────────────────────────────────────────────────────
    stabilityTimer = setTimeout(markStable, STABLE_MS);

    // ── Anti-detection subsystems ──────────────────────────────────────────
    if (config.humanSim?.enabled !== false) {
      humanSim.start(api, ownUID);
    }
    sessionGuard.start(api, ownUID, () => {
      logger.warn("SessionGuard triggered a proactive reconnect.");
      scheduleReconnect(false, "session-guard");
    });

    // ── MQTT Listener ──────────────────────────────────────────────────────
    logger.info(
      `Starting MQTT listener — endpoint: ${mqttEndpointLog}`
    );

    api.listenMqtt((listenErr, event) => {
      if (listenErr) {
        const errType  = listenErr.type  || "unknown";
        const errMsg   = listenErr.error || listenErr.message || JSON.stringify(listenErr);
        const errCode  = listenErr.res?.error;
        const errClass = classifyFbError(listenErr.res || listenErr);

        logger.warn(
          `[MQTT] Error received\n` +
          `  type        : ${errType}\n` +
          `  code        : ${errCode || "n/a"}\n` +
          `  class       : ${errClass}\n` +
          `  message     : ${String(errMsg).slice(0, 300)}`
        );

        // Parse errors are non-fatal — just log
        if (errType === "parse_error") {
          logger.warn(`[MQTT] Non-fatal parse event — ignoring.`);
          return;
        }

        // Infrastructure block (1357004)
        if (errClass === ERR_INFRA_BLOCK || errCode === 1357004) {
          logger.error(
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
            "  ⛔  MQTT ERROR 1357004 — INFRASTRUCTURE BLOCK\n" +
            "  Facebook's MQTT broker rejected this connection because\n" +
            "  the server IP is not trusted for the Messenger API.\n" +
            "  The cookies are valid — this is NOT an auth failure.\n" +
            "  See logs/diagnostic.txt for resolution options.\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
          );
          auditLog.logBotEvent("SESSION_EVENT", "MQTT_1357004 — infrastructure IP block");

          // Write updated diagnostic report with MQTT error
          diagnostics.writeReport({
            phase:        "MQTT_FAILED",
            ownUID,
            hasMqttConfig,
            mqttEndpoint: mqttEndpointLog,
            region:       null,
            prewarmError: prewarmErr,
            mqttError:    listenErr.res || listenErr,
            attempt:      reconnectAttempts + 1,
            forceLogin:   useForceLogin,
            proxyUsed:    config.proxy || null,
          }).catch(() => {});

          scheduleReconnect(true, "mqtt:1357004");
          return;
        }

        // Library gave up on MQTT
        if (errType === "stop_listen") {
          logger.warn(`[MQTT] stop_listen — reconnecting…`);
          scheduleReconnect(false, "mqtt:stop_listen");
          return;
        }

        // Unknown MQTT error
        logger.error(`[MQTT] Unrecognised error [${errType}] — reconnecting…`);
        scheduleReconnect(false, `mqtt:unknown:${errType}`);
        return;
      }

      if (!event) return;

      switch (event.type) {
        case "message":
        case "message_reply":
          handleMessage(api, event, commands);
          break;
        case "event":
          handleGroupEvent(api, event, commands);
          break;
        default:
          break;
      }
    });
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function shutdown() {
  shuttingDown = true;
  humanSim.stop();
  sessionGuard.stop();
  if (reconnectTimer)  clearTimeout(reconnectTimer);
  if (stabilityTimer)  clearTimeout(stabilityTimer);

  if (global.awrwaIntervals) {
    for (const id of Object.values(global.awrwaIntervals)) clearInterval(id);
    global.awrwaIntervals = {};
  }
  if (global.malakIntervals) {
    for (const id of Object.values(global.malakIntervals)) clearInterval(id);
    global.malakIntervals = {};
  }

  auditLog.logBotEvent("BOT_STOP", "Graceful shutdown requested");
}

module.exports = { startBot, shutdown };
