// Webstral - page options : clé API (BYOK) + test de connexion /v1/models.

const keyInput = document.getElementById("api-key");
const btnToggle = document.getElementById("btn-toggle");
const btnTest = document.getElementById("btn-test");
const statusEl = document.getElementById("status");
const modelList = document.getElementById("model-list");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind ?? "";
}

// Charge la clé existante (affichée masquée, toggle possible).
chrome.storage.local.get("apiKey").then(({ apiKey }) => {
  keyInput.value = apiKey ?? "";
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
