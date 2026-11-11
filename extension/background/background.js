// Netstral - service worker MV3
// Service worker : badge de consommation (usage réel du compte Mistral via la
// session console, fallback comptage local), alertes à seuil, snapshot pop-up.
// Pas de chat interne — le bouton de la pop-up renvoie vers chat.mistral.ai.

// i18n embarqué : via background.scripts (Firefox) ou importScripts (Chrome MV3)
if (typeof NetstralI18n === "undefined" && typeof importScripts === "function") {
  try {
    importScripts("i18n.js");
  } catch (err) {
    console.error("i18n load failed:", err);
  }
}

// Traducteur pour la langue demandée (settings.lang: system|fr|en).
function tFor(settings) {
  if (typeof NetstralI18n === "undefined") return (k) => k;
  const lang = NetstralI18n.resolveLang(
    settings?.lang,
    chrome.i18n?.getUILanguage?.() ?? "fr-FR"
  );
  return NetstralI18n.makeT(lang);
}

function resolveLangFor(settings) {
  if (typeof NetstralI18n === "undefined") return "fr";
  return NetstralI18n.resolveLang(
    settings?.lang,
    chrome.i18n?.getUILanguage?.() ?? "fr-FR"
  );
}

// Le clic sur l'icône ouvre la pop-up (action.default_popup dans le manifest).
// Le chat se fait sur chat.mistral.ai (bouton 💬 de la pop-up) : l'extension
// n'a plus de side panel / sidebar, le navigateur en fournit déjà un en natif.

chrome.runtime.onInstalled.addListener(() => {
  ensureBudgetAlarm();
  refreshBudgetAndBadge().catch((err) =>
    console.error("budget refresh failed:", err)
  );
});

chrome.runtime.onStartup?.addListener(() => {
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
const BUDGET_ALARM = "netstral-budget-refresh";

async function fetchJsonWithSession(url) {
  const t = tFor(await getSettings());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let response;
  try {
    response = await fetch(url, {
      credentials: "include",
      signal: ctrl.signal,
    });
  } catch (err) {
    return { ok: false, error: t("err_network", { msg: err.message }) };
  } finally {
    clearTimeout(timer);
  }
  if (response.redirected && response.url.includes("auth.mistral.ai")) {
    return { ok: false, error: t("err_session_redirect") };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: t("err_session_http", { status: response.status }) };
  }
  if (!response.ok) {
    return { ok: false, error: t("err_http", { status: response.status }) };
  }
  try {
    return { ok: true, json: await response.json() };
  } catch {
    return { ok: false, error: t("err_not_json") };
  }
}

// Crédits PAYG de la console (source prioritaire).
async function fetchConsoleCredits() {
  const t = tFor(await getSettings());
  const res = await fetchJsonWithSession(CREDITS_URL);
  if (!res.ok) return res;
  const data = res.json;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: t("err_bad_format_credits") };
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
    return JSON.stringify(data).slice(0, 1200);
  } catch {
    return "";
  }
}

// Allocation de l'abonnement (Vibe Pro) — secondaire.
// Réponse réelle (2026-11-09, sonnées via diagnostic) :
//   { ..., api_budget: {usage_percentage, initial_budget, currency, reset_at},
//     vibe_budget: {...} } — le %/budget du plan Vibe (affiché par
//     admin.mistral.ai/subscription) vit dans vibe_budget ; le top-level
//     ne reflète que l'allocation API.
async function fetchAccountBudget() {
  const t = tFor(await getSettings());
  const res = await fetchJsonWithSession(BUDGET_URL);
  if (!res.ok) return res;
  const data = res.json?.result?.data?.json ?? res.json?.result?.data ?? null;
  if (!data || typeof data !== "object") {
    return { ok: false, error: t("err_bad_format") };
  }
  const pick = (o) =>
    o && typeof o === "object" && typeof o.usage_percentage === "number"
      ? {
          usage_percentage: o.usage_percentage,
          initial_budget: o.initial_budget ?? null,
          currency: o.currency ?? "EUR",
          reset_at: o.reset_at ?? null,
        }
      : null;
  const record = {
    fetchedAt: Date.now(),
    source: "admin-budget",
    // priorité d'affichage : vibe (page /subscription) puis api (allocation)
    vibe: pick(data.vibe_budget),
    api: pick(data.api_budget) ?? pick(data),
    rawNumeric: flattenNumeric(data),
    rawPreview: safePreview(data),
  };
  if (!record.vibe && !record.api) {
    return { ok: false, error: t("err_no_budget") };
  }
  await chrome.storage.local.set({ accountBudget: record });
  return { ok: true, accountBudget: record };
}

// ---------- Plan du compte (gratuit / pro / entreprise) ----------
// Sonde les procédures local-trpc de la famille subscriptions/info avec la
// session : la réponse (non documentée) porte le palier du compte. Toute
// chaîne ressemblant à un nom de plan est classifiée ; l'aperçu brut est
// conservé pour debug (les options l'affichent).
const SUBSCRIPTION_PROCS = [
  "billing.subscriptions.current",
  "billing.subscription",
  "billing.subscriptions.list",
  "billing.info",
];

const NULL_INPUT = encodeURIComponent(
  '{"json":null,"meta":{"values":["undefined"],"v":1}}'
);
const subscriptionUrl = (proc) =>
  `https://admin.mistral.ai/api/local-trpc/${proc}?input=${NULL_INPUT}`;

// Aplati un objet JSON en "chemin.pointé=valeur" pour les chaînes (profondeur 5).
function flattenStrings(obj, prefix = "", depth = 0, out = {}) {
  if (depth > 5 || !obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[path] = v;
    else if (v && typeof v === "object")
      flattenStrings(v, path, depth + 1, out);
  }
  return out;
}

const PLAN_PATTERNS = [
  [/(enterprise|entreprise)/i, "enterprise"],
  [/^(free|gratuit)$/i, "free"],
  [/^pro$/i, "pro"],
  [/^(basic|starter)$/i, "basic"],
  [/^(team|équipe)$/i, "team"],
  [/^scale$/i, "scale"],
  [/(trial|essai)/i, "trial"],
  [/(payg|pay[- ]as[- ]you[- ]go)/i, "payg"],
];

// Cherche un nom de plan dans les chaînes aplaties : d'abord les chemins
// explicites (plan/tier/subscription/…), puis toutes les autres. Les
// valeurs d'email/URL sont ignorées (faux positifs).
function classifyPlan(strings) {
  const entries = Object.entries(strings).filter(
    ([, v]) => !v.includes("@") && !v.includes("/")
  );
  const explicit = entries.filter(([p]) =>
    /(plan|tier|subscription|level|package|name)/i.test(p)
  );
  for (const [path, v] of [...explicit, ...entries]) {
    for (const [re, label] of PLAN_PATTERNS) {
      if (re.test(v)) return { plan: label, raw: v, path };
    }
  }
  return null;
}

async function fetchSubscriptionPlan() {
  const t = tFor(await getSettings());
  let lastError = null;
  for (const proc of SUBSCRIPTION_PROCS) {
    const res = await fetchJsonWithSession(subscriptionUrl(proc));
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    const data =
      res.json?.result?.data?.json ?? res.json?.result?.data ?? res.json ?? null;
    if (!data || typeof data !== "object") {
      lastError = t("err_bad_format");
      continue;
    }
    const strings = flattenStrings(data);
    const found = classifyPlan(strings);
    const record = {
      fetchedAt: Date.now(),
      source: `admin-trpc:${proc}`,
      plan: found?.plan ?? null,
      planRaw: found?.raw ?? null,
      planPath: found?.path ?? null,
      rawStrings: strings,
      rawPreview: safePreview(data),
    };
    await chrome.storage.local.set({ subscriptionPlan: record });
    if (found) return { ok: true, subscriptionPlan: record };
    lastError = t("err_no_plan");
  }
  return { ok: false, error: lastError ?? t("err_no_response") };
}

async function refreshBudgetAndBadge() {
  const [creditsRes, adminRes, planRes] = await Promise.allSettled([
    fetchConsoleCredits(),
    fetchAccountBudget(),
    fetchSubscriptionPlan(),
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
  if (planRes.status === "fulfilled") {
    const r = planRes.value;
    await chrome.storage.local.set(
      r.ok ? { subscriptionPlanError: null } : { subscriptionPlanError: r.error }
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
  lang: "system", // system | fr | en
  theme: "system", // system | light | dark
  alertsEnabled: true,
  alertPct: 90,
  notifyOnReset: true,
};

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

function badgeColor(pct, settings) {
  return pct >= settings.dangerPct
    ? "#b3261e" // rouge
    : pct >= settings.warnPct
      ? "#f9a825" // orange
      : "#1a7f37"; // vert
}

// État du badge, partagé entre l'icône (updateBadge) et la pop-up
// (getPopupState) : même source prioritaire, même % et même couleur.
// Priorité des sources :
// 1. plan Vibe (admin billing.budget.vibe_budget — la page /subscription) ;
// 2. allocation API incluse dans l'abonnement (api_budget) ;
// 3. crédits PAYG de la console (wallet non nul) ;
// 4. comptage local « tokens passés par Netstral » vs budget de tokens.
// mode "account" = source 1-3, mode "local" = source 4, mode "none" = rien.
async function computeBadgeState() {
  const settings = await getSettings();
  const { consoleCredits, accountBudget, usage: all = {} } =
    await chrome.storage.local.get([
      "consoleCredits",
      "accountBudget",
      "usage",
    ]);

  const record = pickBudgetRecord(consoleCredits, accountBudget);
  if (record) {
    const pct = Math.min(100, Math.round(record.usage_percentage));
    const spent =
      record.total != null
        ? round2((record.usage_percentage / 100) * record.total)
        : null;
    return {
      mode: "account",
      source: record.source ?? null,
      label: record.label,
      labelKey: record.labelKey ?? "badge_local",
      pct,
      color: badgeColor(pct, settings),
      spent,
      total: record.total != null ? round2(record.total) : null,
      currency: record.currency ?? "EUR",
      resetAt: record.reset_at ?? null,
      fetchedAt: record.fetchedAt ?? null,
    };
  }

  const spentTokens = all?.[monthKey()]?.total_tokens ?? 0;
  if (!settings.monthlyBudgetTokens) {
    return {
      mode: "none",
      label: "comptage local",
      labelKey: "badge_local",
      pct: null,
      color: null,
      spentTokens,
      budgetTokens: null,
    };
  }
  const pct = Math.min(
    100,
    Math.floor((spentTokens / settings.monthlyBudgetTokens) * 100)
  );
  return {
    mode: "local",
    label: "comptage local",
    labelKey: "badge_local",
    pct,
    color: badgeColor(pct, settings),
    spentTokens,
    budgetTokens: settings.monthlyBudgetTokens,
  };
}

// Met à jour le badge de l'icône à partir de computeBadgeState().
async function updateBadge() {
  const settings = await getSettings();
  const state = await computeBadgeState();
  await maybeNotifyReset(state, settings);
  if (state.pct != null) {
    const t = tFor(settings);
    const amount =
      state.mode === "account" && state.total != null
        ? ` (${state.spent} ${state.currency} / ${state.total} ${state.currency})`
        : "";
    await chrome.action.setTitle({
      title: `Netstral — ${t(state.labelKey)} : ${state.pct}%${amount}`,
    });
    await chrome.action.setBadgeBackgroundColor({ color: state.color });
    await chrome.action.setBadgeText({ text: `${state.pct}%` });
    await maybeNotify(state, settings);
    return;
  }
  await chrome.action.setTitle({ title: "Netstral" });
  await chrome.action.setBadgeText({ text: "" });
}

// Notification navigateur quand la conso franchit settings.alertPct
// (une seule fois par passage au-dessus du seuil ; reset quand on redescend).
async function maybeNotify(state, settings) {
  if (settings.alertsEnabled === false || state.pct == null) return;
  const { alertState } = await chrome.storage.local.get("alertState");
  const alerted = alertState?.alertedPct ?? null;
  if (state.pct >= settings.alertPct && alerted == null) {
    if (chrome.notifications?.create) {
      const t = tFor(settings);
      const amount =
        state.mode === "account" && state.total != null
          ? `${state.spent} ${state.currency} / ${state.total} ${state.currency}`
          : "";
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notif_title", { pct: state.pct }),
        message: t("notif_body", {
          label: t(state.labelKey),
          pct: state.pct,
          amount,
        }),
      });
    }
    await chrome.storage.local.set({ alertState: { alertedPct: state.pct } });
  } else if (state.pct < settings.alertPct && alerted != null) {
    await chrome.storage.local.set({ alertState: { alertedPct: null } });
  }
}

// Notification quand la période de facturation change (resetAt reçu ou
// nouveau mois calendaire en repli local) : une seule fois par période,
// et jamais au premier démarrage (pas de période précédente connue).
async function maybeNotifyReset(state, settings) {
  if (settings.notifyOnReset === false) return;
  const periodKey = state.resetAt ?? monthKey();
  const { resetNotif } = await chrome.storage.local.get("resetNotif");
  const last = resetNotif?.period ?? null;
  if (last === periodKey) return;
  if (last != null && chrome.notifications?.create) {
    const t = tFor(settings);
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: t("notif_reset_title"),
      message: t("notif_reset_body"),
    });
  }
  await chrome.storage.local.set({ resetNotif: { period: periodKey } });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Choisit la source de % la plus fraîche et la plus pertinente.
function pickBudgetRecord(consoleCredits, accountBudget) {
  const fresh = (rec) => rec && Date.now() - rec.fetchedAt < BUDGET_TTL_MS;
  if (fresh(accountBudget)) {
    if (accountBudget.vibe) {
      return {
        ...accountBudget.vibe,
        total: accountBudget.vibe.initial_budget,
        label: "plan Vibe",
        labelKey: "badge_plan_vibe",
        fetchedAt: accountBudget.fetchedAt,
        source: accountBudget.source,
      };
    }
    if (accountBudget.api) {
      return {
        ...accountBudget.api,
        total: accountBudget.api.initial_budget,
        label: "allocation API",
        labelKey: "badge_allocation",
        fetchedAt: accountBudget.fetchedAt,
        source: accountBudget.source,
      };
    }
  }
  if (
    fresh(consoleCredits) &&
    consoleCredits.usage_percentage != null &&
    (consoleCredits.total ?? 0) > 0
  ) {
    return { ...consoleCredits, label: "crédits PAYG", labelKey: "badge_payg" };
  }
  return null;
}

// ---------- Pop-up ----------

// Snapshot complet pour la pop-up : état du badge (même calcul que
// l'icône), infos compte, plan, erreurs de session, usage local du mois.
async function getPopupState() {
  const settings = await getSettings();
  const st = await chrome.storage.local.get([
    "consoleCredits",
    "consoleCreditsError",
    "accountBudget",
    "accountBudgetError",
    "subscriptionPlan",
    "subscriptionPlanError",
    "usage",
  ]);
  const badge = await computeBadgeState();
  const localUsage = st.usage?.[monthKey()] ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  return {
    ok: true,
    version: chrome.runtime.getManifest().version,
    lang: resolveLangFor(settings),
    badge,
    settings: {
      warnPct: settings.warnPct,
      dangerPct: settings.dangerPct,
      monthlyBudgetTokens: settings.monthlyBudgetTokens,
      lang: settings.lang ?? "system",
      theme: settings.theme ?? "system",
      alertsEnabled: settings.alertsEnabled !== false,
      alertPct: settings.alertPct ?? 90,
      notifyOnReset: settings.notifyOnReset !== false,
    },
    account: {
      consoleCredits: st.consoleCredits ?? null,
      consoleCreditsError: st.consoleCreditsError ?? null,
      accountBudget: st.accountBudget ?? null,
      accountBudgetError: st.accountBudgetError ?? null,
      subscriptionPlan: st.subscriptionPlan ?? null,
      subscriptionPlanError: st.subscriptionPlanError ?? null,
    },
    localUsage,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getPopupState") {
    getPopupState()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
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
});

