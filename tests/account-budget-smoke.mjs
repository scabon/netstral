// Smoke test du mode « usage réel du compte » : le message refreshBudget
// déclenche fetchAccountBudget (mock tRPC billing.budget) puis updateBadge —
// le badge doit refléter usage_percentage du compte (et non le comptage
// local). Vérifie aussi le repli local quand la session est absente (302).
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

let fetchMode = "ok"; // "ok" | "redirect"

globalThis.fetch = async (url, opts) => {
  if (String(url).includes("billing.budget")) {
    if (fetchMode === "redirect") {
      return {
        ok: true,
        redirected: true,
        url: "https://auth.mistral.ai/self-service/login/browser",
        status: 200,
      };
    }
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: "https://admin.mistral.ai/api/local-trpc/billing.budget",
      json: async () => ({
        result: {
          data: {
            json: {
              usage_percentage: 16.78,
              initial_budget: 255,
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
      get: async (k) =>
        typeof k === "string" ? { [k]: stored[k] } : Object.fromEntries((k).map((x) => [x, stored[x]])),
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

function lastText() {
  return badgeCalls.filter((c) => c[0] === "text").pop()?.[1];
}

// --- scénario 1 : session OK -> badge = % du compte
await sendRefresh();
console.log("badge après lecture compte:", lastText());
console.log("titre:", titleCalls.at(-1));
const storedBudget = stored.accountBudget;
const pass1 =
  lastText() === "17%" &&
  badgeCalls.some((c) => c[0] === "bg" && c[1] === "#1a7f37") &&
  storedBudget?.usage_percentage === 16.78 &&
  storedBudget?.initial_budget === 255 &&
  !("accountBudgetError" in stored) &&
  (titleCalls.at(-1) ?? "").includes("17%");

// --- scénario 2 : session absente, aucune donnée fraîche -> repli local
badgeCalls.length = 0;
fetchMode = "redirect";
delete stored.accountBudget;
await sendRefresh();
console.log("badge sans session:", lastText(), "| erreur:", stored.accountBudgetError);
const pass2 =
  lastText() === "0%" &&
  typeof stored.accountBudgetError === "string" &&
  stored.accountBudgetError.includes("Session");

console.log(pass1 && pass2 ? "PASS" : "FAIL");
process.exit(pass1 && pass2 ? 0 : 1);
