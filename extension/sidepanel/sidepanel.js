// Netstral - UI du side panel : chat, streaming, markdown minimal.

let t = (k) => k; // remplacé au boot via settings.lang

async function bootI18n() {
  const { settings } = await chrome.storage.local.get("settings");
  const lang = NetstralI18n.resolveLang(
    settings?.lang,
    chrome.i18n?.getUILanguage?.() ?? "fr-FR"
  );
  t = NetstralI18n.makeT(lang);
  NetstralI18n.applyI18n(document, t);
  NetstralI18n.applyTheme(settings?.theme ?? "system");
  document.documentElement.lang = lang;
}

const DEFAULT_MODEL = "mistral-small-latest";
const FALLBACK_MODELS = [
  "mistral-small-latest",
  "mistral-medium-latest",
  "mistral-large-latest",
];

const chatEl = document.getElementById("chat");
const promptEl = document.getElementById("prompt");
const btnSend = document.getElementById("btn-send");
const btnNew = document.getElementById("btn-new");
const modelSelect = document.getElementById("model-select");
const errorBanner = document.getElementById("error-banner");

let conversation = []; // [{role, content}]
let streaming = false;
let port = null;

// ---------- petit moteur markdown ----------

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const out = [];
  const parts = escaped.split(/```(?:\w*\n)?/);
  // alternance : texte, bloc de code, texte, bloc de code…
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      out.push(`<pre><code>${parts[i]}</code></pre>`);
      continue;
    }
    const lines = parts[i].split("\n");
    let para = [];
    let list = null; // "ul" | "ol"

    const flushPara = () => {
      if (para.length) {
        out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out.push(`</${list}>`);
        list = null;
      }
    };

    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        flushPara();
        flushList();
        continue;
      }
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushPara();
        flushList();
        const level = h[1].length;
        out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
        continue;
      }
      const ul = t.match(/^[-*]\s+(.*)$/);
      const ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        const kind = ul ? "ul" : "ol";
        if (list !== kind) {
          flushList();
          out.push(`<${kind}>`);
          list = kind;
        }
        out.push(`<li>${renderInline((ul ?? ol)[1])}</li>`);
        continue;
      }
      flushList();
      para.push(t);
    }
    flushPara();
    flushList();
  }
  return out.join("");
}

// ---------- rendu conversation ----------

function bubble(role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  chatEl.appendChild(div);
  return div;
}

function renderConversation() {
  chatEl.innerHTML = "";
  if (conversation.length === 0) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = t("sp_hint");
    chatEl.appendChild(hint);
    return;
  }
  for (const m of conversation) {
    const el = bubble(m.role);
    el.innerHTML =
      m.role === "user" ? escapeHtml(m.content) : renderMarkdown(m.content);
    if (m.role === "assistant" && m.usage) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = t("sp_meta", {
        in: m.usage.prompt_tokens,
        out: m.usage.completion_tokens,
      });
      chatEl.appendChild(meta);
    }
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
}

// ---------- persistance ----------

async function loadState() {
  const { conversation: saved, models, defaultModel } =
    await chrome.storage.local.get(["conversation", "models", "defaultModel"]);
  conversation = Array.isArray(saved) ? saved : [];
  const list = Array.isArray(models) && models.length ? models : FALLBACK_MODELS;
  modelSelect.innerHTML = "";
  for (const id of list) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    modelSelect.appendChild(opt);
  }
  modelSelect.value = defaultModel ?? DEFAULT_MODEL;
  if (modelSelect.value === "") modelSelect.value = DEFAULT_MODEL;
}

async function saveConversation() {
  await chrome.storage.local.set({ conversation });
}

// ---------- envoi + streaming ----------

function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: "netstral-chat" });
  port.onMessage.addListener((msg) => {
    if (msg.type === "delta") {
      const last = conversation[conversation.length - 1];
      if (last?.role === "assistant") {
        last.content += msg.content;
        const el = chatEl.lastElementChild;
        el.innerHTML = renderMarkdown(last.content);
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    } else if (msg.type === "done") {
      finishStreaming();
      const last = conversation[conversation.length - 1];
      if (msg.usage && last?.role === "assistant") {
        last.usage = msg.usage;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = t("sp_meta", {
          in: msg.usage.prompt_tokens,
          out: msg.usage.completion_tokens,
        });
        chatEl.appendChild(meta);
        chatEl.scrollTop = chatEl.scrollHeight;
      }
      saveConversation();
    } else if (msg.type === "error") {
      finishStreaming();
      showError(msg.messageKey ? t(msg.messageKey) : msg.message);
      // retire l'éventuelle bulle assistant vide
      const last = conversation[conversation.length - 1];
      if (last?.role === "assistant" && !last.content) conversation.pop();
      saveConversation();
      renderConversation();
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    if (streaming) finishStreaming();
  });
  return port;
}

function setStreamingUI(on) {
  streaming = on;
  btnSend.disabled = on;
  promptEl.disabled = on;
  if (!on) promptEl.focus();
}

function finishStreaming() {
  setStreamingUI(false);
}

async function send() {
  const text = promptEl.value.trim();
  if (!text || streaming) return;
  clearError();

  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) {
    showError(t("sp_err_no_key_local"));
    return;
  }

  conversation.push({ role: "user", content: text });
  conversation.push({ role: "assistant", content: "" });
  renderConversation();
  promptEl.value = "";
  setStreamingUI(true);

  // payload = historique complet moins les bulles vides (l'assistant
  // courant n'a pas encore de contenu).
  const payload = {
    model: modelSelect.value || DEFAULT_MODEL,
    messages: conversation
      .filter((m) => m.content)
      .map(({ role, content }) => ({ role, content })),
  };
  // la bulle assistant vide courante est filtrée par `.filter(m => m.content)`.

  ensurePort().postMessage({ type: "chat", payload });
  saveConversation();
}

// ---------- événements ----------

btnSend.addEventListener("click", send);
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

btnNew.addEventListener("click", async () => {
  if (streaming) return;
  conversation = [];
  await saveConversation();
  renderConversation();
  clearError();
});

modelSelect.addEventListener("change", () => {
  chrome.storage.local.set({ defaultModel: modelSelect.value });
});

// ---------- démarrage ----------

bootI18n().then(() => loadState().then(renderConversation));
promptEl.focus();
