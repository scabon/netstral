// Webstral - données du changelog, affichées dans la vue « Changelog » de la
// pop-up (extension/changelog.js -> window.WebstralChangelog).
// Le changelog reste en FR (historique) : pas dans i18n.js, donc pas de
// contrainte de parité fr/en. Le thème est appliqué par la pop-up.
// Chaque entrée : { h: "vX.Y.Z — titre", p: "paragraphe (HTML accepté)" }.
window.WebstralChangelog = [
  {
    h: "v0.5.2 — changelog dans la pop-up",
    p: "Le changelog migre dans la pop-up : vue dédiée « Changelog » ouverte depuis le menu ⋮ (bouton retour ←, pattern wagonBAR), comme les réglages. La page <code>pages/changelog.html</code> disparaît ; les entrées vivent dans <code>changelog.js</code>.",
  },
  {
    h: "v0.5.1 — réglages en vue dédiée + notif de reset",
    p: "Les réglages passent dans une vue dédiée de la pop-up, ouverte depuis le menu ⋮ (« Réglages ») avec bouton retour ← (pattern wagonBAR). Nouvelle option de notification : « Me notifier à la réinitialisation du quota » — détection par changement de période de facturation (resetAt ou mois calendaire), une seule notif par période.",
  },
  {
    h: "v0.5.0 — toute la conf dans la pop-up",
    p: "La page d'options disparaît : la pop-up accueille une carte « Réglages » (thème et langue en selects à drapeaux/icônes comme wagonBAR, alertes à seuil, clé API). Sections retirées : connexion & modèles, accès réseau, usage réel du compte, comptage local, liens rapides (restent en bas de la pop-up), « à venir ». Le CSS partagé vit dans <code>shared.css</code> (page about).",
  },
  {
    h: "v0.4.4 — « Ouvrir le chat » redirige vers chat.mistral.ai",
    p: "Le bouton 💬 est en haut de la pop-up (header, à côté du menu ⋮) et ouvre simplement <code>chat.mistral.ai</code> dans un onglet — plus besoin d'ouvrir le side panel depuis la pop-up.",
  },
  {
    h: "v0.4.3 — fix « Ouvrir le chat »",
    p: "Le bouton ne faisait rien : <code>chrome.tabs.query({currentWindow:true})</code> depuis le service worker ne renvoie pas de fenêtre fiable, le <code>windowId</code> partait <code>undefined</code> et <code>sidePanel.open</code> échouait. La pop-up envoie maintenant son propre <code>windowId</code> (<code>chrome.windows.getCurrent</code>), fallback <code>getLastFocused</code> côté background.",
  },
  {
    h: "v0.4.2 — bouton refresh dans la pop-up",
    p: "Bouton ⟳ à droite de la ligne « lu il y a… » (sous le pourcentage), hors du menu ; l'icône tourne pendant l'actualisation. La ligne source est simplifiée : « lu il y a X min » (la source n'est plus répétée).",
  },
  {
    h: "v0.4.1 — liens console/admin en bas de la pop-up",
    p: "Les liens Console Mistral et Abonnement (admin) sont directement en bas de la pop-up (ancres ouvrant un onglet), plus besoin d'ouvrir le menu ⋮.",
  },
  {
    h: "v0.4.0 — alertes, liens rapides, langue & thème",
    p: "Notification navigateur quand la consommation franchit un seuil réglable (désactivable) ; liens rapides vers console.mistral.ai et admin.mistral.ai/subscription dans le menu ⋮ de la pop-up et dans les paramètres ; langue (système / FR / EN) et thème (système / clair / sombre) dans les paramètres, appliqués à la pop-up, au side panel et à la page À propos (i18n embarqué <code>i18n.js</code>).",
  },
  {
    h: "v0.3.4 — projection graphique",
    p: "La projection devient une piste graphique : consommé en couleur (comme le badge), tick rouge à 100 %, zone hachurée au-delà de 100 % quand l'échelle déborde, et marqueur « ~X % » à la fin de période (rouge s'il dépasse 100 %). Lignes de rythme et de jours avant 100 % conservées dessous.",
  },
  {
    h: "v0.3.3 — une seule carte + projection",
    p: "Consommation, facturation (crédits PAYG, réinitialisation, type de plan, clé API) et projection sont regroupées dans une seule carte. Projection : rythme actuel en %/jour, % estimé en fin de période (peut dépasser 100 %) et nombre de jours avant 100 % à ce rythme. Période = mois entre deux reset (resetAt connu) ou mois calendaire UTC en repli.",
  },
  {
    h: "v0.3.2 — pop-up : masquages et « dans X jours »",
    p: "« Type de plan » masqué tant que la valeur n'est pas reconnue ; ligne BYOK masquée si la clé est configurée, remplacée sinon par un bouton « Configurer la clé API » (ouvre les paramètres) ; sous la date de réinitialisation, affichage « dans X jours » ; le doublon « compte lu il y a… » du bas est supprimé (on garde celui de la ligne de conso).",
  },
  {
    h: "v0.3.1 — corrections pop-up",
    p: "Comptage local masqué dès que la conso du compte Mistral est disponible ; dates au format <code>yyyy-MM-dd</code> (UTC) ; le message « connectez-vous » ne s'affiche plus quand une source compte est lue (une sonde du plan qui échoue n'est plus signalée comme une erreur de session) ; classification du plan élargie (free/pro/basic/team/scale/trial/PAYG/entreprise) avec le brut exposé en debug dans les options.",
  },
  {
    h: "v0.3.0 — pop-up de l'icône",
    p: "Le clic sur l'icône ouvre une pop-up : barre de progression de la consommation (même % et couleur que le badge), type de plan du compte Mistral (gratuit / pro / entreprise, lu depuis la session), crédits PAYG restants, réinitialisation, clé API configurée ou non, et usage local du mois. Menu : ouvrir le chat (side panel / sidebar), actualiser, paramètres, changelog, à propos.",
  },
  {
    h: "v0.2.9 — libellés des options",
    p: "Nettoyage des libellés de la page d'options après validation.",
  },
  {
    h: "v0.2.8 — badge sur le plan Vibe",
    p: "Cartographie complète du BFF admin : <code>billing.budget</code> embarque deux sous-budgets, <code>api_budget</code> (allocation incluse) et <code>vibe_budget</code> (le plan Vibe affiché sur /subscription). Priorité du badge : plan Vibe > allocation API > crédits PAYG > comptage local.",
  },
  {
    h: "v0.2.2 — support Firefox",
    p: "Un seul manifest cross-browser : <code>side_panel</code> (Chrome) + <code>sidebar_action</code> (Firefox), service worker + event page, permissions réseau opt-in sur Firefox MV3.",
  },
  {
    h: "v0.2.1 — usage réel du compte",
    p: "Le badge lit <code>admin.mistral.ai/api/local-trpc/billing.budget</code> avec le cookie de session Mistral : consommation réelle du compte (tous canaux), rafraîchie toutes les 30 min et après chaque tour.",
  },
  {
    h: "v0.2 — badge de consommation local",
    p: "Compteur mensuel des tokens passés par Webstral (champ <code>usage</code> des réponses), badge % avec seuils vert/orange/rouge configurables.",
  },
  {
    h: "v0.1 — squelette",
    p: "Extension Manifest V3 : chat Mistral en streaming (SSE) dans le side panel, BYOK (clé API collée dans les options), sélecteur de modèle.",
  },
];
