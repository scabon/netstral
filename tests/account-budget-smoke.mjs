// Smoke test des sources d'usage du compte (v0.2.8) :
// 1. admin billing.budget avec vibe_budget -> badge « plan Vibe » (prioritaire) ;
// 2. console credits (PAYG) en l'absence de session admin -> badge « crédits PAYG » ;
// 3. admin avec api_budget seulement (pas de vibe_budget) -> badge « allocation API » ;
// 4. aucune session -> comptage local.
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
let adminMode = "ok"; // "ok" | "ok-no-vibe" | "401"

function adminBudgetJson() {
  const api = {
    usage_percentage: 0.0027052,
    initial_budget: 25.5,
    currency: "EUR",
    reset_at: "2026-12-01T00:00:00Z",
  };
  const vibe = {
    usage_percentage: 21.22895086666667,
    initial_budget: 255,
    currency: "EUR",
    reset_at: "2026-12-01T00:00:00Z",
  };
  return {
    result: {
      data: {
        json: {
          ...api,
          api_budget: api,
          ...(adminMode === "ok" ? { vibe_budget: vibe } : {}),
        },
      },
    },
  };
}

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
      json: async () => adminBudgetJson(),
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
    i18n: { getUILanguage: () => "fr-FR" },
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
vm.runInContext(readFileSync(new URL("../extension/i18n.js", import.meta.url), "utf8") + "\n" + code, context);

function sendRefresh() {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      listener({ type: "refreshBudget" }, {}, resolve);
    }
  });
}

const lastText = () => badgeCalls.filter((c) => c[0] === "text").pop()?.[1];

async function scenario(name, cMode, aMode, expectedBadge, expectedTitlePart) {
  creditsMode = cMode;
  adminMode = aMode;
  badgeCalls.length = 0;
  titleCalls.length = 0;
  stored.consoleCredits = null;
  stored.accountBudget = null;
  await sendRefresh();
  const text = lastText();
  const title = titleCalls.at(-1) ?? "";
  const ok = text === expectedBadge && title.includes(expectedTitlePart);
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: badge=${text} titre="${title.slice(0, 70)}"`
  );
  return ok;
}

const results = [];
results.push(
  await scenario(
    "vibe_budget prioritaire (21.23% de 255)",
    "ok",
    "ok",
    "21%",
    "plan Vibe"
  )
);
results.push(
  await scenario(
    "PAYG console quand admin 401 (42.78/255)",
    "ok",
    "401",
    "17%",
    "crédits PAYG"
  )
);
results.push(
  await scenario(
    "allocation API quand vibe_budget absent",
    "401",
    "ok-no-vibe",
    "0%",
    "allocation API"
  )
);
results.push(
  await scenario("aucune session -> comptage local", "401", "401", "0%", "")
);

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
