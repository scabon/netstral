// Smoke test des notifications de reset de période (bug constaté en nov. 2026
// sur Firefox Android ET sur Firefox bureau v1.0.1 : notif « quota reset »
// alors qu'aucun reset n'a eu lieu).
//
// Reproduit en local (vm, pas besoin d'Android) les lectures dégénérées de
// resetAt vues en production (cache storage / SW relancé / upgrade depuis une
// version antérieure) :
//   A. resetAt = epoch string ("1970-...") constant -> AUCUNE notif, resetNotif intact ;
//   B. resetAt qui oscille valeur valide <-> epoch/null -> UNE seule notif ;
//   C. resetAt absent (null) constant -> aucune notif ;
//   D. vrais changements de période (avancées) -> 1 notif par avancée ;
//   E. resetAt = 0 (nombre, epoch) -> AUCUNE notif (piège Date.parse(0) = an 2000) ;
//   F. resetAt = "0" (string) -> aucune notif ;
//   G. upgrade depuis v1.0.0 (période stockée "2026-11", resetAt 2026-12-01)
//      -> aucune notif, puis 1 notif au vrai reset suivant ;
//   H. oscillation vers l'arrière (resetAt < période connue) -> aucune notif,
//      période stockée conservée ;
//   I. clé stockée dégénérée ("1999-...", écrite par la v1.0.1 via reset_at=0)
//      -> aucune notif, clé réparée ;
//   J. resetAt en timestamp unix ms (nombre) -> géré comme une date ISO.
// Règle : maybeNotifyReset ne notifie que sur AVANCÉE de la période (resetAt
// strictement supérieur à la fin de la dernière période connue) ; toute
// lecture invalide est ignorée sans toucher à resetNotif.
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
stored.resetNotif = { period: "2026-11-01T00:00:00.000Z" };
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

// D. vrais changements de période (avancées) -> 1 notif par avancée
resetAt = "2026-12-01T00:00:00Z";
stored.resetNotif = { period: "2026-11-01T00:00:00.000Z" };
notifications.length = 0;
await refresh();
resetAt = "2027-01-01T00:00:00Z";
await refresh();
await refresh();
check(
  "D: deux vraies avancées de période -> exactement 2 notifs",
  resetNotifs().length === 2 && stored.resetNotif?.period?.startsWith("2027-01-01"),
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// E. resetAt = 0 (nombre, epoch) -> 0 notif (Date.parse(0) vaut ~an 2000,
//    le check ts > 0 de la v1.0.1 ne le filtrait pas), resetNotif intact
resetAt = 0;
stored.resetNotif = { period: "2026-12-01T00:00:00.000Z" };
notifications.length = 0;
await refresh();
await refresh();
check(
  "E: resetAt=0 (nombre) -> 0 notif, resetNotif non écrasé",
  resetNotifs().length === 0 && stored.resetNotif?.period === "2026-12-01T00:00:00.000Z",
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// F. resetAt = "0" (string) -> 0 notif
resetAt = "0";
stored.resetNotif = { period: "2026-12-01T00:00:00.000Z" };
notifications.length = 0;
await refresh();
check(
  'F: resetAt="0" (string) -> 0 notif',
  resetNotifs().length === 0 && stored.resetNotif?.period === "2026-12-01T00:00:00.000Z",
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// G. upgrade depuis v1.0.0 (clé legacy "2026-11" = mois calendaire) :
//    resetAt 2026-12-01 n'est PAS une avancée (fin de période 2026-12-01)
//    -> 0 notif ; le vrai reset suivant (2027-01-01) -> 1 notif
resetAt = "2026-12-01T00:00:00Z";
stored.resetNotif = { period: "2026-11" };
notifications.length = 0;
await refresh();
const gFirst = resetNotifs().length;
resetAt = "2027-01-01T00:00:00Z";
await refresh();
check(
  "G: clé legacy '2026-11' + resetAt 2026-12-01 -> 0 notif, puis 1 notif au reset 2027-01-01",
  gFirst === 0 && resetNotifs().length === 1 && stored.resetNotif?.period?.startsWith("2027-01-01"),
  `first=${gFirst} total=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// H. oscillation vers l'arrière (resetAt < période connue) -> 0 notif,
//    période stockée conservée
resetAt = "2026-11-25T00:00:00Z";
stored.resetNotif = { period: "2026-12-01T00:00:00.000Z" };
notifications.length = 0;
await refresh();
resetAt = "2026-12-01T00:00:00Z";
await refresh();
await refresh();
check(
  "H: oscillation arrière (2026-11-25 puis 2026-12-01) -> 0 notif, période conservée",
  resetNotifs().length === 0 && stored.resetNotif?.period === "2026-12-01T00:00:00.000Z",
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// I. clé stockée dégénérée "1999-12-31T23:00:00.000Z" (écrite par la v1.0.1
//    via reset_at=0) -> 0 notif, clé réparée avec la période courante
resetAt = "2026-12-01T00:00:00Z";
stored.resetNotif = { period: "1999-12-31T23:00:00.000Z" };
notifications.length = 0;
await refresh();
check(
  "I: clé dégénérée '1999-...' -> 0 notif, réparée en 2026-12-01",
  resetNotifs().length === 0 && stored.resetNotif?.period === "2026-12-01T00:00:00.000Z",
  `notifs=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

// J. resetAt en timestamp unix ms (nombre) -> même sémantique qu'une date ISO
resetAt = 1796083200000; // 2026-12-01T00:00:00.000Z
stored.resetNotif = { period: "2026-11-01T00:00:00.000Z" };
notifications.length = 0;
await refresh(); // notif attendue (avancée 2026-11-01 -> 2026-12-01)
const jFirst = resetNotifs().length;
resetAt = 1796083200000; // même valeur relue -> rien
await refresh();
resetAt = 1798761600000; // 2027-01-01T00:00:00.000Z -> notif
await refresh();
check(
  "J: resetAt en ms (nombre) -> 1 notif à l'avancée, rien à la relecture, 1 au reset suivant",
  jFirst === 1 && resetNotifs().length === 2 && stored.resetNotif?.period === "2027-01-01T00:00:00.000Z",
  `first=${jFirst} total=${resetNotifs().length} period=${stored.resetNotif?.period}`
);

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
