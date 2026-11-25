// Netstral - données du changelog, affichées dans la vue « Changelog » de la
// pop-up (extension/changelog.js -> window.NetstralChangelog).
// Entrées, plus récente en premier : { h: "vX.Y.Z — titre", p: "paragraphe (texte brut, rendu via textContent)" }.
// La première entrée doit matcher la version du manifest (tools/check-changelog.py).
window.NetstralChangelog = [
  {
    h: "v1.0.3 — Lien Source vers le dépôt GitHub",
    p: "La vue À propos affiche désormais un lien « Source : github.com/scabon/netstral » vers le code source de l'extension, désormais public — couleur de lien lisible (accent, état visité inclus).",
  },
  {
    h: "v1.0.2 — Notif « quota réinitialisé » encore plus fiabilisée",
    p: "La notification de reset ne se déclenche désormais que quand la période de facturation avance réellement : une lecture de resetAt invalide (nombre 0/epoch — Date.parse(0) vaut l'an 2000 et passait le filtre de la v1.0.1, chaîne illisible, date antérieure à 2020), une oscillation entre sources (plan Vibe vs allocation API) ou une clé de période héritée d'une ancienne version ne déclenchent plus jamais la notification, et ne peuvent plus écraser la période connue. Un vrai changement de cycle (ex. 2026-12-01 -> 2027-01-01) notifie toujours une seule fois.",
  },
  {
    h: "v1.0.1 — Correctifs (Firefox Android, notifications, description)",
    p: "Pop-up sur Firefox for Android : affichage plein écran réparé (texte 16 px pleine largeur, liens « console / abonnement » visibles en bas de fenêtre — la classe android est désormais aussi détectée via getPlatformInfo, et un min-height JS qui dépassait le viewport de la fenêtre a été supprimé). Notification « quota réinitialisé » intempestive corrigée : une lecture de période invalide (nulle/epoch) n'est plus prise pour un nouveau cycle. Description corrigée : Netstral suit la consommation de ton compte Mistral (badge + pop-up) et ouvre chat.mistral.ai en un clic — il n'y a pas de chat intégré à l'extension.",
  },
  {
    h: "v1.0.0 — Release initiale",
    p: "Première version publique : Netstral lit la consommation de ton compte Mistral (crédits PAYG, budget du plan) via la session console, l'affiche sur l'icône et dans la pop-up, avec projection de fin de période et alertes à seuil. Sans session Mistral connectée, aucune donnée n'est affichée (le chat se fait sur chat.mistral.ai, hors extension).",
  },
];
