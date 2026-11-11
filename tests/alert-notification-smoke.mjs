// Smoke test des alertes de conso (v0.4) : notification navigateur quand le %
// franchit settings.alertPct, une seule fois par passage au-dessus du seuil,
// reset quand on redescend. Le titre/corps suivent la langue (fr ici).
// Usage : node tests/alert-notification-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const i18nCode = readFileSync(new URL("../extension/i18n.js", import.meta.url), "utf8");
const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const messageListeners = [];
const notifications = [];
let pct = 95; // % renvoyé par le mock admin (vibe_budget)
let resetAt = "2026-12-01T00:00:00Z";
const stored = {
  settings: {
    monthlyBudgetTokens: null,
    warnPct: 70,
    dangerPct: 90,
    lang: "fr",
    theme: "system",
    alertsEnabled: true,
    alertPct: 90,
    notifyOnReset: true,
  },
};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("console.mistral.ai/api/billing/credits"))
    return { ok: false, status: 401, redirected: false, url: u };
  if (u.includes("local-trpc/billing.subscription") || u.includes("local-trpc/billing.info"))
    return { ok: false, status: 401, redirected: false, url: u };
  if (u.includes("billing.budget")) {
    return {
      ok: true, status: 200, redirected: false, url: u,
      json: async () => ({
        result: {
          data: {
            json: {
              vibe_budget: {
                usage_percentage: pct,
                initial_budget: 255,
                currency: "EUR",
                reset_at: resetAt,
              },
            },
          },
        },
      }),
    };
  }
  return { ok: false, status: 401, redirected: false, url: u };
};

const chromeMock = {
  storage: {
    local: {
      get: async (k) => {
        const want = typeof k === "string" ? [k] : k;
        const out = {};
        for (const key of want) if (key in stored) out[key] = stored[key];
        return out;
      },
      set: async (obj) => Object.assign(stored, obj),
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    i18n: { getUILanguage: () => "fr-FR" },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    getManifest: () => ({ version: "0.4.0" }),
  },
  notifications: {
    create: async (opts) => {
      notifications.push(opts);
      return "id" + notifications.length;
    },
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
  alarms: { onAlarm: { addListener: () => {} }, create: () => {} },
};

const context = vm.createContext({
  chrome: chromeMock,
  console,
  fetch: globalThis.fetch,
  TextDecoder,
  TextEncoder,
  AbortController,
  Date,
  setTimeout,
  clearTimeout,
});
vm.runInContext(i18nCode + "\n" + code, context);

function send(msg) {
  return new Promise((resolve) => {
    for (const listener of messageListeners) listener(msg, {}, resolve);
  });
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// 1. 95 % >= seuil 90 -> une notification, en français
await send({ type: "refreshBudget" });
check(
  "seuil franchi -> 1 notification FR",
  notifications.length === 1 &&
    notifications[0].title.includes("95 %") &&
    notifications[0].message.includes("plan Vibe"),
  JSON.stringify(notifications[0] ?? null)
);
check("alertState posé", stored.alertState?.alertedPct === 95);

// 2. même % -> pas de doublon
await send({ type: "refreshBudget" });
check("pas de doublon au même %", notifications.length === 1);

// 3. on redescend sous le seuil -> reset, puis on remonte -> nouvelle notif
pct = 50;
await send({ type: "refreshBudget" });
check("sous le seuil -> reset alertState", stored.alertState?.alertedPct == null);
pct = 95;
await send({ type: "refreshBudget" });
check("remontée au-dessus -> nouvelle notif", notifications.length === 2);

// 4. alertes désactivées -> rien
stored.settings.alertsEnabled = false;
stored.alertState = { alertedPct: null };
await send({ type: "refreshBudget" });
check("alertes off -> pas de notif", notifications.length === 2);

// 5. changement de période (resetAt) -> notif « quota réinitialisé »
resetAt = "2027-01-01T00:00:00Z";
let before = notifications.length;
await send({ type: "refreshBudget" });
check(
  "reset de période -> notif réinitialisation",
  notifications.length === before + 1 &&
    notifications.at(-1).title.includes("réinitialisé"),
  JSON.stringify(notifications.at(-1) ?? null)
);

// 6. même période -> pas de notif reset
await send({ type: "refreshBudget" });
check("même période -> pas de notif reset", notifications.length === before + 1);

// 7. notifyOnReset désactivé -> rien même si période change
stored.settings.notifyOnReset = false;
resetAt = "2027-02-01T00:00:00Z";
await send({ type: "refreshBudget" });
check("notifyOnReset off -> pas de notif reset", notifications.length === before + 1);

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
