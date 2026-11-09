// Webstral - service worker MV3
// Gère les appels API Mistral (chat en streaming SSE) et relaie les tokens
// vers le side panel via un port de longue durée.

const API_BASE = "https://api.mistral.ai/v1";

// Cross-browser : Chrome = side panel, Firefox = sidebar.
// - Chrome : chrome.sidePanel.setPanelBehavior ouvre le side panel au clic
//   sur l'icône (l'API n'existe pas sur Firefox).
// - Firefox : chrome.sidebarAction.open() depuis le handler action.onClicked.
function setOpenPanelOnAction() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error("setPanelBehavior failed:", err));
  } else if (chrome.sidebarAction?.open) {
    chrome.action.onClicked.addListener((tab) => {
      try {
        const p = chrome.sidebarAction.open({ windowId: tab.windowId });
        p?.catch?.((err) => console.error("sidebarAction.open failed:", err));
      } catch (err) {
        console.error("sidebarAction.open failed:", err);
      }
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setOpenPanelOnAction();
  ensureBudgetAlarm();
  refreshBudgetAndBadge().catch((err) =>
    console.error("budget refresh failed:", err)
  );
});

chrome.runtime.onStartup?.addListener(() => {
  setOpenPanelOnAction();
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
    return JSON.stringify(data).slice(0, 600);
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
function extractApiPaths(text) {
  const found = new Set();
  const re = /["'`](\/(?:api|trpc|local-trpc)\/[A-Za-z0-9\-_/.{}$]{2,120})["'`]/g;
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

// Scan du frontend console avec la session : récupère les bundles JS
// chargés par les pages candidats et en extrait les chemins d'API.
async function scanConsoleFrontend() {
  const routes = [
    "https://console.mistral.ai/",
    "https://console.mistral.ai/usage",
    "https://console.mistral.ai/billing",
  ];
  const scriptUrls = new Set();
  const apiPaths = new Set();
  for (const route of routes) {
    const page = await fetchSessionText(route, 20000);
    if (!page.text || !page.text.includes("<script")) continue;
    const srcRe = /<script[^>]+src="([^"]+)"/g;
    let m;
    while ((m = srcRe.exec(page.text)) !== null) {
      const src = m[1];
      if (src.startsWith("http")) scriptUrls.add(src);
      else if (src.startsWith("/")) scriptUrls.add(`https://console.mistral.ai${src}`);
    }
    for (const p of extractApiPaths(page.text)) apiPaths.add(p);
  }
  // plafonne le nombre de bundles analysés (taille réseau)
  const bundles = [...scriptUrls].filter((u) => u.endsWith(".js")).slice(0, 12);
  for (const url of bundles) {
    const js = await fetchSessionText(url, 300000);
    for (const p of extractApiPaths(js.text)) apiPaths.add(p);
  }
  return { routes: routes.length, bundles: bundles.length, apiPaths: [...apiPaths].sort() };
}
// Allocation de l'abonnement (Vibe Pro) — secondaire.
async function fetchAccountBudget() {
  const res = await fetchJsonWithSession(BUDGET_URL);
  if (!res.ok) return res;
  const data = res.json?.result?.data?.json ?? res.json?.result?.data ?? null;
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Format de réponse inattendu." };
  }
  if (typeof data.usage_percentage !== "number") {
    return { ok: false, error: "Champ usage_percentage manquant." };
  }
  const record = {
    fetchedAt: Date.now(),
    source: "admin-budget",
    usage_percentage: data.usage_percentage,
    initial_budget: data.initial_budget ?? null,
    currency: data.currency ?? "EUR",
    reset_at: data.reset_at ?? null,
    rawNumeric: flattenNumeric(data),
    rawPreview: safePreview(data),
  };
  await chrome.storage.local.set({ accountBudget: record });
  return { ok: true, accountBudget: record };
}

async function refreshBudgetAndBadge() {
  const [creditsRes, adminRes] = await Promise.allSettled([
    fetchConsoleCredits(),
    fetchAccountBudget(),
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

// Met à jour le badge de l'icône. Priorité :
// 1. crédits PAYG de la console (ce que la console affiche, X€ sur Y€) ;
// 2. allocation de l'abonnement (admin.billing.budget) ;
// 3. comptage local « tokens passés par Webstral » vs budget de tokens ;
// 4. rien.
async function updateBadge() {
  const settings = await getSettings();
  const { consoleCredits, accountBudget } = await chrome.storage.local.get([
    "consoleCredits",
    "accountBudget",
  ]);

  const record = pickBudgetRecord(consoleCredits, accountBudget);
  if (record) {
    const pct = Math.min(100, Math.round(record.usage_percentage));
    const color =
      pct >= settings.dangerPct
        ? "#b3261e"
        : pct >= settings.warnPct
          ? "#f9a825"
          : "#1a7f37";
    const cur = record.currency ?? "EUR";
    const amount =
      record.total != null
        ? `${round2(record.usage_percentage / 100 * record.total)} ${cur} sur ${round2(record.total)} ${cur}`
        : "";
    const title =
      `Webstral — ${record.label} : ${pct}%` + (amount ? ` (${amount})` : "");
    await chrome.action.setTitle({ title });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text: `${pct}%` });
    return;
  }
  await chrome.action.setTitle({ title: "Webstral" });

  if (!settings.monthlyBudgetTokens) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const { usage: all = {} } = await chrome.storage.local.get("usage");
  const spent = all[monthKey()]?.total_tokens ?? 0;
  const pct = Math.min(
    100,
    Math.floor((spent / settings.monthlyBudgetTokens) * 100)
  );
  const color =
    pct >= settings.dangerPct
      ? "#b3261e" // rouge
      : pct >= settings.warnPct
        ? "#f9a825" // orange
        : "#1a7f37"; // vert
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text: `${pct}%` });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Choisit la source de % la plus fraîche et la plus pertinente.
function pickBudgetRecord(consoleCredits, accountBudget) {
  const fresh = (rec) => rec && Date.now() - rec.fetchedAt < BUDGET_TTL_MS;
  if (
    fresh(consoleCredits) &&
    consoleCredits.usage_percentage != null &&
    (consoleCredits.total ?? 0) > 0
  ) {
    return { ...consoleCredits, label: "crédits console" };
  }
  if (
    fresh(accountBudget) &&
    typeof accountBudget.usage_percentage === "number"
  ) {
    return {
      ...accountBudget,
      // expose initial_budget comme total pour l'affichage « sur X EUR »
      total: accountBudget.initial_budget,
      label: "allocation Vibe Pro",
    };
  }
  return null;
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "probeConsole") {
    (async () => {
      const results = [];
      for (const url of consoleProbeUrls()) {
        results.push(await fetchSessionText(url));
      }
      let scan = null;
      try {
        scan = await scanConsoleFrontend();
      } catch (err) {
        scan = { error: String(err) };
      }
      sendResponse({ probes: results, scan });
    })();
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
