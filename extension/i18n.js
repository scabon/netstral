// Webstral - i18n embarqué (fr/en). La langue "system" suit chrome.i18n.getUILanguage().
// Utilisable en <script> classique (attache globalThis.WebstralI18n) et en test Node (vm).

const I18N_MESSAGES = {
  fr: {
    appName: "Webstral",
    menu_openChat: "Ouvrir le chat",
    menu_refresh: "Actualiser la conso",
    menu_options: "Paramètres",
    menu_changelog: "Changelog",
    menu_about: "À propos",
    menu_console: "Console Mistral",
    menu_subscription: "Abonnement (admin)",
    conso_title: "Consommation",
    conso_local_fallback: "Comptage local (pas de session Mistral)",
    conso_no_budget: "Aucun budget suivi pour l'instant.",
    conso_no_budget_hint:
      "Connectez-vous sur console.mistral.ai ou définissez un budget de tokens dans les paramètres.",
    refresh_in_progress: "Actualisation…",
    err_prefix: "Erreur :",
    ago_now: "à l'instant",
    ago_min: "il y a {n} min",
    ago_hour: "il y a {n} h",
    source_lu: "Source : {source} — lu {ago}",
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
    key_label: "Clé API (BYOK)",
    key_config_btn: "Configurer la clé API",
    session_error_connect: "{err} Connectez-vous sur {link}.",
    proj_title: "Projection fin de période",
    proj_rate: "Rythme actuel : {r} %/jour ({e} j écoulés sur {p}, réinit dans {d} j)",
    proj_100_before: "À ce rythme, 100 % atteints dans ~{n} j (avant la réinitialisation)",
    proj_100_after: "À ce rythme, 100 % atteints dans ~{n} j (après la réinitialisation)",
    proj_100_none: "Aucune conso pour l'instant — 100 % hors de portée à ce rythme.",
    local_title: "Webstral ce mois-ci",
    local_tokens: "Tokens (comptage local)",
    notif_title: "Webstral — consommation à {pct} %",
    notif_body: "{label} : {pct} % du budget consommé ({amount}).",
    // options
    opt_title: "Webstral — Paramètres",
    opt_lead:
      "Webstral appelle directement l'API Mistral depuis votre navigateur (BYOK — Bring Your Own Key). Aucune donnée ne transite ailleurs.",
    opt_section_network: "Accès réseau de l'extension",
    opt_perm_ok: "Accès réseau accordé (api.mistral.ai, admin.mistral.ai, console.mistral.ai).",
    opt_perm_ko: "Accès réseau non accordé : activez-le pour que le chat et le badge fonctionnent.",
    opt_perm_btn: "Activer l'accès réseau",
    opt_perm_denied:
      "Accès refusé. Il peut aussi être accordé depuis about:addons → Webstral → Permissions.",
    opt_section_key: "Clé API Mistral",
    opt_key_help_prefix: "Créez une clé sur",
    opt_key_help_suffix: "(La Plateforme). Elle reste stockée localement dans l'extension.",
    opt_section_conn: "Connexion & modèles",
    opt_test_btn: "Tester la connexion et charger les modèles",
    opt_model_note: "Le modèle par défaut se choisit dans le bandeau du side panel.",
    opt_section_usage: "Usage réel du compte (badge)",
    opt_usage_help_prefix:
      "Affiché en priorité sur le badge : la consommation réelle du compte Mistral (tous canaux — API, Studio, Webstral…), lue depuis votre session Mistral dans ce navigateur (connectez-vous sur",
    opt_usage_help_suffix:
      "Aucun mot de passe n'est demandé : l'extension lit le cookie de session existant.",
    opt_refresh_btn: "Actualiser depuis la session Mistral",
    opt_probe_btn: "Diagnostic console (cartographie brute)",
    opt_section_local: "Comptage local (repli sans session)",
    opt_local_help:
      "Sans session Mistral valide, le badge utilise ce comptage : uniquement les tokens passés par Webstral, par mois calendaire.",
    opt_budget_label: "Budget mensuel (tokens)",
    opt_warn_label: "Badge orange à (%)",
    opt_danger_label: "rouge à (%)",
    opt_section_display: "Affichage",
    opt_lang_label: "Langue",
    opt_lang_system: "Système",
    opt_lang_fr: "Français",
    opt_lang_en: "English",
    opt_theme_label: "Thème",
    opt_theme_system: "Système",
    opt_theme_light: "Clair",
    opt_theme_dark: "Sombre",
    opt_section_alerts: "Alertes de consommation",
    opt_alerts_help: "Une notification navigateur est envoyée quand la consommation franchit le seuil.",
    opt_alerts_enabled: "Activer les notifications",
    opt_alert_pct_label: "Me notifier à (%)",
    opt_section_links: "Liens rapides",
    opt_link_console: "Console Mistral (clés API, usage)",
    opt_link_subscription: "Abonnement (admin.mistral.ai)",
    opt_section_todo: "À venir",
    opt_todo_text:
      "« Ask Webstral » sur sélection de texte, Admin API (Enterprise) pour un usage facturé hors session.",
    opt_sub_account: "Abonnement Mistral",
    opt_badge_source: "Badge :",
    opt_usage_now: "Ce mois-ci : {tokens} tokens ({in} in, {out} out).",
    opt_usage_now_pct: " Budget : {pct}% consommé.",
    opt_usage_now_nobudget: " Définissez un budget pour activer le badge.",
    opt_status_no_key: "Collez d'abord une clé API.",
    opt_status_testing: "Test en cours…",
    opt_status_ok_models: "OK — {n} modèle{plural} disponibles.",
    opt_budget_reading: "Lecture en cours…",
    opt_budget_none: "Pas de réponse du fond.",
    opt_plan_vibe_page: "Plan Vibe (page abonnement)",
    opt_api_allowance: "Allocation API incluse",
    opt_reset_on: "réinitialisé le {d}",
    opt_absent: "absent de la réponse",
    opt_wallet_empty: "vide — aucun crédit prépayé",
    opt_unrecognized: "lu, mais champs non reconnus — voir diagnostic",
    opt_not_read: "pas encore lu",
    opt_plan_unrecognized: "non reconnu — brut ci-dessous",
    opt_plan_source: "plan source :",
    opt_plan_raw: "plan brut :",
    opt_strings: "chaînes :",
    opt_dbg_fields: "champs console :",
    opt_dbg_preview: "aperçu credits :",
    opt_dbg_admin: "champs admin :",
    opt_dbg_empty: "(vide)",
    // sidepanel
    sp_placeholder: "Message à Webstral… (Entrée pour envoyer, Maj+Entrée pour un saut de ligne)",
    sp_new_chat: "Nouvelle conversation",
    sp_options: "Paramètres",
    sp_send: "Envoyer",
    sp_err_no_key: "Aucune clé API configurée. Ouvrez les options de Webstral pour la coller.",
    sp_err_no_key_local: "Configurez votre clé API Mistral dans les paramètres (roue dentée).",
    sp_hint: "Posez une question à Webstral.",
    sp_meta: "{in} tokens in, {out} tokens out",
    // about
    about_title: "Webstral — À propos",
    about_lead:
      "Discutez avec les modèles Mistral depuis n'importe quel onglet, avec un badge de consommation de tokens sur l'icône.",
    about_byok_h: "BYOK — Bring Your Own Key",
    about_byok_p:
      "Webstral appelle directement l'API Mistral (api.mistral.ai) depuis votre navigateur, avec votre propre clé API. Aucune donnée ne transite par un serveur intermédiaire ; la clé reste stockée localement dans l'extension.",
    about_usage_h: "Consommation du compte",
    about_usage_p:
      "Connecté sur console.mistral.ai dans ce navigateur, l'extension lit la consommation réelle du compte (cookie de session, aucun mot de passe demandé) et l'affiche sur l'icône et dans la pop-up. Sans session, elle retombe sur un comptage local des tokens passés par Webstral.",
    about_links_h: "Liens",
    about_links_keys: "Créer une clé API (La Plateforme)",
    about_links_sub: "Abonnement (admin.mistral.ai)",
    about_links_src: "Code source (GitHub scabon/webstral)",
    about_project_h: "Projet",
    about_project_p:
      "Projet personnel de la famille Cabon14 — compagnon navigateur de Monstral (WearOS). Chrome/Edge (Manifest V3, side panel) et Firefox (sidebar). Non publié sur les stores à ce stade.",
  },
  en: {
    appName: "Webstral",
    menu_openChat: "Open chat",
    menu_refresh: "Refresh usage",
    menu_options: "Settings",
    menu_changelog: "Changelog",
    menu_about: "About",
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
    source_lu: "Source: {source} — read {ago}",
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
    key_label: "API key (BYOK)",
    key_config_btn: "Configure API key",
    session_error_connect: "{err} Sign in to {link}.",
    proj_title: "End-of-period projection",
    proj_rate: "Current rate: {r} %/day ({e} of {p} days elapsed, reset in {d} d)",
    proj_100_before: "At this rate, 100 % reached in ~{n} d (before reset)",
    proj_100_after: "At this rate, 100 % reached in ~{n} d (after reset)",
    proj_100_none: "No usage yet — 100 % out of reach at this rate.",
    local_title: "Webstral this month",
    local_tokens: "Tokens (local count)",
    notif_title: "Webstral — usage at {pct} %",
    notif_body: "{label}: {pct} % of the budget used ({amount}).",
    opt_title: "Webstral — Settings",
    opt_lead:
      "Webstral calls the Mistral API directly from your browser (BYOK — Bring Your Own Key). No data goes through any intermediary.",
    opt_section_network: "Extension network access",
    opt_perm_ok: "Network access granted (api.mistral.ai, admin.mistral.ai, console.mistral.ai).",
    opt_perm_ko: "Network access not granted: enable it so chat and badge work.",
    opt_perm_btn: "Enable network access",
    opt_perm_denied:
      "Access denied. It can also be granted from about:addons → Webstral → Permissions.",
    opt_section_key: "Mistral API key",
    opt_key_help_prefix: "Create a key on",
    opt_key_help_suffix: "(La Plateforme). It stays stored locally in the extension.",
    opt_section_conn: "Connection & models",
    opt_test_btn: "Test connection and load models",
    opt_model_note: "The default model is chosen in the side panel header.",
    opt_section_usage: "Real account usage (badge)",
    opt_usage_help_prefix:
      "Shown first on the badge: the real usage of the Mistral account (all channels — API, Studio, Webstral…), read from your Mistral session in this browser (sign in to",
    opt_usage_help_suffix:
      "No password asked: the extension reads the existing session cookie.",
    opt_refresh_btn: "Refresh from Mistral session",
    opt_probe_btn: "Console diagnostic (raw mapping)",
    opt_section_local: "Local count (fallback without session)",
    opt_local_help:
      "Without a valid Mistral session, the badge uses this count: only tokens sent through Webstral, per calendar month.",
    opt_budget_label: "Monthly budget (tokens)",
    opt_warn_label: "Badge turns orange at (%)",
    opt_danger_label: "red at (%)",
    opt_section_display: "Display",
    opt_lang_label: "Language",
    opt_lang_system: "System",
    opt_lang_fr: "Français",
    opt_lang_en: "English",
    opt_theme_label: "Theme",
    opt_theme_system: "System",
    opt_theme_light: "Light",
    opt_theme_dark: "Dark",
    opt_section_alerts: "Usage alerts",
    opt_alerts_help: "A browser notification is sent when usage crosses the threshold.",
    opt_alerts_enabled: "Enable notifications",
    opt_alert_pct_label: "Notify me at (%)",
    opt_section_links: "Quick links",
    opt_link_console: "Mistral console (API keys, usage)",
    opt_link_subscription: "Subscription (admin.mistral.ai)",
    opt_section_todo: "Coming next",
    opt_todo_text:
      "“Ask Webstral” on text selection, Admin API (Enterprise) for billed usage without a session.",
    opt_sub_account: "Mistral subscription",
    opt_badge_source: "Badge:",
    opt_usage_now: "This month: {tokens} tokens ({in} in, {out} out).",
    opt_usage_now_pct: " Budget: {pct}% used.",
    opt_usage_now_nobudget: " Set a budget to enable the badge.",
    opt_status_no_key: "Paste an API key first.",
    opt_status_testing: "Testing…",
    opt_status_ok_models: "OK — {n} model{plural} available.",
    opt_budget_reading: "Reading…",
    opt_budget_none: "No response from the background.",
    opt_plan_vibe_page: "Vibe plan (subscription page)",
    opt_api_allowance: "Included API allowance",
    opt_reset_on: "reset on {d}",
    opt_absent: "missing from the response",
    opt_wallet_empty: "empty — no prepaid credits",
    opt_unrecognized: "read, but fields not recognized — see diagnostic",
    opt_not_read: "not read yet",
    opt_plan_unrecognized: "not recognized — raw below",
    opt_plan_source: "plan source:",
    opt_plan_raw: "raw plan:",
    opt_strings: "strings:",
    opt_dbg_fields: "console fields:",
    opt_dbg_preview: "credits preview:",
    opt_dbg_admin: "admin fields:",
    opt_dbg_empty: "(empty)",
    sp_placeholder: "Message to Webstral… (Enter to send, Shift+Enter for a new line)",
    sp_new_chat: "New conversation",
    sp_options: "Settings",
    sp_send: "Send",
    sp_err_no_key: "No API key configured. Open Webstral's options to paste it.",
    sp_err_no_key_local: "Configure your Mistral API key in the settings (gear icon).",
    sp_hint: "Ask Webstral anything.",
    sp_meta: "{in} tokens in, {out} tokens out",
    about_title: "Webstral — About",
    about_lead:
      "Chat with Mistral models from any tab, with a token-usage badge on the toolbar icon.",
    about_byok_h: "BYOK — Bring Your Own Key",
    about_byok_p:
      "Webstral calls the Mistral API (api.mistral.ai) directly from your browser, with your own API key. No data goes through an intermediary server; the key stays stored locally in the extension.",
    about_usage_h: "Account usage",
    about_usage_p:
      "Signed in to console.mistral.ai in this browser, the extension reads the account's real usage (session cookie, no password asked) and shows it on the icon and in the pop-up. Without a session, it falls back to a local count of tokens sent through Webstral.",
    about_links_h: "Links",
    about_links_keys: "Create an API key (La Plateforme)",
    about_links_sub: "Subscription (admin.mistral.ai)",
    about_links_src: "Source code (GitHub scabon/webstral)",
    about_project_h: "Project",
    about_project_p:
      "Cabon14 family personal project — browser companion of Monstral (WearOS). Chrome/Edge (Manifest V3, side panel) and Firefox (sidebar). Not published on stores yet.",
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

// Applique t() au DOM : [data-i18n] -> textContent, [data-i18n-ph] -> placeholder,
// [data-i18n-title] -> title.
function applyI18n(root, t) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
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
  globalThis.WebstralI18n = { I18N_MESSAGES, resolveLang, makeT, applyI18n, applyTheme };
}
