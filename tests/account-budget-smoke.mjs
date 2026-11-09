// Smoke test des sources d'usage du compte (v0.2.3) :
// 1. crédits console (/api/billing/credits) présents -> badge prioritaire ;
// 2. crédits console en erreur + allocation admin (billing.budget) OK ->
//    badge sur l'allocation ;
// 3. aucune session + budget local -> badge sur le comptage local (0%).
// Usage : node tests/account-budget-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const messageListeners = [];
const badgeCalls = [];
const titleCalls = [];
const stored = {
  apiKey: "k",
  settings: { monthlyBudgetTokens: 100, warnPct: 70, dangerPct: 90 },
};

let creditsMode = "ok"; // "ok" | "401"
let adminMode = "ok"; // "ok" | "401"

globalThis.fetch = async (url, opts) => {
  if (String(url).includes("console.mistral.ai/api/billing/credits")) {
    if (creditsMode === "401") return { ok: false, status: 401, redirected: false, url };
    return {
      ok: true,
      status: 200,
      redirected: false,
      url,
      json: async () => ({
        wallet_amount: 255,
        credit_notes_amount: 0,
        ongoing_usage_balance: 42.78,
        currency: "EUR",
      }),
    };
  }
  if (String(url).includes("billing.budget")) {
    if (adminMode === "401") return { ok: false, status: 401, redirected: false, url };
    return {
      ok: true,
      status: 200,
      redirected: false,
      url,
      json: async () => ({
        result: {
          data: {
            json: {
              usage_percentage: 0,
              initial_budget: 25.5,
              currency: "EUR",
              reset_at: "2026-12-01T00:00:00Z",
            },
          },
        },
      }),
    };
  }
  throw new Error("fetch inattendu: " + url);
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
      remove: async (k) => {
        for (const key of Array.isArray(k) ? k : [k]) delete stored[key];
      },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
  },
  sidePanel: { setPanelBehavior: async () => {} },
  action: {
    setBadgeText: async ({ text }) => badgeCalls.push(["text", text]),
    setBadgeBackgroundColor: async ({ color }) => badgeCalls.push(["bg", color]),
    setTitle: async ({ title }) => titleCalls.push(title),
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {},
  },
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
vm.runInContext(code, context);

function sendRefresh() {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      listener({ type: "refreshBudget" }, {}, resolve);
    }
  });
}

const lastText = () => badgeCalls.filter((c) => c[0] === "text").pop()?.[1];

async function scenario(name, cMode, aMode, expected) {
  creditsMode = cMode;
  adminMode = aMode;
  badgeCalls.length = 0;
  titleCalls.length = 0;
  stored.consoleCredits = null;
  stored.accountBudget = null;
  await sendRefresh();
  const text = lastText();
  const title = titleCalls.at(-1) ?? "";
  console.log(
    `${name}: badge=${text} titre="${title.slice(0, 70)}"`
  );
  return text === expected;
}

const pass1 = await scenario(
  "crédits console OK (42.78/255)",
  "ok",
  "ok",
  "17%"
);
const pass1b = titleCalls.at(-1)?.includes("crédits console");

const pass2 = await scenario(
  "credits en erreur -> allocation admin (25.50)",
  "401",
  "ok",
  "0%"
);
const pass2b = titleCalls.at(-1)?.includes("allocation Vibe Pro");

const pass3 = await scenario("aucune session -> local (0%)", "401", "401", "0%");

console.log(
  pass1 && pass1b && pass2 && pass2b && pass3 ? "PASS" : "FAIL",
  JSON.stringify({ pass1, pass1b, pass2, pass2b, pass3 })
);
process.exit(
  pass1 && pass1b && pass2 && pass2b && pass3 ? 0 : 1
);
