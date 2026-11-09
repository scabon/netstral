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
// Le % « X€ sur Y€ » affiché par la console/account Mistral est servi par
// le BFF tRPC de l'app de facturation : GET admin.mistral.ai/api/local-trpc/
// billing.budget, authentifié par le cookie de session Ory (domaine
// .mistral.ai). On le lit avec les cookies du navigateur connecté ;
// sans session (401/302/login) on retombe sur le comptage local.

const BUDGET_URL =
  "https://admin.mistral.ai/api/local-trpc/billing.budget?input=" +
  encodeURIComponent('{"json":null,"meta":{"values":["undefined"],"v":1}}');
const BUDGET_TTL_MS = 60 * 60 * 1000; // 1 h
const BUDGET_ALARM = "webstral-budget-refresh";

async function fetchAccountBudget() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let response;
  try {
    response = await fetch(BUDGET_URL, {
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
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Réponse non-JSON (session invalide ?)" };
  }
  const data = body?.result?.data?.json ?? body?.result?.data ?? null;
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Format de réponse inattendu." };
  }
  if (typeof data.usage_percentage !== "number") {
    return { ok: false, error: "Champ usage_percentage manquant." };
  }
  const record = {
    fetchedAt: Date.now(),
    usage_percentage: data.usage_percentage,
    initial_budget: data.initial_budget ?? null,
    currency: data.currency ?? "EUR",
    reset_at: data.reset_at ?? null,
    rawNumeric: Object.fromEntries(
      Object.entries(data).filter(([, v]) => typeof v === "number")
    ),
  };
  await chrome.storage.local.set({ accountBudget: record });
  return { ok: true, accountBudget: record };
}

async function refreshBudgetAndBadge() {
  const res = await fetchAccountBudget();
  if (!res.ok) {
    // la donnée précédente reste affichée si elle est encore fraîche ;
    // sinon updateBadge retombera sur le comptage local.
    await chrome.storage.local.set({ accountBudgetError: res.error });
  } else {
    await chrome.storage.local.remove("accountBudgetError");
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

// Met à jour le badge de l'icône. Priorité : usage réel du compte lu
// depuis la session Mistral (billing.budget) ; sinon comptage local
// « tokens passés par Webstral » vs budget de tokens ; sinon rien.
async function updateBadge() {
  const settings = await getSettings();
  const { accountBudget } = await chrome.storage.local.get("accountBudget");

  if (
    accountBudget &&
    Date.now() - accountBudget.fetchedAt < BUDGET_TTL_MS &&
    typeof accountBudget.usage_percentage === "number"
  ) {
    const pct = Math.min(100, Math.round(accountBudget.usage_percentage));
    const color =
      pct >= settings.dangerPct
        ? "#b3261e"
        : pct >= settings.warnPct
          ? "#f9a825"
          : "#1a7f37";
    const budget = accountBudget.initial_budget;
    const cur = accountBudget.currency ?? "EUR";
    const title =
      budget != null
        ? `Webstral — consommation du compte : ${pct}% de ${budget} ${cur}`
        : `Webstral — consommation du compte : ${pct}%`;
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
  // refraîchit l'usage réel du compte, sans marteler le BFF (throttle 5 min)
  const { accountBudget } = await chrome.storage.local.get("accountBudget");
  if (!accountBudget || Date.now() - accountBudget.fetchedAt > 5 * 60 * 1000) {
    fetchAccountBudget().then(() => updateBadge());
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
  if (msg.type === "refreshBudget") {
    refreshBudgetAndBadge()
      .then(() =>
        chrome.storage.local.get(["accountBudget", "accountBudgetError"])
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
