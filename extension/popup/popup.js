// Webstral - pop-up de l'icône : conso (même % que le badge), infos compte,
// projection, réglages (langue/thème/alertes/clé API) et menu.

const $ = (id) => document.getElementById(id);

let t = (k) => k; // remplacé au chargement via getPopupState.lang

const versionEl = $("version");
const consoLabelEl = $("conso-label");
const consoPctEl = $("conso-pct");
const barFillEl = $("bar-fill");
const consoDetailEl = $("conso-detail");
const consoSourceEl = $("conso-source");
const planRowEl = $("plan-row");
const accPlanEl = $("acc-plan");
const accWalletEl = $("acc-wallet");
const accResetEl = $("acc-reset");
const accResetInEl = $("acc-reset-in");
const accErrorEl = $("acc-error");
const localTokensEl = $("local-tokens");
const projEl = $("projection");
const projOver100El = $("proj-over100");
const projFillEl = $("proj-fill");
const projTick100El = $("proj-tick100");
const projMarkEl = $("proj-mark");
const projMarkLabelEl = $("proj-mark-label");
const projRateEl = $("proj-rate");
const proj100El = $("proj-100");

const themeSelect = $("themeSelect");
const langSelect = $("langSelect");
const alertsEnabledEl = $("alertsEnabled");
const alertPctInput = $("alertPct");
const notifyOnResetEl = $("notifyOnReset");
const apiKeyInput = $("apiKey");
const btnToggleKey = $("btnToggleKey");

const btnMenu = $("btn-menu");
const menuEl = $("menu");
const btnChat = $("btn-chat");
const btnRefresh = $("btn-refresh");
const btnSettings = $("btn-settings");
const btnChangelog = $("btn-changelog");
const btnAbout = $("btn-about");

const fmtEUR = (n, cur = "EUR") =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const fmtTokens = (n) => n.toLocaleString("fr-FR");
// Format compact yyyy-MM-dd, composantes UTC (les reset Mistral sont à 00:00:00Z).
const fmtDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
const ilYA = (ts) => {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return t("ago_now");
  if (min < 60) return t("ago_min", { n: min });
  return t("ago_hour", { n: Math.round(min / 60) });
};

const DAY_MS = 86400000;

// Projection à partir du % actuel et de la date de réinitialisation :
// rythme (%/jour), % estimé en fin de période (peut dépasser 100 %),
// jours restants avant 100 % à ce rythme. Sans resetAt connu, on prend le
// mois calendaire UTC comme période.
function computeProjection(b) {
  if (b?.pct == null) return null;
  let resetTs = b.resetAt ? Date.parse(b.resetAt) : NaN;
  let periodDays, daysLeft;
  if (!Number.isNaN(resetTs)) {
    const prev = new Date(resetTs);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    periodDays = Math.round((resetTs - prev.getTime()) / DAY_MS);
    daysLeft = Math.max(0, Math.ceil((resetTs - Date.now()) / DAY_MS));
  } else {
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    periodDays = Math.round((end - start) / DAY_MS);
    daysLeft = Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
  }
  const daysElapsed = Math.max(1, periodDays - daysLeft);
  const rate = b.pct / daysElapsed; // % par jour
  const endPct = rate * periodDays;
  const daysTo100 = b.pct > 0 ? (100 - b.pct) / rate : Infinity;
  return { rate, endPct, daysTo100, daysLeft, periodDays };
}

function renderProjection(b) {
  const p = computeProjection(b);
  if (!p) {
    projEl.classList.add("hidden");
    return;
  }
  projEl.classList.remove("hidden");

  // Échelle : 100 % minimum, sinon assez pour contenir la projection.
  const scaleMax = Math.max(100, Math.ceil(p.endPct / 10) * 10);
  const x = (v) => `${Math.min(100, (v / scaleMax) * 100)}%`;

  projOver100El.style.left = x(100);
  projOver100El.style.width = p.endPct > 100 ? x(scaleMax - 100) : "0%";
  projFillEl.style.width = x(b.pct);
  projFillEl.style.background = b.color ?? "#1a7f37";
  projTick100El.style.left = x(100);
  projMarkEl.style.left = x(p.endPct);
  projMarkLabelEl.style.left = x(p.endPct);
  projMarkLabelEl.textContent = `~${Math.round(p.endPct)} %`;
  projMarkLabelEl.classList.toggle("over", p.endPct > 100);

  projRateEl.textContent = t("proj_rate", {
    r: p.rate.toFixed(1),
    e: p.periodDays - p.daysLeft,
    p: p.periodDays,
    d: p.daysLeft,
  });
  if (Number.isFinite(p.daysTo100)) {
    const j = Math.round(p.daysTo100);
    const avant = p.daysTo100 <= p.daysLeft;
    proj100El.textContent = t(avant ? "proj_100_before" : "proj_100_after", { n: j });
    proj100El.classList.toggle("warn", avant);
  } else {
    proj100El.textContent = t("proj_100_none");
    proj100El.classList.remove("warn");
  }
}

function render(state) {
  versionEl.textContent = state.ok ? `v${state.version}` : "";

  // --- Barre de progression (même % et couleur que le badge) ---
  const b = state.badge;
  if (b && b.pct != null) {
    consoLabelEl.textContent = `${t("conso_title")} — ${t(b.labelKey ?? "badge_local")}`;
    consoPctEl.textContent = `${b.pct} %`;
    consoPctEl.style.color = b.color;
    barFillEl.style.width = `${b.pct}%`;
    barFillEl.style.background = b.color;
    if (b.mode === "account") {
      consoDetailEl.textContent =
        b.total != null
          ? t("amount_of", { a: fmtEUR(b.spent, b.currency), b: fmtEUR(b.total, b.currency) })
          : `${b.pct} %`;
    } else {
      consoDetailEl.textContent = t("tokens_of", {
        a: fmtTokens(b.spentTokens),
        b: fmtTokens(b.budgetTokens),
      });
    }
    consoSourceEl.textContent =
      b.mode === "account" && b.fetchedAt
        ? t("read_ago", { ago: ilYA(b.fetchedAt) })
        : b.mode === "local"
          ? t("conso_local_fallback")
          : "";
  } else {
    consoLabelEl.textContent = t("conso_title");
    consoPctEl.textContent = "—";
    consoPctEl.style.color = "";
    barFillEl.style.width = "0%";
    barFillEl.style.background = "var(--bar-bg)";
    consoDetailEl.textContent = t("conso_no_budget");
    consoSourceEl.textContent = t("conso_no_budget_hint");
  }
  renderProjection(b);

  // --- Compte ---
  // Le comptage local n'a d'intérêt que sans source compte : masqué dès
  // que la conso du compte Mistral est disponible (même % que le badge).
  document.querySelector("section.local").classList.toggle("hidden", b?.mode === "account");

  const acc = state.account ?? {};
  // Type de plan : affiché seulement si une valeur a été reconnue — tant que
  // le mapping de billing.subscriptions.* n'est pas confirmé, on masque.
  const plan = acc.subscriptionPlan;
  if (plan?.plan) {
    const label = t(`plan_${plan.plan}`);
    accPlanEl.textContent = label.startsWith("plan_") ? plan.planRaw ?? plan.plan : label;
    planRowEl.classList.remove("hidden");
  } else {
    planRowEl.classList.add("hidden");
  }

  const credits = acc.consoleCredits;
  if (credits && credits.total != null) {
    accWalletEl.textContent =
      credits.total > 0
        ? t("wallet_restants", { n: fmtEUR(credits.total - (credits.spent ?? 0), credits.currency) })
        : t("wallet_none");
  } else {
    accWalletEl.textContent = "—";
  }

  if (b?.resetAt) {
    accResetEl.textContent = fmtDate(b.resetAt);
    const days = Math.ceil((Date.parse(b.resetAt) - Date.now()) / DAY_MS);
    accResetInEl.textContent =
      days > 1 ? t("reset_in_days", { n: days }) : days === 1 ? t("reset_tomorrow") : t("reset_today");
    accResetInEl.classList.remove("hidden");
  } else {
    accResetEl.textContent = "—";
    accResetInEl.classList.add("hidden");
  }

  // Erreur de session affichée seulement si AUCUNE source compte n'est
  // disponible.
  const hasAccountSource = b?.mode === "account";
  const err = hasAccountSource
    ? null
    : acc.consoleCreditsError ?? acc.accountBudgetError ?? acc.subscriptionPlanError ?? null;
  if (err) {
    accErrorEl.innerHTML = "";
    const link = Object.assign(document.createElement("a"), {
      href: "https://console.mistral.ai/",
      target: "_blank",
      rel: "noreferrer",
      textContent: "console.mistral.ai",
    });
    const parts = t("session_error_connect", { err, link: "" }).split("{link}");
    accErrorEl.append(parts[0], link, parts[1] ?? "");
    accErrorEl.classList.remove("hidden");
  } else {
    accErrorEl.classList.add("hidden");
  }

  // --- Usage local ---
  const u = state.localUsage;
  localTokensEl.textContent = u ? fmtTokens(u.total_tokens) : "—";

  // --- Réglages (pré-remplis depuis le state) ---
  const s = state.settings ?? {};
  themeSelect.value = s.theme ?? "system";
  langSelect.value = s.lang ?? "system";
  alertsEnabledEl.checked = s.alertsEnabled !== false;
  alertPctInput.value = s.alertPct ?? 90;
  notifyOnResetEl.checked = s.notifyOnReset !== false;
}

async function load() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "getPopupState" });
    if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
    t = WebstralI18n.makeT(state.lang ?? "fr");
    WebstralI18n.applyI18n(document, t);
    WebstralI18n.applyTheme(state.settings?.theme ?? "system");
    document.documentElement.lang = state.lang ?? "fr";
    if (apiKeyInput.value === "") {
      const { apiKey } = await chrome.storage.local.get("apiKey");
      apiKeyInput.value = apiKey ?? "";
    }
    render(state);
  } catch (err) {
    consoDetailEl.textContent = `${t("err_prefix")} ${err.message}`;
  }
}

// ---------- Réglages ----------

async function saveSettings(patch) {
  const { settings: prev = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...prev, ...patch } });
}

themeSelect.addEventListener("change", async () => {
  await saveSettings({ theme: themeSelect.value });
  WebstralI18n.applyTheme(themeSelect.value);
});

langSelect.addEventListener("change", async () => {
  await saveSettings({ lang: langSelect.value });
  await load(); // re-lit la langue résolue et réapplique les textes
});

alertsEnabledEl.addEventListener("change", () =>
  saveSettings({ alertsEnabled: alertsEnabledEl.checked })
);
alertPctInput.addEventListener("input", () => {
  const v = Math.min(100, Math.max(1, Number(alertPctInput.value) || 90));
  saveSettings({ alertPct: v });
});
notifyOnResetEl.addEventListener("change", () =>
  saveSettings({ notifyOnReset: notifyOnResetEl.checked })
);

// Navigation entre les vues (main / réglages / changelog), comme wagonBAR.
const VIEWS = ["main", "settings", "changelog"];

function showView(name) {
  for (const v of VIEWS) $(`view-${v}`).classList.toggle("hidden", v !== name);
  menuEl.classList.add("hidden");
}
btnSettings.addEventListener("click", () => showView("settings"));
document.querySelectorAll(".btn-back").forEach((b) =>
  b.addEventListener("click", () => showView("main"))
);

// ---------- Changelog (données embarquées, FR uniquement) ----------

function buildChangelog() {
  const el = $("changelogContent");
  const frag = document.createDocumentFragment();
  for (const entry of window.WebstralChangelog ?? []) {
    const h = document.createElement("h3");
    h.textContent = entry.h;
    const p = document.createElement("p");
    p.innerHTML = entry.p; // contenu statique embarqué avec l'extension
    frag.append(h, p);
  }
  el.replaceChildren(frag);
}
buildChangelog();

let keyTimer = null;
apiKeyInput.addEventListener("input", () => {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => {
    chrome.storage.local.set({ apiKey: apiKeyInput.value.trim() });
  }, 400);
});
btnToggleKey.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

// ---------- Header / menu ----------

btnMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  menuEl.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!menuEl.contains(e.target)) menuEl.classList.add("hidden");
});

// « Ouvrir le chat » = simple raccourci vers chat.mistral.ai.
btnChat.addEventListener("click", () =>
  chrome.tabs.create({ url: "https://chat.mistral.ai/" })
);

btnRefresh.addEventListener("click", async () => {
  btnRefresh.classList.add("spin");
  consoSourceEl.textContent = t("refresh_in_progress");
  try {
    await chrome.runtime.sendMessage({ type: "refreshBudget" });
  } finally {
    await load();
    btnRefresh.classList.remove("spin");
  }
});

btnChangelog.addEventListener("click", () => showView("changelog"));
btnAbout.addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/about.html") })
);

// Rafraîchit en direct quand le badge/les données/les réglages bougent.
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes.usage ||
      changes.consoleCredits ||
      changes.accountBudget ||
      changes.subscriptionPlan ||
      changes.settings ||
      changes.apiKey)
  ) {
    load();
  }
});

load();
