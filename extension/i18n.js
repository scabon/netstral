// Netstral - i18n embarqué (fr/en). La langue "system" suit chrome.i18n.getUILanguage().
// Les éléments portant data-flag (selects de langue/thème, style wagonBAR)
// voient leur texte préfixé par l'emoji du flag.
// Utilisable en <script> classique (attache globalThis.NetstralI18n) et en test Node (vm).

const I18N_MESSAGES = {
  fr: {
    appName: "Netstral",
    menu_openChat: "Ouvrir le chat",
    menu_refresh: "Actualiser la conso",
    menu_changelog: "Changelog",
    menu_about: "À propos",
    menu_settings: "Réglages",
    menu_help: "Aide",
    back: "Retour",
    menu_console: "Console Mistral",
    menu_subscription: "Abonnement (admin)",
    conso_title: "Consommation",
    conso_local_fallback: "Comptage local (pas de session Mistral)",
    conso_no_budget: "Aucun budget suivi pour l'instant.",
    conso_no_budget_hint:
      "Connectez-vous sur console.mistral.ai ou définissez un budget de tokens dans les réglages.",
    refresh_in_progress: "Actualisation…",
    err_prefix: "Erreur :",
    ago_now: "à l'instant",
    ago_min: "il y a {n} min",
    ago_hour: "il y a {n} h",
    read_ago: "lu {ago}",
    amount_of: "{a} sur {b}",
    tokens_of: "{a} tokens sur {b}",
    badge_plan_vibe: "plan Vibe",
    badge_allocation: "allocation API",
    badge_payg: "crédits PAYG",
    badge_local: "comptage local",
    plan_label: "Type de plan",
    plan_free: "Gratuit",
    plan_pro: "Pro",
    plan_enterprise: "Entreprise",
    plan_team: "Team",
    plan_scale: "Scale",
    plan_trial: "Essai",
    plan_basic: "Basique",
    plan_payg: "PAYG",
    wallet_label: "Crédits PAYG",
    wallet_restants: "{n} restants",
    wallet_none: "aucun crédit",
    reset_label: "Réinitialisation",
    reset_in_days: "dans {n} jours",
    reset_tomorrow: "demain",
    reset_today: "aujourd'hui",
    session_error_connect: "{err} Connectez-vous sur {link}.",
    proj_title: "Projection fin de période",
    proj_rate: "Rythme actuel : {r} %/jour ({e} j écoulés sur {p}, réinit dans {d} j)",
    proj_100_before: "À ce rythme, 100 % atteints dans ~{n} j (avant la réinitialisation)",
    proj_100_after: "À ce rythme, 100 % atteints dans ~{n} j (après la réinitialisation)",
    proj_100_none: "Aucune conso pour l'instant — 100 % hors de portée à ce rythme.",
    local_title: "Netstral ce mois-ci",
    local_tokens: "Tokens (comptage local)",
    notif_title: "Netstral — consommation à {pct} %",
    notif_body: "{label} : {pct} % du budget consommé ({amount}).",
    // réglages (dans la pop-up)
    set_title: "Réglages",
    set_theme_label: "Thème",
    set_theme_system: "Système",
    set_theme_light: "Clair",
    set_theme_dark: "Sombre",
    set_lang_label: "Langue",
    set_lang_system: "Système",
    set_alerts_enabled: "Activer les notifications",
    set_alert_pct_label: "Me notifier à (%)",
    set_notify_reset: "Me notifier à la réinitialisation du quota",
    notif_reset_title: "Netstral — quota réinitialisé",
    notif_reset_body: "Nouveau cycle de facturation : la consommation repart de 0.",
    // aide (contenu de la vue Aide)
    help_lead:
      "Suivez votre consommation Mistral (badge sur l'icône) et ouvrez chat.mistral.ai en un clic.",
    help_byok_h: "Aucune clé API requise",
    help_byok_p:
      "Netstral n'appelle jamais l'API Mistral : il suffit d'être connecté à console.mistral.ai dans ce navigateur. L'extension lit la facturation avec le cookie de session ; aucune donnée ne transite par un serveur intermédiaire.",
    help_usage_h: "Consommation du compte",
    help_usage_p:
      "Connecté sur console.mistral.ai dans ce navigateur, l'extension lit la consommation réelle du compte (cookie de session, aucun mot de passe demandé) et l'affiche sur l'icône et dans la pop-up. Sans session, aucune donnée n'est disponible (le chat se fait sur chat.mistral.ai, hors extension).",
    help_links_h: "Liens",
    help_links_sub: "Abonnement (admin.mistral.ai)",
    help_links_src: "Code source (GitHub scabon/netstral)",
    help_project_h: "Projet",
    help_project_p:
      "Projet personnel de la famille Cabon14 — compagnon navigateur de Monstral (WearOS). Chrome/Edge (Manifest V3) et Firefox. Non publié sur les stores à ce stade.",
    // à propos (vue À propos, style wagonBAR : site / support / dons)
    about_tagline:
      "Extension navigateur pour discuter avec les modèles Mistral, avec un badge de consommation de tokens sur l'icône.",
    about_note:
      "Projet personnel, non affilié à Mistral. Vos données restent dans votre navigateur.",
    made_by: "Créé par :",
    about_site: "cabon14.com",
    support_label: "Assistance :",
    support_email: "support@cabon14.com",
    donate_title: "Soutenir Netstral",
    donate_liberapay: "Soutenir sur Liberapay",
    donate_tipeee: "Pourboire sur Tipeee",
  },
  en: {
    appName: "Netstral",
    menu_openChat: "Open chat",
    menu_refresh: "Refresh usage",
    menu_changelog: "Changelog",
    menu_about: "About",
    menu_settings: "Settings",
    menu_help: "Help",
    back: "Back",
    menu_console: "Mistral console",
    menu_subscription: "Subscription (admin)",
    conso_title: "Usage",
    conso_local_fallback: "Local count (no Mistral session)",
    conso_no_budget: "No budget tracked yet.",
    conso_no_budget_hint:
      "Sign in to console.mistral.ai or set a token budget in the settings.",
    refresh_in_progress: "Refreshing…",
    err_prefix: "Error:",
    ago_now: "just now",
    ago_min: "{n} min ago",
    ago_hour: "{n} h ago",
    read_ago: "read {ago}",
    amount_of: "{a} of {b}",
    tokens_of: "{a} tokens of {b}",
    badge_plan_vibe: "Vibe plan",
    badge_allocation: "API allowance",
    badge_payg: "PAYG credits",
    badge_local: "local count",
    plan_label: "Plan type",
    plan_free: "Free",
    plan_pro: "Pro",
    plan_enterprise: "Enterprise",
    plan_team: "Team",
    plan_scale: "Scale",
    plan_trial: "Trial",
    plan_basic: "Basic",
    plan_payg: "PAYG",
    wallet_label: "PAYG credits",
    wallet_restants: "{n} left",
    wallet_none: "no credits",
    reset_label: "Reset",
    reset_in_days: "in {n} days",
    reset_tomorrow: "tomorrow",
    reset_today: "today",
    session_error_connect: "{err} Sign in to {link}.",
    proj_title: "End-of-period projection",
    proj_rate: "Current rate: {r} %/day ({e} of {p} days elapsed, reset in {d} d)",
    proj_100_before: "At this rate, 100 % reached in ~{n} d (before reset)",
    proj_100_after: "At this rate, 100 % reached in ~{n} d (after reset)",
    proj_100_none: "No usage yet — 100 % out of reach at this rate.",
    local_title: "Netstral this month",
    local_tokens: "Tokens (local count)",
    notif_title: "Netstral — usage at {pct} %",
    notif_body: "{label}: {pct} % of the budget used ({amount}).",
    set_title: "Settings",
    set_theme_label: "Theme",
    set_theme_system: "System",
    set_theme_light: "Light",
    set_theme_dark: "Dark",
    set_lang_label: "Language",
    set_lang_system: "System",
    set_alerts_enabled: "Enable notifications",
    set_alert_pct_label: "Notify me at (%)",
    set_notify_reset: "Notify me when the quota resets",
    notif_reset_title: "Netstral — quota reset",
    notif_reset_body: "New billing cycle: usage is back to 0.",
    help_lead:
      "Track your Mistral usage (badge on the toolbar icon) and open chat.mistral.ai in one click.",
    help_byok_h: "No API key needed",
    help_byok_p:
      "Netstral never calls the Mistral API: just be signed in to console.mistral.ai in this browser. The extension reads billing through the session cookie; no data goes through any intermediary server.",
    help_usage_h: "Account usage",
    help_usage_p:
      "Signed in to console.mistral.ai in this browser, the extension reads the account's real usage (session cookie, no password asked) and shows it on the icon and in the pop-up. Without a session, no data is available (chat happens on chat.mistral.ai, outside the extension).",
    help_links_h: "Links",
    help_links_sub: "Subscription (admin.mistral.ai)",
    help_links_src: "Source code (GitHub scabon/netstral)",
    help_project_h: "Project",
    help_project_p:
      "Cabon14 family personal project — browser companion of Monstral (WearOS). Chrome/Edge (Manifest V3) and Firefox. Not published on stores yet.",
    about_tagline:
      "Browser extension to chat with Mistral models, with a token-usage badge on the toolbar icon.",
    about_note:
      "Personal project, not affiliated with Mistral. Your data stays in your browser.",
    made_by: "Made by:",
    about_site: "cabon14.com",
    support_label: "Support:",
    support_email: "support@cabon14.com",
    donate_title: "Support Netstral",
    donate_liberapay: "Donate on Liberapay",
    donate_tipeee: "Tip on Tipeee",
  },
};

function resolveLang(setting, uiLang) {
  if (setting === "fr" || setting === "en") return setting;
  return String(uiLang || "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

// t(key, subs) avec interpolation {name}
function makeT(lang) {
  const dict = I18N_MESSAGES[lang] ?? I18N_MESSAGES.fr;
  const fr = I18N_MESSAGES.fr;
  return (key, subs) => {
    let s = dict[key] ?? fr[key] ?? key;
    if (subs) {
      for (const [k, v] of Object.entries(subs)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  };
}

// Applique t() au DOM : [data-i18n] -> textContent (préfixé de data-flag si
// présent, style wagonBAR pour les selects), [data-i18n-ph] -> placeholder,
// [data-i18n-title] -> title.
function applyI18n(root, t) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const flag = el.dataset.flag ? el.dataset.flag + " " : "";
    el.textContent = flag + t(el.getAttribute("data-i18n"));
  }
  for (const el of root.querySelectorAll("[data-i18n-ph]")) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  }
}

// Thème : applique data-theme="dark"|"light" sur <html>.
function applyTheme(theme) {
  const dark =
    theme === "dark" ||
    (theme !== "light" &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return dark;
}

if (typeof globalThis !== "undefined") {
  globalThis.NetstralI18n = { I18N_MESSAGES, resolveLang, makeT, applyI18n, applyTheme };
}
