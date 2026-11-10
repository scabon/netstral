// Webstral - pop-up de l'icône : conso (même % que le badge), infos compte,
// menu (chat / actualiser / paramètres / changelog / about).

const $ = (id) => document.getElementById(id);

const versionEl = $("version");
const consoLabelEl = $("conso-label");
const consoPctEl = $("conso-pct");
const barFillEl = $("bar-fill");
const consoDetailEl = $("conso-detail");
const consoSourceEl = $("conso-source");
const accPlanEl = $("acc-plan");
const accWalletEl = $("acc-wallet");
const accResetEl = $("acc-reset");
const accKeyEl = $("acc-key");
const accErrorEl = $("acc-error");
const accUpdatedEl = $("acc-updated");
const localTokensEl = $("local-tokens");

const btnMenu = $("btn-menu");
const menuEl = $("menu");
const btnChat = $("btn-chat");
const btnRefresh = $("btn-refresh");
const btnOptions = $("btn-options");
const btnChangelog = $("btn-changelog");
const btnAbout = $("btn-about");

const PLAN_LABELS = {
  free: "Gratuit",
  pro: "Pro",
  enterprise: "Entreprise",
  team: "Team",
  scale: "Scale",
  trial: "Essai",
};

const fmtEUR = (n, cur = "EUR") =>
  `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const fmtTokens = (n) => n.toLocaleString("fr-FR");
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR");
};
const ilYA = (ts) => {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return `il y a ${h} h`;
};

function render(state) {
  versionEl.textContent = state.ok ? `v${state.version}` : "";

  // --- Barre de progression (même % et couleur que le badge) ---
  const b = state.badge;
  if (b && b.pct != null) {
    consoLabelEl.textContent = `Consommation — ${b.label}`;
    consoPctEl.textContent = `${b.pct} %`;
    consoPctEl.style.color = b.color;
    barFillEl.style.width = `${b.pct}%`;
    barFillEl.style.background = b.color;
    if (b.mode === "account") {
      consoDetailEl.textContent =
        b.total != null
          ? `${fmtEUR(b.spent, b.currency)} sur ${fmtEUR(b.total, b.currency)}`
          : `${b.pct} % consommés`;
    } else {
      consoDetailEl.textContent = `${fmtTokens(b.spentTokens)} tokens sur ${fmtTokens(b.budgetTokens)}`;
    }
    consoSourceEl.textContent =
      b.mode === "account" && b.fetchedAt
        ? `Source : ${b.source ?? b.label} — lu ${ilYA(b.fetchedAt)}`
        : b.mode === "local"
          ? "Comptage local (pas de session Mistral)"
          : "";
  } else {
    consoLabelEl.textContent = "Consommation";
    consoPctEl.textContent = "—";
    consoPctEl.style.color = "";
    barFillEl.style.width = "0%";
    barFillEl.style.background = "#ddd";
    consoDetailEl.textContent = "Aucun budget suivi pour l'instant.";
    consoSourceEl.textContent =
      "Connectez-vous sur console.mistral.ai ou définissez un budget de tokens dans les paramètres.";
  }

  // --- Compte ---
  const acc = state.account ?? {};
  const plan = acc.subscriptionPlan;
  if (plan?.plan) {
    accPlanEl.textContent = PLAN_LABELS[plan.plan] ?? plan.planRaw ?? plan.plan;
  } else if (plan?.planRaw) {
    accPlanEl.textContent = plan.planRaw;
  } else {
    accPlanEl.textContent = "Inconnu";
  }

  const credits = acc.consoleCredits;
  if (credits && credits.total != null) {
    accWalletEl.textContent =
      credits.total > 0
        ? `${fmtEUR(credits.total - (credits.spent ?? 0), credits.currency)} restants`
        : "aucun crédit";
  } else {
    accWalletEl.textContent = "—";
  }

  accResetEl.textContent = b?.resetAt ? fmtDate(b.resetAt) : "—";
  accKeyEl.textContent = state.hasApiKey ? "configurée" : "non configurée";

  const err = acc.consoleCreditsError ?? acc.accountBudgetError ?? acc.subscriptionPlanError;
  if (err) {
    accErrorEl.innerHTML = "";
    accErrorEl.append(
      `${err} Connectez-vous sur `,
      Object.assign(document.createElement("a"), {
        href: "https://console.mistral.ai/",
        target: "_blank",
        rel: "noreferrer",
        textContent: "console.mistral.ai",
      })
    );
    accErrorEl.classList.remove("hidden");
  } else {
    accErrorEl.classList.add("hidden");
  }

  const fetched = [credits?.fetchedAt, acc.accountBudget?.fetchedAt, plan?.fetchedAt].filter(Boolean);
  accUpdatedEl.textContent = fetched.length
    ? `Compte lu ${ilYA(Math.max(...fetched))}.`
    : "";

  // --- Usage local ---
  const u = state.localUsage;
  localTokensEl.textContent = u ? fmtTokens(u.total_tokens) : "—";
}

async function load() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "getPopupState" });
    if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
    render(state);
  } catch (err) {
    consoDetailEl.textContent = `Erreur : ${err.message}`;
  }
}

// --- Menu ---
btnMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  menuEl.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!menuEl.contains(e.target)) menuEl.classList.add("hidden");
});

btnChat.addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "openChat" });
  if (res?.ok) window.close();
});

btnRefresh.addEventListener("click", async () => {
  menuEl.classList.add("hidden");
  consoSourceEl.textContent = "Actualisation…";
  await chrome.runtime.sendMessage({ type: "refreshBudget" });
  await load();
});

btnOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
btnChangelog.addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/changelog.html") })
);
btnAbout.addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/about.html") })
);

// Rafraîchit en direct quand le badge/les données bougent (fin de tour de
// chat, alarme 30 min, écriture depuis les options).
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes.usage ||
      changes.consoleCredits ||
      changes.accountBudget ||
      changes.subscriptionPlan ||
      changes.settings)
  ) {
    load();
  }
});

load();
