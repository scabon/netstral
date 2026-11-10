// Smoke test du snapshot de la pop-up (v0.3.0) :
// 1. session admin OK (vibe_budget) + plan "Pro" -> getPopupState renvoie
//    badge account/plan Vibe + subscriptionPlan.plan "pro" ;
// 2. subscription "enterprise" (billing.subscription) -> plan "enterprise" ;
// 3. aucune session -> badge en comptage local, plan inconnu.
// Usage : node tests/popup-state-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const messageListeners = [];
const stored = {
  apiKey: "k",
  settings: { monthlyBudgetTokens: 100000, warnPct: 70, dangerPct: 90 },
  usage: { "2026-11": { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
};

let mode = "pro"; // "pro" | "enterprise" | "none"

function adminBudgetJson() {
  const api = {
    usage_percentage: 0.5,
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
  return { result: { data: { json: { api_budget: api, vibe_budget: vibe } } } };
}

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("console.mistral.ai/api/billing/credits")) {
    if (mode === "none") return { ok: false, status: 401, redirected: false, url: u };
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: u,
      json: async () => ({ wallet_amount: 0, credit_notes_amount: 0, ongoing_usage_balance: 0, currency: "EUR" }),
    };
  }
  if (u.includes("local-trpc/billing.subscriptions.current")) {
    if (mode === "none") return { ok: false, status: 401, redirected: false, url: u };
    if (mode === "enterprise") return { ok: false, status: 401, redirected: false, url: u };
    if (mode === "free") {
      return {
        ok: true,
        status: 200,
        redirected: false,
        url: u,
        json: async () => ({
          result: { data: { json: { subscription: { plan: "Free" } } } },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: u,
      json: async () => ({
        result: { data: { json: { subscription: { plan: { name: "Pro" } } } } },
      }),
    };
  }
  if (u.includes("local-trpc/billing.subscription?")) {
    if (mode !== "enterprise") return { ok: false, status: 401, redirected: false, url: u };
    return {
      ok: true,
      status: 200,
      redirected: false,
      url: u,
      json: async () => ({ result: { data: { json: { tier: "enterprise" } } } }),
    };
  }
  if (u.includes("billing.budget")) {
    if (mode === "none") return { ok: false, status: 401, redirected: false, url: u };
    return { ok: true, status: 200, redirected: false, url: u, json: async () => adminBudgetJson() };
  }
  if (u.includes("local-trpc/")) {
    return { ok: false, status: 401, redirected: false, url: u };
  }
  throw new Error("fetch inattendu: " + u);
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
    getManifest: () => ({ version: "0.3.0" }),
  },
  tabs: { query: async () => [{ windowId: 1 }] },
  sidePanel: { open: async () => {} },
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
vm.runInContext(readFileSync(new URL("../extension/i18n.js", import.meta.url), "utf8") + "\n" + code, context);

function send(msg) {
  return new Promise((resolve) => {
    for (const listener of messageListeners) listener(msg, {}, resolve);
  });
}

async function scenario(name, m, checks) {
  mode = m;
  stored.consoleCredits = undefined;
  stored.accountBudget = undefined;
  stored.subscriptionPlan = undefined;
  await send({ type: "refreshBudget" });
  const st = await send({ type: "getPopupState" });
  const problems = checks(st);
  const ok = st?.ok === true && problems.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}` + (problems.length ? ` -> ${problems.join("; ")}` : ""));
  if (!ok) console.log(JSON.stringify(st, null, 1).slice(0, 1500));
  return ok;
}

const results = [];
results.push(
  await scenario("plan Vibe + Pro", "pro", (st) => {
    const p = [];
    if (st.badge?.mode !== "account") p.push(`badge.mode=${st.badge?.mode}`);
    if (st.badge?.label !== "plan Vibe") p.push(`label=${st.badge?.label}`);
    if (st.badge?.pct !== 21) p.push(`pct=${st.badge?.pct}`);
    if (st.badge?.color !== "#1a7f37") p.push(`color=${st.badge?.color}`);
    if (st.badge?.total !== 255) p.push(`total=${st.badge?.total}`);
    if (st.account?.subscriptionPlan?.plan !== "pro") p.push(`plan=${st.account?.subscriptionPlan?.plan}`);
    if (st.version !== "0.3.0") p.push(`version=${st.version}`);
    if (st.hasApiKey !== true) p.push("hasApiKey=false");
    if (st.localUsage?.total_tokens !== 15) p.push("localUsage faux");
    return p;
  })
);
results.push(
  await scenario("plan enterprise (repli billing.subscription)", "enterprise", (st) => {
    const p = [];
    if (st.account?.subscriptionPlan?.plan !== "enterprise")
      p.push(`plan=${JSON.stringify(st.account?.subscriptionPlan)}`);
    if (st.badge?.label !== "plan Vibe") p.push(`label=${st.badge?.label}`);
    return p;
  })
);
results.push(
  await scenario("plan Free reconnu (chaîne aplatie)", "free", (st) => {
    const p = [];
    if (st.account?.subscriptionPlan?.plan !== "free")
      p.push(`plan=${JSON.stringify(st.account?.subscriptionPlan)}`);
    return p;
  })
);
results.push(
  await scenario("sans session -> comptage local", "none", (st) => {
    const p = [];
    if (st.badge?.mode !== "local") p.push(`mode=${st.badge?.mode}`);
    if (st.badge?.pct !== 0) p.push(`pct=${st.badge?.pct}`);
    if (st.badge?.spentTokens !== 15) p.push(`spent=${st.badge?.spentTokens}`);
    if (st.account?.subscriptionPlan?.plan != null) p.push("plan renseigné sans session");
    if (!st.account?.accountBudgetError) p.push("pas d'erreur de session remontée");
    return p;
  })
);

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
