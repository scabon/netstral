// Netstral - données du changelog, affichées dans la vue « Changelog » de la
// pop-up (extension/changelog.js -> window.NetstralChangelog).
// Entrées, plus récente en premier : { h: "vX.Y.Z — titre", p: "paragraphe (HTML accepté)" }.
// La première entrée doit matcher la version du manifest (tools/check-changelog.py).
window.NetstralChangelog = [
  {
    h: "v1.0.0 — Release initiale",
    p: "Première version publique : Netstral lit la consommation de ton compte Mistral (crédits PAYG, budget du plan) via la session console, l'affiche sur l'icône et dans la pop-up, avec projection de fin de période et alertes à seuil. Sans session, un comptage local des tokens sert de repli.",
  },
];
