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
const btnBudget = document.getElementById("btn-budget");
const budgetStatusEl = document.getElementById("budget-status");
const budgetViewEl = document.getElementById("budget-view");
const budgetDebugEl = document.getElementById("budget-debug");

const fmtEUR = (n, cur = "EUR") =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

// yyyy-MM-dd en UTC (les reset Mistral sont à 00:00:00Z).
const fmtDateUTC = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

const BUDGET_LABELS = {
  "console-credits": "Crédits console (wallet PAYG)",
  "admin-budget": "Abonnement Mistral",
};

function renderBudgetView() {
  chrome.storage.local
    .get([
      "consoleCredits",
      "consoleCreditsError",
      "accountBudget",
      "accountBudgetError",
      "subscriptionPlan",
      "subscriptionPlanError",
    ])
    .then((st) => {
      const lines = [];
      const debug = [];

      // Crédits console — source prioritaire
      if (st.consoleCredits && st.consoleCredits.usage_percentage != null) {
        const c = st.consoleCredits;
        const pct = Math.min(100, Math.round(c.usage_percentage));
        const part =
          c.total != null
            ? ` — ${fmtEUR(c.spent, c.currency)} sur ${fmtEUR(c.total, c.currency)}`
            : "";
        const age = Math.round((Date.now() - c.fetchedAt) / 60000);
        lines.push(
          `<strong>${BUDGET_LABELS["console-credits"]} :</strong> ${pct}%${part} (lu il y a ${age} min)`
        );
        debug.push(
          "champs console : " +
            Object.entries(c.rawNumeric)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
        );
      } else if (st.consoleCredits && st.consoleCredits.total != null) {
        // champs reconnus
        const c = st.consoleCredits;
        const age = Math.round((Date.now() - c.fetchedAt) / 60000);
        if (c.total === 0) {
          lines.push(
            `<strong>${BUDGET_LABELS["console-credits"]} :</strong> vide — aucun crédit prépayé (lu il y a ${age} min)`
          );
        } else {
          lines.push(
            `<strong>${BUDGET_LABELS["console-credits"]} :</strong> ${fmtEUR(c.spent ?? 0, c.currency)} consommés sur ${fmtEUR(c.total, c.currency)} (lu il y a ${age} min)`
          );
        }
      } else if (st.consoleCredits) {
        // réponse reçue mais structure inconnue
        lines.push(
          `<strong>${BUDGET_LABELS["console-credits"]} :</strong> lu, mais champs non reconnus — voir diagnostic`
        );
        debug.push(
          "aperçu credits : " + (st.consoleCredits.rawPreview || "(vide)")
        );
      } else if (st.consoleCreditsError) {
        lines.push(
          `<strong>${BUDGET_LABELS["console-credits"]} :</strong> ${st.consoleCreditsError}`
        );
      } else {
        lines.push(
          `<strong>${BUDGET_LABELS["console-credits"]} :</strong> pas encore lu`
        );
      }

      // Admin billing.budget : plan Vibe (page /subscription) + allocation API
      if (st.accountBudget) {
        const a = st.accountBudget;
        const subLine = (sub, label) => {
          if (!sub) return null;
          const pct = Math.min(100, Math.round(sub.usage_percentage));
          const part =
            sub.initial_budget != null
              ? ` — ${fmtEUR((sub.usage_percentage / 100) * sub.initial_budget, sub.currency)} sur ${fmtEUR(sub.initial_budget, sub.currency)}`
              : "";
          let extra = "";
          if (sub.reset_at) {
            extra = ` (réinitialisé le ${fmtDateUTC(sub.reset_at)})`;
          }
          return `<strong>${label} :</strong> ${pct}%${part}${extra}`;
        };
        lines.push(
          subLine(a.vibe, "Plan Vibe (page abonnement)") ??
            "<strong>Plan Vibe</strong> : absent de la réponse"
        );
        const apiLine = subLine(a.api, "Allocation API incluse");
        if (apiLine) lines.push(apiLine);
        debug.push("champs admin : " + (a.rawPreview || "(vide)"));
      } else if (st.accountBudgetError) {
        lines.push(`<strong>Abonnement :</strong> ${st.accountBudgetError}`);
      }

      // Type de plan (gratuit / pro / entreprise) — sonde subscriptions.*
      if (st.subscriptionPlan) {
        const sp = st.subscriptionPlan;
        const age = Math.round((Date.now() - sp.fetchedAt) / 60000);
        lines.push(
          sp.plan
            ? `<strong>Type de plan :</strong> ${sp.plan} (${sp.planRaw}, ${sp.planPath}, lu il y a ${age} min)`
            : `<strong>Type de plan :</strong> non reconnu — brut ci-dessous (lu il y a ${age} min)`
        );
        debug.push("plan source : " + sp.source);
        debug.push("plan brut : " + (sp.rawPreview || "(vide)"));
        const rs = Object.entries(sp.rawStrings ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        if (rs) debug.push("chaînes : " + rs.slice(0, 600));
      } else if (st.subscriptionPlanError) {
        lines.push(`<strong>Type de plan :</strong> ${st.subscriptionPlanError}`);
      }

      budgetViewEl.innerHTML = lines.join("<br>");
      if (debug.length) {
        budgetDebugEl.textContent = debug.join(" — ");
        budgetDebugEl.classList.remove("hidden");
      }
      const badgeSource = st.accountBudget?.vibe
        ? "plan Vibe"
        : st.accountBudget?.api
          ? "allocation API"
          : st.consoleCredits && st.consoleCredits.usage_percentage != null
            ? "crédits PAYG"
            : null;
      budgetStatusEl.textContent = badgeSource
        ? `Badge : ${badgeSource}`
        : "Badge : comptage local";
      budgetStatusEl.className = badgeSource ? "ok" : "";
    });
}

const btnProbe = document.getElementById("btn-probe");
const probeViewEl = document.getElementById("probe-view");

btnProbe.addEventListener("click", () => {
  probeViewEl.classList.remove("hidden");
  probeViewEl.textContent = "Sondage en cours…";
  chrome.runtime.sendMessage({ type: "probeConsole" }, (res) => {
    if (chrome.runtime.lastError) {
      probeViewEl.textContent = chrome.runtime.lastError.message;
      return;
    }
    const lines = [];
    for (const p of res?.probes ?? []) {
      const status = p.error ? p.error : `HTTP ${p.status}`;
      const redir = p.redirected ? ` -> ${p.redirected}` : "";
      lines.push(`[${status}]${redir}`);
      if (p.text) lines.push(p.text.replace(/\s+/g, " ").slice(0, 250));
      lines.push("");
    }
    const scan = res?.adminScan;
    if (scan) {
      lines.push(
        `--- admin.mistral.ai : ${scan.bundles ?? "?"} bundles, ${scan.procedures?.length ?? scan.apiPaths?.length ?? 0} procédures tRPC ---`
      );
      for (const p of scan.apiPaths ?? []) lines.push(p);
      lines.push("");
    }
    if (res?.adminProbes?.length) {
      lines.push("--- sondage local-trpc (input null) ---");
      for (const p of res.adminProbes) {
        const redir = p.redirected ? ` -> ${p.redirected}` : "";
        lines.push(`[${p.proc}] HTTP ${p.status}${redir}`);
        if (p.text) lines.push(p.text.replace(/\s+/g, " ").slice(0, 300));
        lines.push("");
      }
    }
    const cscan = res?.consoleScan;
    if (cscan) {
      lines.push(
        `--- console.mistral.ai : ${cscan.bundles ?? "?"} bundles, ${cscan.apiPaths?.length ?? 0} chemins ---`
      );
      for (const p of (cscan.apiPaths ?? []).slice(0, 40)) lines.push(p);
    }
    probeViewEl.textContent = lines.join("\n") || "Aucune réponse.";
  });
});

btnBudget.addEventListener("click", () => {
  budgetStatusEl.textContent = "Lecture en cours…";
  chrome.runtime.sendMessage({ type: "refreshBudget" }, (res) => {
    if (chrome.runtime.lastError) {
      budgetStatusEl.textContent = chrome.runtime.lastError.message;
      budgetStatusEl.className = "err";
      return;
    }
    const creditsErr = res?.consoleCreditsError;
    const adminErr = res?.accountBudgetError;
    if (!res) {
      budgetStatusEl.textContent = "Pas de réponse du fond.";
      budgetStatusEl.className = "err";
    } else if (creditsErr && adminErr) {
      budgetStatusEl.textContent = creditsErr;
      budgetStatusEl.className = "err";
    } else {
      budgetStatusEl.textContent = "OK";
      budgetStatusEl.className = "ok";
    }
    renderBudgetView();
  });
});
renderBudgetView();

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

const ORIGINS = [
  "https://api.mistral.ai/*",
  "https://admin.mistral.ai/*",
  "https://console.mistral.ai/*",
];

const permViewEl = document.getElementById("perm-view");
const btnPerms = document.getElementById("btn-perms");

// Firefox MV3 n'accorde pas les host_permissions à l'installation (opt-in) :
// tant qu'elles ne sont pas accordées, les appels API et la lecture du
// budget échouent. Chrome les accorde automatiquement (bouton masqué).
async function refreshPermsView() {
  const has = await chrome.permissions.contains({ origins: ORIGINS });
  if (has) {
    permViewEl.textContent =
      "Accès réseau accordé (api.mistral.ai, admin.mistral.ai, console.mistral.ai).";
    btnPerms.classList.add("hidden");
  } else {
    permViewEl.textContent =
      "Accès réseau non accordé : activez-le pour que le chat et le badge fonctionnent.";
    btnPerms.classList.remove("hidden");
  }
}

btnPerms.addEventListener("click", async () => {
  const granted = await chrome.permissions.request({ origins: ORIGINS });
  if (!granted) {
    permViewEl.textContent =
      "Accès refusé. Il peut aussi être accordé depuis about:addons → Webstral → Permissions.";
    return;
  }
  await refreshPermsView();
});

refreshPermsView();

// Charge la clé existante (affichée masquée, toggle possible).
chrome.storage.local.get("apiKey").then(({ apiKey }) => {
  keyInput.value = apiKey ?? "";
});
loadBadgeSettings();

// Le compteur d'usage bouge après un tour de chat : on se met à jour.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.usage) loadBadgeSettings();
  if (
    area === "local" &&
    (changes.accountBudget ||
      changes.consoleCredits ||
      changes.subscriptionPlan)
  )
    renderBudgetView();
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
