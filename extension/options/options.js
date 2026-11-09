// Webstral - page options : clé API (BYOK) + test de connexion /v1/models.

const keyInput = document.getElementById("api-key");
const btnToggle = document.getElementById("btn-toggle");
const btnTest = document.getElementById("btn-test");
const statusEl = document.getElementById("status");
const modelList = document.getElementById("model-list");
const budgetInput = document.getElementById("budget");
const warnPctInput = document.getElementById("warn-pct");
const dangerPctInput = document.getElementById("danger-pct");
const usageNowEl = document.getElementById("usage-now");

const DEFAULT_SETTINGS = {
  monthlyBudgetTokens: null,
  warnPct: 70,
  dangerPct: 90,
};

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatTokens(n) {
  return n.toLocaleString("fr-FR");
}

// Charge budget/seuils et la consommation du mois, puis les affiche.
async function loadBadgeSettings() {
  const { settings, usage: all = {} } = await chrome.storage.local.get([
    "settings",
    "usage",
  ]);
  const s = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  budgetInput.value = s.monthlyBudgetTokens ?? "";
  warnPctInput.value = s.warnPct;
  dangerPctInput.value = s.dangerPct;

  const cur = all[monthKey()] ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let text =
    `Ce mois-ci : ${formatTokens(cur.total_tokens)} tokens ` +
    `(${formatTokens(cur.prompt_tokens)} in, ${formatTokens(cur.completion_tokens)} out).`;
  if (s.monthlyBudgetTokens) {
    const pct = Math.min(100, Math.floor((cur.total_tokens / s.monthlyBudgetTokens) * 100));
    text += ` Budget : ${pct}% consommé.`;
  } else {
    text += ` Définissez un budget pour activer le badge.`;
  }
  usageNowEl.textContent = text;
}

async function saveBadgeSettings() {
  const { settings: prev = {} } = await chrome.storage.local.get("settings");
  const budget =
    budgetInput.value === "" ? null : Math.max(0, Number(budgetInput.value) || 0);
  const warn = Math.min(99, Math.max(1, Number(warnPctInput.value) || 70));
  const danger = Math.min(100, Math.max(2, Number(dangerPctInput.value) || 90));
  await chrome.storage.local.set({
    settings: {
      ...prev,
      monthlyBudgetTokens: budget,
      warnPct: warn,
      dangerPct: danger,
    },
  });
}

budgetInput.addEventListener("input", saveBadgeSettings);
warnPctInput.addEventListener("input", saveBadgeSettings);
dangerPctInput.addEventListener("input", saveBadgeSettings);

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind ?? "";
}

// Charge la clé existante (affichée masquée, toggle possible).
chrome.storage.local.get("apiKey").then(({ apiKey }) => {
  keyInput.value = apiKey ?? "";
});
loadBadgeSettings();

// Le compteur d'usage bouge après un tour de chat : on se met à jour.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.usage) loadBadgeSettings();
});

// Sauvegarde la clé dès qu'elle change (débouncée).
let saveTimer = null;
keyInput.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ apiKey: keyInput.value.trim() });
  }, 400);
});

btnToggle.addEventListener("click", () => {
  keyInput.type = keyInput.type === "password" ? "text" : "password";
});

btnTest.addEventListener("click", () => {
  const value = keyInput.value.trim();
  if (!value) {
    setStatus("Collez d'abord une clé API.", "err");
    return;
  }
  // s'assure que la clé tapée est déjà persistée avant le test
  chrome.storage.local.set({ apiKey: value }).then(() => {
    setStatus("Test en cours…");
    modelList.classList.add("hidden");
    chrome.runtime.sendMessage({ type: "listModels" }, (res) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, "err");
        return;
      }
      if (!res?.ok) {
        setStatus(res?.error ?? "Erreur inconnue.", "err");
        return;
      }
      setStatus(
        `OK — ${res.models.length} modèle${res.models.length > 1 ? "s" : ""} disponibles.`,
        "ok"
      );
      modelList.innerHTML = "";
      for (const id of res.models) {
        const li = document.createElement("li");
        li.textContent = id;
        modelList.appendChild(li);
      }
      modelList.classList.remove("hidden");
    });
  });
});
