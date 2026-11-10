// Webstral - service worker MV3
// Gère les appels API Mistral (chat en streaming SSE) et relaie les tokens
// vers le side panel via un port de longue durée.

const API_BASE = "https://api.mistral.ai/v1";

// Le clic sur l'icône ouvre la pop-up (action.default_popup dans le
// manifest). La pop-up demande l'ouverture du panneau de chat via le
// message "openChat" : Chrome -> sidePanel.open, Firefox -> sidebarAction.open.
async function openChatPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;
  if (chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId });
  } else if (chrome.sidebarAction?.open) {
    await chrome.sidebarAction.open({ windowId });
  } else {
    throw new Error("API sidePanel/sidebarAction indisponible.");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureBudgetAlarm();
  refreshBudgetAndBadge().catch((err) =>
    console.error("budget refresh failed:", err)
  );
});

chrome.runtime.onStartup?.addListener(() => {
  ensureBudgetAlarm();
  updateBadge().catch((err) => console.error("updateBadge failed:", err));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BUDGET_ALARM) {
    refreshBudgetAndBadge().catch((err) =>
      console.error("budget refresh failed:", err)
    );
  }
});

// Rafraîchit le badge quand le budget, les seuils ou le compteur changent
// (la page options écrit, le badge doit refléter immédiatement).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.settings || changes.usage)) {
    updateBadge();
  }
});

async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  return apiKey;
}

// ---------- Usage réel du compte (session console) ----------
// Deux quantités distinctes, toutes deux lues avec le cookie de session
// Mistral (domaine .mistral.ai) du navigateur connecté :
// 1. console.mistral.ai/api/billing/credits — les crédits PAYG de la
//    console (« X€ sur Y€ ») : wallet_amount, credit_notes_amount,
//    ongoing_usage_balance. C'est la source prioritaire du badge.
// 2. admin.mistral.ai/api/local-trpc/billing.budget — le budget de
//    l'abonnement (allocation API incluse dans Vibe Pro), en second.
// Sans session (401/302/login) on retombe sur le comptage local.

const CREDITS_URL = "https://console.mistral.ai/api/billing/credits";
const BUDGET_URL =
  "https://admin.mistral.ai/api/local-trpc/billing.budget?input=" +
  encodeURIComponent('{"json":null,"meta":{"values":["undefined"],"v":1}}');
const BUDGET_TTL_MS = 60 * 60 * 1000; // 1 h
const BUDGET_ALARM = "webstral-budget-refresh";

async function fetchJsonWithSession(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let response;
  try {
    response = await fetch(url, {
      credentials: "include",
      signal: ctrl.signal,
    });
  } catch (err) {
    return { ok: false, error: `Réseau : ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
  if (response.redirected && response.url.includes("auth.mistral.ai")) {
    return { ok: false, error: "Session Mistral absente/expirée (redirigé vers la login)." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: `Session Mistral absente/expirée (HTTP ${response.status}).` };
  }
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  try {
    return { ok: true, json: await response.json() };
  } catch {
    return { ok: false, error: "Réponse non-JSON (session invalide ?)" };
  }
}

// Crédits PAYG de la console (source prioritaire).
async function fetchConsoleCredits() {
  const res = await fetchJsonWithSession(CREDITS_URL);
  if (!res.ok) return res;
  const data = res.json;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Format de réponse inattendu (credits)." };
  }
  const num = (v) => (typeof v === "number" ? v : null);
  const wallet = num(data.wallet_amount);
  const notes = num(data.credit_notes_amount);
  const ongoing = num(data.ongoing_usage_balance);
  const total =
    wallet != null || notes != null ? (wallet ?? 0) + (notes ?? 0) : null;
  const record = {
    fetchedAt: Date.now(),
    source: "console-credits",
    wallet_amount: wallet,
    credit_notes_amount: notes,
    ongoing_usage_balance: ongoing,
    spent: ongoing, // hypothèse : ongoing = consommé ; debug pour confirmer
    total,
    currency: typeof data.currency === "string" ? data.currency : "EUR",
    usage_percentage:
      total != null && total > 0 && ongoing != null
        ? (ongoing / total) * 100
        : null,
    rawNumeric: flattenNumeric(data),
    rawPreview: safePreview(data),
  };
  await chrome.storage.local.set({ consoleCredits: record });
  return { ok: true, consoleCredits: record };
}

// Aplati un objet JSON en "chemin.pointé=valeur" pour les nombres (profondeur 4).
function flattenNumeric(obj, prefix = "", depth = 0, out = {}) {
  if (depth > 4 || !obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number") out[path] = v;
    else if (v && typeof v === "object" && !Array.isArray(v))
      flattenNumeric(v, path, depth + 1, out);
  }
  return out;
}

// Aperçu JSON tronqué, sans jamais contenir de secret (endpoints billing :
// chiffres et dates uniquement).
function safePreview(data) {
  try {
    return JSON.stringify(data).slice(0, 1200);
  } catch {
    return "";
  }
}

// ---------- Diagnostic console ----------
// Sonne les endpoints candidats avec la session : statut + aperçu du corps.
// Sert à cartographier la vraie API console (non documentée) en un clic.

async function fetchSessionText(url, maxLen = 700) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let response;
  try {
    response = await fetch(url, {
      credentials: "include",
      signal: ctrl.signal,
    });
  } catch (err) {
    return { status: 0, error: `Réseau : ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
  let text = "";
  try {
    text = await response.text();
    if (maxLen != null && text.length > maxLen) text = text.slice(0, maxLen);
  } catch {
    text = "<corps illisible>";
  }
  return {
    status: response.status,
    redirected: response.redirected ? response.url : null,
    text,
  };
}

function consoleProbeUrls() {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return [
    "https://console.mistral.ai/api/billing/credits",
    "https://console.mistral.ai/api/users/organizations",
    "https://console.mistral.ai/api/v1/usage",
    `https://console.mistral.ai/api/v1/usage?start_date=${start}&end_date=${end}`,
    `https://console.mistral.ai/api/v1/usage/monthly?start_date=${start}&end_date=${end}`,
    "https://console.mistral.ai/api/v1/billing/usage",
    "https://console.mistral.ai/api/v1/billing/overview",
    "https://console.mistral.ai/api/v1/billing",
    "https://console.mistral.ai/api/usage/summary",
    "https://console.mistral.ai/api/billing/overview",
  ];
}

// Extrait tous les chemins d'API cités dans un texte de bundle JS.
// 3 stratégies (le code minifié ne cite les procédures tRPC que via des
// chaînes de propriétés, sans guillemets) :
// 1. littéraux "/api/..." ;
// 2. littéraux "billing.x.y" ;
// 3. chaînes de propriétés devant .useQuery/.useMutation/.query/.mutate
//    (ex. trpc.billing.budget.useQuery) — le premier segment (nom du client
//    minifié) est retiré.
function extractApiPaths(text) {
  const found = new Set();
  let m;
  const re = /["'`](\/(?:api|trpc|local-trpc)\/[A-Za-z0-9\-_/.{}$]{2,120})["'`]/g;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  const tre = /["'`](billing\.[A-Za-z0-9\-.]{2,60})["'`]/g;
  while ((m = tre.exec(text)) !== null) found.add(`local-trpc:${m[1]}`);
  const chainRe =
    /\b([A-Za-z0-9_$][A-Za-z0-9_$-]*(?:\.[A-Za-z0-9_$][A-Za-z0-9_$-]*){1,4})\.(?:useQuery|useMutation|useSuspenseQuery|query|mutate)\s*\(/g;
  while ((m = chainRe.exec(text)) !== null) {
    const segs = m[1].split(".");
    if (segs.length < 2) continue;
    const proc = segs.slice(1).join(".");
    if (/^[a-z]/.test(proc)) found.add(`local-trpc:${proc}`);
  }
  return [...found];
}

// Scan d'un frontend avec la session : récupère les pages, en extrait les
// bundles JS et collecte tous les chemins d'API qu'ils citent.
async function scanFrontendPages(routes) {
  const scriptUrls = new Set();
  const apiPaths = new Set();
  for (const route of routes) {
    const page = await fetchSessionText(route, 20000);
    if (!page.text || !page.text.includes("<script")) continue;
    const srcRe = /<script[^>]+src="([^"]+)"/g;
    let m;
    while ((m = srcRe.exec(page.text)) !== null) {
      let src = m[1];
      if (!src.startsWith("http")) {
        const origin = new URL(route).origin;
        src = src.startsWith("/") ? origin + src : route + "/" + src;
      }
      if (src.endsWith(".js")) scriptUrls.add(src);
    }
    for (const p of extractApiPaths(page.text)) apiPaths.add(p);
  }
  const bundles = [...scriptUrls].slice(0, 15);
  for (const url of bundles) {
    const js = await fetchSessionText(url, null); // bundles analysés en entier
    for (const p of extractApiPaths(js.text)) apiPaths.add(p);
  }
  return { routes: routes.length, bundles: bundles.length, apiPaths: [...apiPaths].sort() };
}

// Sonde les procédures local-trpc découvertes avec l'input null que l'app
// admin utilise, et renvoie statut + aperçu.
async function probeLocalTrpcProcedures(procedures, origin) {
  const nullInput = encodeURIComponent(
    '{"json":null,"meta":{"values":["undefined"],"v":1}}'
  );
  const out = [];
  for (const proc of procedures.slice(0, 15)) {
    const url = `${origin}/api/local-trpc/${proc}?input=${nullInput}`;
    const r = await fetchSessionText(url, 500);
    out.push({ proc, status: r.status, redirected: r.redirected, text: r.text });
  }
  return out;
}
// Allocation de l'abonnement (Vibe Pro) — secondaire.
// Réponse réelle (2026-11-09, sonnées via diagnostic) :
//   { ..., api_budget: {usage_percentage, initial_budget, currency, reset_at},
//     vibe_budget: {...} } — le %/budget du plan Vibe (affiché par
//     admin.mistral.ai/subscription) vit dans vibe_budget ; le top-level
//     ne reflète que l'allocation API.
async function fetchAccountBudget() {
  const res = await fetchJsonWithSession(BUDGET_URL);
  if (!res.ok) return res;
  const data = res.json?.result?.data?.json ?? res.json?.result?.data ?? null;
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Format de réponse inattendu." };
  }
  const pick = (o) =>
    o && typeof o === "object" && typeof o.usage_percentage === "number"
      ? {
          usage_percentage: o.usage_percentage,
          initial_budget: o.initial_budget ?? null,
          currency: o.currency ?? "EUR",
          reset_at: o.reset_at ?? null,
        }
      : null;
  const record = {
    fetchedAt: Date.now(),
    source: "admin-budget",
    // priorité d'affichage : vibe (page /subscription) puis api (allocation)
    vibe: pick(data.vibe_budget),
    api: pick(data.api_budget) ?? pick(data),
    rawNumeric: flattenNumeric(data),
    rawPreview: safePreview(data),
  };
  if (!record.vibe && !record.api) {
    return { ok: false, error: "Aucun budget exploitable dans la réponse." };
  }
  await chrome.storage.local.set({ accountBudget: record });
  return { ok: true, accountBudget: record };
}

// ---------- Plan du compte (gratuit / pro / entreprise) ----------
// Sonde les procédures local-trpc de la famille subscriptions/info avec la
// session : la réponse (non documentée) porte le palier du compte. Toute
// chaîne ressemblant à un nom de plan est classifiée ; l'aperçu brut est
// conservé pour debug (les options l'affichent).
const SUBSCRIPTION_PROCS = [
  "billing.subscriptions.current",
  "billing.subscription",
  "billing.subscriptions.list",
  "billing.info",
];

const NULL_INPUT = encodeURIComponent(
  '{"json":null,"meta":{"values":["undefined"],"v":1}}'
);
const subscriptionUrl = (proc) =>
  `https://admin.mistral.ai/api/local-trpc/${proc}?input=${NULL_INPUT}`;

// Aplati un objet JSON en "chemin.pointé=valeur" pour les chaînes (profondeur 5).
function flattenStrings(obj, prefix = "", depth = 0, out = {}) {
  if (depth > 5 || !obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[path] = v;
    else if (v && typeof v === "object")
      flattenStrings(v, path, depth + 1, out);
  }
  return out;
}

const PLAN_PATTERNS = [
  [/^(free|gratuit)$/i, "free"],
  [/^pro$/i, "pro"],
  [/(enterprise|entreprise)/i, "enterprise"],
  [/^(team|équipe)$/i, "team"],
  [/^scale$/i, "scale"],
  [/(trial|essai)/i, "trial"],
];

// Cherche un nom de plan dans les chaînes aplaties : d'abord les chemins
// explicites (plan/tier/subscription/…), puis toutes les autres.
function classifyPlan(strings) {
  const entries = Object.entries(strings);
  const explicit = entries.filter(([p]) =>
    /(plan|tier|subscription|level|package|name)/i.test(p)
  );
  for (const [path, v] of [...explicit, ...entries]) {
    for (const [re, label] of PLAN_PATTERNS) {
      if (re.test(v)) return { plan: label, raw: v, path };
    }
  }
  return null;
}

async function fetchSubscriptionPlan() {
  let lastError = null;
  for (const proc of SUBSCRIPTION_PROCS) {
    const res = await fetchJsonWithSession(subscriptionUrl(proc));
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    const data =
      res.json?.result?.data?.json ?? res.json?.result?.data ?? res.json ?? null;
    if (!data || typeof data !== "object") {
      lastError = "Format de réponse inattendu.";
      continue;
    }
    const strings = flattenStrings(data);
    const found = classifyPlan(strings);
    const record = {
      fetchedAt: Date.now(),
      source: `admin-trpc:${proc}`,
      plan: found?.plan ?? null,
      planRaw: found?.raw ?? null,
      planPath: found?.path ?? null,
      rawStrings: strings,
      rawPreview: safePreview(data),
    };
    await chrome.storage.local.set({ subscriptionPlan: record });
    if (found) return { ok: true, subscriptionPlan: record };
    lastError = "Réponse reçue mais aucun nom de plan reconnu.";
  }
  return { ok: false, error: lastError ?? "Aucune réponse exploitable." };
}

async function refreshBudgetAndBadge() {
  const [creditsRes, adminRes, planRes] = await Promise.allSettled([
    fetchConsoleCredits(),
    fetchAccountBudget(),
    fetchSubscriptionPlan(),
  ]);
  if (creditsRes.status === "fulfilled") {
    const r = creditsRes.value;
    await chrome.storage.local.set(
      r.ok
        ? { consoleCreditsError: null }
        : { consoleCreditsError: r.error }
    );
  }
  if (adminRes.status === "fulfilled") {
    const r = adminRes.value;
    await chrome.storage.local.set(
      r.ok ? { accountBudgetError: null } : { accountBudgetError: r.error }
    );
  }
  if (planRes.status === "fulfilled") {
    const r = planRes.value;
    await chrome.storage.local.set(
      r.ok ? { subscriptionPlanError: null } : { subscriptionPlanError: r.error }
    );
  }
  await updateBadge();
}

function ensureBudgetAlarm() {
  chrome.alarms.create(BUDGET_ALARM, { periodInMinutes: 30 });
}

// ---------- Badge ----------

const DEFAULT_SETTINGS = {
  monthlyBudgetTokens: null, // null = pas de badge
  warnPct: 70,
  dangerPct: 90,
};

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

// Cumule le usage d'un tour dans l'entrée du mois courant.
async function recordUsage(usage) {
  if (!usage) return;
  const key = monthKey();
  const { usage: all = {} } = await chrome.storage.local.get("usage");
  const cur = all[key] ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  cur.prompt_tokens += usage.prompt_tokens ?? 0;
  cur.completion_tokens += usage.completion_tokens ?? 0;
  cur.total_tokens += usage.total_tokens ?? 0;
  all[key] = cur;
  await chrome.storage.local.set({ usage: all });
}

function badgeColor(pct, settings) {
  return pct >= settings.dangerPct
    ? "#b3261e" // rouge
    : pct >= settings.warnPct
      ? "#f9a825" // orange
      : "#1a7f37"; // vert
}

// État du badge, partagé entre l'icône (updateBadge) et la pop-up
// (getPopupState) : même source prioritaire, même % et même couleur.
// Priorité des sources :
// 1. plan Vibe (admin billing.budget.vibe_budget — la page /subscription) ;
// 2. allocation API incluse dans l'abonnement (api_budget) ;
// 3. crédits PAYG de la console (wallet non nul) ;
// 4. comptage local « tokens passés par Webstral » vs budget de tokens.
// mode "account" = source 1-3, mode "local" = source 4, mode "none" = rien.
async function computeBadgeState() {
  const settings = await getSettings();
  const { consoleCredits, accountBudget, usage: all = {} } =
    await chrome.storage.local.get([
      "consoleCredits",
      "accountBudget",
      "usage",
    ]);

  const record = pickBudgetRecord(consoleCredits, accountBudget);
  if (record) {
    const pct = Math.min(100, Math.round(record.usage_percentage));
    const spent =
      record.total != null
        ? round2((record.usage_percentage / 100) * record.total)
        : null;
    return {
      mode: "account",
      source: record.source ?? null,
      label: record.label,
      pct,
      color: badgeColor(pct, settings),
      spent,
      total: record.total != null ? round2(record.total) : null,
      currency: record.currency ?? "EUR",
      resetAt: record.reset_at ?? null,
      fetchedAt: record.fetchedAt ?? null,
    };
  }

  const spentTokens = all?.[monthKey()]?.total_tokens ?? 0;
  if (!settings.monthlyBudgetTokens) {
    return {
      mode: "none",
      label: "comptage local",
      pct: null,
      color: null,
      spentTokens,
      budgetTokens: null,
    };
  }
  const pct = Math.min(
    100,
    Math.floor((spentTokens / settings.monthlyBudgetTokens) * 100)
  );
  return {
    mode: "local",
    label: "comptage local",
    pct,
    color: badgeColor(pct, settings),
    spentTokens,
    budgetTokens: settings.monthlyBudgetTokens,
  };
}

// Met à jour le badge de l'icône à partir de computeBadgeState().
async function updateBadge() {
  const state = await computeBadgeState();
  if (state.pct != null) {
    const amount =
      state.mode === "account" && state.total != null
        ? ` (${state.spent} ${state.currency} sur ${state.total} ${state.currency})`
        : "";
    await chrome.action.setTitle({
      title: `Webstral — ${state.label} : ${state.pct}%${amount}`,
    });
    await chrome.action.setBadgeBackgroundColor({ color: state.color });
    await chrome.action.setBadgeText({ text: `${state.pct}%` });
    return;
  }
  await chrome.action.setTitle({ title: "Webstral" });
  await chrome.action.setBadgeText({ text: "" });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Choisit la source de % la plus fraîche et la plus pertinente.
function pickBudgetRecord(consoleCredits, accountBudget) {
  const fresh = (rec) => rec && Date.now() - rec.fetchedAt < BUDGET_TTL_MS;
  if (fresh(accountBudget)) {
    if (accountBudget.vibe) {
      return {
        ...accountBudget.vibe,
        total: accountBudget.vibe.initial_budget,
        label: "plan Vibe",
        fetchedAt: accountBudget.fetchedAt,
        source: accountBudget.source,
      };
    }
    if (accountBudget.api) {
      return {
        ...accountBudget.api,
        total: accountBudget.api.initial_budget,
        label: "allocation API",
        fetchedAt: accountBudget.fetchedAt,
        source: accountBudget.source,
      };
    }
  }
  if (
    fresh(consoleCredits) &&
    consoleCredits.usage_percentage != null &&
    (consoleCredits.total ?? 0) > 0
  ) {
    return { ...consoleCredits, label: "crédits PAYG" };
  }
  return null;
}

// ---------- Pop-up ----------

// Snapshot complet pour la pop-up : état du badge (même calcul que
// l'icône), infos compte, plan, erreurs de session, usage local du mois.
async function getPopupState() {
  const settings = await getSettings();
  const st = await chrome.storage.local.get([
    "consoleCredits",
    "consoleCreditsError",
    "accountBudget",
    "accountBudgetError",
    "subscriptionPlan",
    "subscriptionPlanError",
    "usage",
    "apiKey",
    "models",
  ]);
  const badge = await computeBadgeState();
  const localUsage = st.usage?.[monthKey()] ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  return {
    ok: true,
    version: chrome.runtime.getManifest().version,
    badge,
    settings: {
      warnPct: settings.warnPct,
      dangerPct: settings.dangerPct,
      monthlyBudgetTokens: settings.monthlyBudgetTokens,
    },
    account: {
      consoleCredits: st.consoleCredits ?? null,
      consoleCreditsError: st.consoleCreditsError ?? null,
      accountBudget: st.accountBudget ?? null,
      accountBudgetError: st.accountBudgetError ?? null,
      subscriptionPlan: st.subscriptionPlan ?? null,
      subscriptionPlanError: st.subscriptionPlanError ?? null,
    },
    localUsage,
    hasApiKey: Boolean(st.apiKey),
    modelCount: Array.isArray(st.models) ? st.models.length : 0,
  };
}

// ---------- Chat en streaming ----------

async function streamChat(port, apiKey, { model, messages }) {
  let response;
  try {
    response = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });
  } catch (err) {
    port.postMessage({
      type: "error",
      message: `Impossible de joindre api.mistral.ai : ${err.message}`,
    });
    return;
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body?.message ?? detail;
    } catch {
      // corps non-JSON, on garde le code HTTP
    }
    port.postMessage({ type: "error", message: `Mistral API : ${detail}` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let done = false;

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) port.postMessage({ type: "delta", content: delta });
        if (chunk.usage) usage = chunk.usage;
      } catch {
        // chunk malformé : on ignore et on continue
      }
    }
  }

  port.postMessage({ type: "done", usage });
  await recordUsage(usage);
  await updateBadge();
  // refraîchit l'usage réel du compte, sans marteler les endpoints (throttle 5 min)
  const { accountBudget, consoleCredits } = await chrome.storage.local.get([
    "accountBudget",
    "consoleCredits",
  ]);
  const last = Math.max(
    accountBudget?.fetchedAt ?? 0,
    consoleCredits?.fetchedAt ?? 0
  );
  if (Date.now() - last > 5 * 60 * 1000) {
    refreshBudgetAndBadge().catch(() => {});
  }
}

// ---------- Ports (side panel) ----------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "webstral-chat") return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "chat") return;

    const apiKey = await getApiKey();
    if (!apiKey) {
      port.postMessage({
        type: "error",
        message:
          "Aucune clé API configurée. Ouvrez les options de Webstral pour la coller.",
      });
      return;
    }
    await streamChat(port, apiKey, msg.payload);
  });
});

// ---------- Messages simples (options page) ----------

const KNOWN_TRPC_PROCEDURES = [
  "billing.budget",
  "billing.info",
  "billing.usageLimits",
  "billing.subscriptions.current",
  "billing.subscriptions.list",
  "billing.subscription",
  "billing.credits",
  "billing.usage",
  "billing.payg",
  "billing.overview",
];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
// Procédures local-trpc de la famille billing, connues du
// reverse-engineering public (openchamber #1630) : sondées directement,
// sans attendre le scan des bundles.


  if (msg.type === "probeConsole") {
    (async () => {
      // 1. endpoints console candidats (session cookie)
      const results = [];
      for (const url of consoleProbeUrls()) {
        results.push(await fetchSessionText(url));
      }

      // 2. sondage direct des procédures local-trpc connues (admin host)
      const adminProbes = await probeLocalTrpcProcedures(
        KNOWN_TRPC_PROCEDURES,
        "https://admin.mistral.ai"
      );

      // 3. scan du frontend admin avec la nouvelle extraction ; toute
      // procédure découverte en plus des connues est sondée à son tour.
      let adminScan = null;
      try {
        adminScan = await scanFrontendPages([
          "https://admin.mistral.ai/subscription",
          "https://admin.mistral.ai/",
        ]);
        const found = adminScan.apiPaths
          .filter((p) => p.startsWith("local-trpc:"))
          .map((p) => p.slice("local-trpc:".length))
          .filter((p) => !KNOWN_TRPC_PROCEDURES.includes(p));
        adminScan.procedures = found;
        for (const p of found.slice(0, 5)) {
          const r = await probeLocalTrpcProcedures([p], "https://admin.mistral.ai");
          adminProbes.push(...r);
        }
      } catch (err) {
        adminScan = { error: String(err) };
      }

      // 4. scan du frontend console (pour la route du chat / clés)
      let consoleScan = null;
      try {
        consoleScan = await scanFrontendPages([
          "https://console.mistral.ai/",
          "https://console.mistral.ai/usage",
          "https://console.mistral.ai/billing",
        ]);
      } catch (err) {
        consoleScan = { error: String(err) };
      }

      sendResponse({ probes: results, adminScan, adminProbes, consoleScan });
    })();
    return true; // réponse asynchrone
  }

  if (msg.type === "openChat") {
    openChatPanel()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // réponse asynchrone
  }

  if (msg.type === "getPopupState") {
    getPopupState()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // réponse asynchrone
  }

  if (msg.type === "refreshBudget") {
    refreshBudgetAndBadge()
      .then(() =>
        chrome.storage.local.get([
          "consoleCredits",
          "consoleCreditsError",
          "accountBudget",
          "accountBudgetError",
        ])
      )
      .then(sendResponse);
    return true; // réponse asynchrone
  }

  if (msg.type !== "listModels") return false;

  (async () => {
    const apiKey = await getApiKey();
    if (!apiKey) {
      sendResponse({ ok: false, error: "Aucune clé API configurée." });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        sendResponse({
          ok: false,
          error: `Mistral API : ${res.status} ${res.statusText}`,
        });
        return;
      }
      const body = await res.json();
      const models = (body.data ?? [])
        .map((m) => m.id)
        .sort((a, b) => a.localeCompare(b));
      await chrome.storage.local.set({ models });
      sendResponse({ ok: true, models });
    } catch (err) {
      sendResponse({ ok: false, error: `Réseau : ${err.message}` });
    }
  })();

  return true; // réponse asynchrone
});
