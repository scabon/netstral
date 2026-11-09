// Webstral - service worker MV3
// Gère les appels API Mistral (chat en streaming SSE) et relaie les tokens
// vers le side panel via un port de longue durée.

const API_BASE = "https://api.mistral.ai/v1";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
  updateBadge();
});

chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
  updateBadge();
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

// ---------- Compteur d'usage + badge ----------

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

// Met à jour le badge de l'icône : % de la consommation API du mois
// par rapport au budget configuré, vert -> orange -> rouge selon seuils.
async function updateBadge() {
  const settings = await getSettings();
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
