// Webstral - service worker MV3
// Gère les appels API Mistral (chat en streaming SSE) et relaie les tokens
// vers le side panel via un port de longue durée.

const API_BASE = "https://api.mistral.ai/v1";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
});

chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
});

async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  return apiKey;
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
