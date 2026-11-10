// Webstral - pop-up de l'icône : conso (même % que le badge), infos compte,
// menu (chat / actualiser / paramètres / changelog / about).

const $ = (id) => document.getElementById(id);

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
const keyRowEl = $("key-row");
const btnConfigKey = $("btn-config-key");
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
// Format compact yyyy-MM-dd, composantes UTC (les reset Mistral sont à 00:00:00Z).
const fmtDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
const ilYA = (ts) => {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return `il y a ${h} h`;
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

  // zone hachurée au-delà de 100 %
  projOver100El.style.left = x(100);
  projOver100El.style.width = p.endPct > 100 ? x(scaleMax - 100) : "0%";
  // consommé actuel (couleur du badge)
  projFillEl.style.width = x(b.pct);
  projFillEl.style.background = b.color ?? "#1a7f37";
  // tick 100 %
  projTick100El.style.left = x(100);
  // marqueur de fin de période
  projMarkEl.style.left = x(p.endPct);
  projMarkLabelEl.style.left = x(p.endPct);
  projMarkLabelEl.textContent = `~${Math.round(p.endPct)} %`;
  projMarkLabelEl.classList.toggle("over", p.endPct > 100);

  projRateEl.textContent = `Rythme actuel : ${p.rate.toFixed(1)} %/jour (${p.periodDays - p.daysLeft} j écoulés sur ${p.periodDays}, réinit dans ${p.daysLeft} j)`;
  if (Number.isFinite(p.daysTo100)) {
    const j = Math.round(p.daysTo100);
    const avant = p.daysTo100 <= p.daysLeft;
    proj100El.textContent = avant
      ? `À ce rythme, 100 % atteints dans ~${j} j (avant la réinitialisation)`
      : `À ce rythme, 100 % atteints dans ~${j} j (après la réinitialisation)`;
    proj100El.classList.toggle("warn", avant);
  } else {
    proj100El.textContent = "Aucune conso pour l'instant — 100 % hors de portée à ce rythme.";
    proj100El.classList.remove("warn");
  }
}

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
    accPlanEl.textContent = PLAN_LABELS[plan.plan] ?? plan.planRaw ?? plan.plan;
    planRowEl.classList.remove("hidden");
  } else {
    planRowEl.classList.add("hidden");
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

  if (b?.resetAt) {
    accResetEl.textContent = fmtDate(b.resetAt);
    const days = Math.ceil((Date.parse(b.resetAt) - Date.now()) / 86400000);
    accResetInEl.textContent =
      days > 1 ? `dans ${days} jours` : days === 1 ? "demain" : "aujourd'hui";
    accResetInEl.classList.remove("hidden");
  } else {
    accResetEl.textContent = "—";
    accResetInEl.classList.add("hidden");
  }

  // BYOK : rien à afficher si la clé est configurée ; sinon bouton vers
  // les paramètres.
  keyRowEl.classList.toggle("hidden", Boolean(state.hasApiKey));

  // Erreur de session affichée seulement si AUCUNE source compte n'est
  // disponible : une sonde du plan qui échoue (HTTP 404…) ne doit pas
  // afficher « connectez-vous » quand le budget du compte est bien lu.
  const hasAccountSource = b?.mode === "account";
  const err = hasAccountSource
    ? null
    : acc.consoleCreditsError ?? acc.accountBudgetError ?? acc.subscriptionPlanError ?? null;
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
btnConfigKey.addEventListener("click", () => chrome.runtime.openOptionsPage());
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
