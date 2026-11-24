// Smoke test des notifications de reset de période (bug Firefox Android,
// constaté 2x en nov. 2026 : notif « new billing cycle » plusieurs fois par
// jour alors qu'aucun reset n'a eu lieu).
//
// Reproduit en local (vm, pas besoin d'Android) les lectures dégénérées de
// resetAt vues sur mobile (cache storage / read-modify-write concurrent du
// service worker) :
//   A. resetAt = epoch (0 / 1970) constant -> AUCUNE notif, et resetNotif
//      existant n'est pas écrasé ;
//   B. resetAt qui oscille valeur valide <-> epoch/null entre deux refresh
//      -> UNE seule notif (pour la valeur valide), jamais pour epoch/null ;
//   C. resetAt absent (null) constant -> aucune notif ;
//   D. vrai changement de période -> exactement 1 notif.
// Règle : maybeNotifyReset ne doit retenir comme période que resetAt valide
// (Date.parse fini et > 0) ; toute lecture invalide est ignorée sans toucher
// à resetNotif.
// Usage : node tests/reset-notif-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const i18nCode = readFileSync(new URL("../extension/i18n.js", import.meta.url), "utf8");
const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const messageListeners = [];
const notifications = [];
let resetAt = "2026-12-01T00:00:00Z"; // piloté par scénario (null ou epoch possibles)
const stored = {
  settings: { warnPct: 70, dangerPct: 90, lang: "fr", alertsEnabled: false, notifyOnReset: true },
  resetNotif: { period: "2026-11" }, // période précédente connue
};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("console.mistral.ai/api/billing/credits"))
    return { ok: false, status: 401, redirected: false, url: u };
  if (u.includes("billing.budget")) {
    return {
      ok: true, status: 200, redirected: false, url: u,
      json: async () => ({
        result: {
          data: {
            json: {
              vibe_budget: {
                usage_percentage: 21,
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
  if (u.includes("local-trpc/"))
    return { ok: false, status: 401, redirected: false, url: u };
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
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    getManifest: () => ({ version: "1.0.0" }),
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
const resetNotifs = () =>
  notifications.filter((n) => String(n.title).includes("réinitialisé"));

async function refresh() {
  await send({ type: "refreshBudget" });
}

// A. resetAt = epoch constant, 3 refresh -> 0 notif, resetNotif intact
resetAt = "1970-01-01T00:00:00.000Z";
notifications.length = 0;
await refresh();
await refresh();
await refresh();
check(
  "A: resetAt=epoch constant -> 0 notif reset, resetNotif non écrasé",
  resetNotifs().length === 0 && stored.resetNotif?.period === "2026-11",
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// B. oscillation valeur valide <-> epoch/null -> 1 seule notif au total
resetAt = "2026-12-01T00:00:00Z";
stored.resetNotif = { period: "2026-11" };
notifications.length = 0;
await refresh(); // notif attendue ici (2026-11 -> 2026-12)
const afterFirst = resetNotifs().length;
resetAt = "1970-01-01T00:00:00.000Z";
await refresh();
resetAt = null;
await refresh();
resetAt = "2026-12-01T00:00:00Z";
await refresh();
resetAt = "1970-01-01T00:00:00.000Z";
await refresh();
check(
  "B: oscillation valide/epoch/null -> 1 notif (au 1er refresh valide) puis plus rien",
  afterFirst === 1 && resetNotifs().length === 1 && stored.resetNotif?.period?.startsWith("2026-12-01"),
  `afterFirst=${afterFirst} total=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// C. resetAt null constant, resetNotif connu -> 0 notif, resetNotif intact
resetAt = null;
stored.resetNotif = { period: "2026-11" };
notifications.length = 0;
await refresh();
await refresh();
check(
  "C: resetAt=null constant -> 0 notif, resetNotif non écrasé",
  resetNotifs().length === 0 && stored.resetNotif?.period === "2026-11",
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// D. vrai changement de période -> 1 notif
resetAt = "2026-12-01T00:00:00Z";
stored.resetNotif = { period: "2026-11" };
notifications.length = 0;
await refresh();
resetAt = "2027-01-01T00:00:00Z";
await refresh();
await refresh();
check(
  "D: deux vrais changements de période -> exactement 2 notifs",
  resetNotifs().length === 2 && stored.resetNotif?.period?.startsWith("2027-01-01"),
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
