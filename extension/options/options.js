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

let t = (k) => k; // remplacé au boot via settings.lang

const langSel = document.getElementById("lang");
const themeSel = document.getElementById("theme");
const alertsEnabledEl = document.getElementById("alerts-enabled");
const alertPctInput = document.getElementById("alert-pct");

async function bootI18n() {
  const { settings } = await chrome.storage.local.get("settings");
  const lang = WebstralI18n.resolveLang(
    settings?.lang,
    chrome.i18n?.getUILanguage?.() ?? "fr-FR"
  );
  t = WebstralI18n.makeT(lang);
  WebstralI18n.applyI18n(document, t);
  WebstralI18n.applyTheme(settings?.theme ?? "system");
  document.documentElement.lang = lang;
  document.title = t("opt_title");
}

const fmtEUR = (n, cur = "EUR") =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

// yyyy-MM-dd en UTC (les reset Mistral sont à 00:00:00Z).
const fmtDateUTC = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

const BUDGET_LABELS = () => ({
  "console-credits": t("badge_payg"),
  "admin-budget": t("opt_sub_account"),
});

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
          `<strong>${BUDGET_LABELS()["console-credits"]} :</strong> ${pct}%${part} (${t("ago_min", { n: age })})`
        );
        debug.push(
          t("opt_dbg_fields") + " " +
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
            `<strong>${BUDGET_LABELS()["console-credits"]} :</strong> ${t("opt_wallet_empty")} (${t("ago_min", { n: age })})`
          );
        } else {
          lines.push(
            `<strong>${BUDGET_LABELS()["console-credits"]} :</strong> ${t("amount_of", { a: fmtEUR(c.spent ?? 0, c.currency), b: fmtEUR(c.total, c.currency) })} (${t("ago_min", { n: age })})`
          );
        }
      } else if (st.consoleCredits) {
        // réponse reçue mais structure inconnue
        lines.push(
          `<strong>${BUDGET_LABELS()["console-credits"]} :</strong> ${t("opt_unrecognized")}`
        );
        debug.push(
          t("opt_dbg_preview") + " " + (st.consoleCredits.rawPreview || t("opt_dbg_empty"))
        );
      } else if (st.consoleCreditsError) {
        lines.push(
          `<strong>${BUDGET_LABELS()["console-credits"]} :</strong> ${st.consoleCreditsError}`
        );
      } else {
        lines.push(
          `<strong>${BUDGET_LABELS()["console-credits"]} :</strong> ${t("opt_not_read")}`
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
            extra = ` (${t("opt_reset_on", { d: fmtDateUTC(sub.reset_at) })})`;
          }
          return `<strong>${label} :</strong> ${pct}%${part}${extra}`;
        };
        lines.push(
          subLine(a.vibe, t("opt_plan_vibe_page")) ??
            `<strong>${t("opt_plan_vibe_page")}</strong> : ${t("opt_absent")}`
        );
        const apiLine = subLine(a.api, t("opt_api_allowance"));
        if (apiLine) lines.push(apiLine);
        debug.push(t("opt_dbg_admin") + " " + (a.rawPreview || t("opt_dbg_empty")));
      } else if (st.accountBudgetError) {
        lines.push(`<strong>Abonnement :</strong> ${st.accountBudgetError}`);
      }

      // Type de plan (gratuit / pro / entreprise) — sonde subscriptions.*
      if (st.subscriptionPlan) {
        const sp = st.subscriptionPlan;
        const age = Math.round((Date.now() - sp.fetchedAt) / 60000);
        lines.push(
          sp.plan
            ? `<strong>${t("plan_label")} :</strong> ${sp.plan} (${sp.planRaw}, ${sp.planPath}, ${t("ago_min", { n: age })})`
            : `<strong>${t("plan_label")} :</strong> ${t("opt_plan_unrecognized")} (${t("ago_min", { n: age })})`
        );
        debug.push(t("opt_plan_source") + " " + sp.source);
        debug.push(t("opt_plan_raw") + " " + (sp.rawPreview || t("opt_dbg_empty")));
        const rs = Object.entries(sp.rawStrings ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        if (rs) debug.push(t("opt_strings") + " " + rs.slice(0, 600));
      } else if (st.subscriptionPlanError) {
        lines.push(`<strong>Type de plan :</strong> ${st.subscriptionPlanError}`);
      }

      budgetViewEl.innerHTML = lines.join("<br>");
      if (debug.length) {
        budgetDebugEl.textContent = debug.join(" — ");
        budgetDebugEl.classList.remove("hidden");
      }
      const badgeSource = st.accountBudget?.vibe
        ? t("badge_plan_vibe")
        : st.accountBudget?.api
          ? t("badge_allocation")
          : st.consoleCredits && st.consoleCredits.usage_percentage != null
            ? t("badge_payg")
            : null;
      budgetStatusEl.textContent = badgeSource
        ? `${t("opt_badge_source")} ${badgeSource}`
        : `${t("opt_badge_source")} ${t("badge_local")}`;
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
  budgetStatusEl.textContent = t("opt_budget_reading");
  chrome.runtime.sendMessage({ type: "refreshBudget" }, (res) => {
    if (chrome.runtime.lastError) {
      budgetStatusEl.textContent = chrome.runtime.lastError.message;
      budgetStatusEl.className = "err";
      return;
    }
    const creditsErr = res?.consoleCreditsError;
    const adminErr = res?.accountBudgetError;
    if (!res) {
      budgetStatusEl.textContent = t("opt_budget_none");
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
bootI18n().then(renderBudgetView);

const DEFAULT_SETTINGS = {
  monthlyBudgetTokens: null,
  warnPct: 70,
  dangerPct: 90,
  lang: "system",
  theme: "system",
  alertsEnabled: true,
  alertPct: 90,
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
  langSel.value = s.lang ?? "system";
  themeSel.value = s.theme ?? "system";
  alertsEnabledEl.checked = s.alertsEnabled !== false;
  alertPctInput.value = s.alertPct ?? 90;

  const cur = all[monthKey()] ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let text = t("opt_usage_now", {
    tokens: formatTokens(cur.total_tokens),
    in: formatTokens(cur.prompt_tokens),
    out: formatTokens(cur.completion_tokens),
  });
  if (s.monthlyBudgetTokens) {
    const pct = Math.min(100, Math.floor((cur.total_tokens / s.monthlyBudgetTokens) * 100));
    text += t("opt_usage_now_pct", { pct });
  } else {
    text += t("opt_usage_now_nobudget");
  }
  usageNowEl.textContent = text;
}

async function saveBadgeSettings() {
  const { settings: prev = {} } = await chrome.storage.local.get("settings");
  const budget =
    budgetInput.value === "" ? null : Math.max(0, Number(budgetInput.value) || 0);
  const warn = Math.min(99, Math.max(1, Number(warnPctInput.value) || 70));
  const danger = Math.min(100, Math.max(2, Number(dangerPctInput.value) || 90));
  const alertPct = Math.min(100, Math.max(1, Number(alertPctInput.value) || 90));
  await chrome.storage.local.set({
    settings: {
      ...prev,
      monthlyBudgetTokens: budget,
      warnPct: warn,
      dangerPct: danger,
      alertsEnabled: alertsEnabledEl.checked,
      alertPct,
    },
  });
}

// Langue + thème : appliqués immédiatement (textes + data-theme).
async function saveDisplaySettings() {
  const { settings: prev = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...prev, lang: langSel.value, theme: themeSel.value },
  });
  await bootI18n();
}

budgetInput.addEventListener("input", saveBadgeSettings);
warnPctInput.addEventListener("input", saveBadgeSettings);
dangerPctInput.addEventListener("input", saveBadgeSettings);
alertsEnabledEl.addEventListener("change", saveBadgeSettings);
alertPctInput.addEventListener("input", saveBadgeSettings);
langSel.addEventListener("change", saveDisplaySettings);
themeSel.addEventListener("change", saveDisplaySettings);

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
    permViewEl.textContent = t("opt_perm_ok");
    btnPerms.classList.add("hidden");
  } else {
    permViewEl.textContent = t("opt_perm_ko");
    btnPerms.classList.remove("hidden");
  }
}

btnPerms.addEventListener("click", async () => {
  const granted = await chrome.permissions.request({ origins: ORIGINS });
  if (!granted) {
    permViewEl.textContent = t("opt_perm_denied");
    return;
  }
  await refreshPermsView();
});

refreshPermsView();

// Charge la clé existante (affichée masquée, toggle possible).
chrome.storage.local.get("apiKey").then(({ apiKey }) => {
  keyInput.value = apiKey ?? "";
});
bootI18n().then(loadBadgeSettings);

// Le compteur d'usage bouge après un tour de chat : on se met à jour.
// Un changement de settings (langue/thème/seuils) réapplique l'affichage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.usage) loadBadgeSettings();
  if (
    area === "local" &&
    (changes.accountBudget ||
      changes.consoleCredits ||
      changes.subscriptionPlan)
  )
    renderBudgetView();
  if (area === "local" && changes.settings)
    bootI18n().then(() => {
      loadBadgeSettings();
      renderBudgetView();
    });
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
    setStatus(t("opt_status_no_key"), "err");
    return;
  }
  // s'assure que la clé tapée est déjà persistée avant le test
  chrome.storage.local.set({ apiKey: value }).then(() => {
    setStatus(t("opt_status_testing"));
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
        t("opt_status_ok_models", {
          n: res.models.length,
          plural: res.models.length > 1 ? "s" : "",
        }),
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
