// Smoke test de CHARGEMENT de l'extension : attrape sans navigateur les erreurs
// du panneau « Erreurs » d'edge://extensions —
//  1. manifest.json valide (MV3) et tous les fichiers référencés existent ;
//  2. tous les .js de extension/ sont syntaxiquement valides ;
//  3. les refs locales (src/href) de popup.html existent ;
//  4. le service worker MV3 démarre sans erreur : importScripts y est mocké
//     comme dans Chrome/Edge (chemin relatif résolu par rapport à l'URL du
//     SW, donc background/) — régression « i18n load failed » (importScripts
//     de i18n.js en relatif pointait sur background/i18n.js, 404) ;
//  5. le handler "refreshBudget" appelle TOUJOURS sendResponse, même si
//     chrome.notifications.create ne se résout jamais — régression spinner
//     infini (le popup attendait la réponse indéfiniment).
// Usage : node tests/load-smoke.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const EXT = fileURLToPath(new URL("../extension/", import.meta.url));

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ---------- 1. Manifest ----------

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  check("manifest.json parse", true);
} catch (err) {
  check("manifest.json parse", false, err.message);
}
if (manifest) {
  check("manifest_version 3", manifest.manifest_version === 3);
  check("version présente", typeof manifest.version === "string" && /^\d+\.\d+(\.\d+)?$/.test(manifest.version), manifest.version);
  // Cross-browser volontaire : Firefox (>=121) ignore background.service_worker
  // et exige background.scripts ; Chromium MV3 interdit background.scripts.
  // -> l'erreur Edge en dev (« 'background.scripts' requires manifest version
  //    of 2 or lower ») est attendue sur le manifest source ; build-chrome.py
  //    la supprime pour le zip livré. Ne PAS retirer scripts du manifest source.
  check("manifest source cross-browser (service_worker + scripts conservés)",
    typeof manifest.background?.service_worker === "string" &&
      Array.isArray(manifest.background?.scripts) &&
      manifest.background.scripts.length > 0);
  const refs = [
    ...Object.values(manifest.icons ?? {}),
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
  ].filter(Boolean);
  const missing = refs.filter((r) => !existsSync(path.join(EXT, r)));
  check("fichiers référencés par le manifest existent", missing.length === 0,
    missing.length ? "manquants: " + missing.join(", ") : `${refs.length} refs`);
}

// ---------- 2. Syntaxe de tous les .js ----------

const jsFiles = readdirSync(EXT, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".js"));
let syntaxBad = [];
for (const f of jsFiles) {
  try {
    new vm.Script(readFileSync(path.join(EXT, f), "utf8"), { filename: f });
  } catch (err) {
    syntaxBad.push(`${f}: ${err.message}`);
  }
}
check("tous les .js passent le parse", syntaxBad.length === 0,
  syntaxBad.length ? syntaxBad.join(" | ") : `${jsFiles.length} fichiers`);

// ---------- 3. Refs locales de popup.html ----------

const popupHtml = readFileSync(path.join(EXT, "popup/popup.html"), "utf8");
const localRefs = [...popupHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((r) => !/^(https?:|#|data:)/.test(r));
const missingRefs = localRefs.filter((r) => !existsSync(path.join(EXT, "popup", r)));
check("refs locales de popup.html existent", missingRefs.length === 0,
  missingRefs.length ? "manquants: " + missingRefs.join(", ") : `${localRefs.length} refs`);

// ---------- 4 + 5. Service worker MV3 dans un vm ----------

// Mock fidèle au SW MV3 : importScripts résout un chemin relatif par rapport
// à l'URL du SW (background/background.js -> dossier background/), et un
// chemin absolu ("/...") depuis la racine de l'extension. Un fichier
// introuvable lève comme dans le navigateur.
const consoleErrors = [];
const messageListeners = [];
const stored = {
  settings: { lang: "fr", alertsEnabled: true, alertPct: 90, notifyOnReset: true },
  resetNotif: { period: "2026-10" }, // période passée -> notif reset déclenchée si resetAt connu
};
const chromeMock = {
  storage: {
    local: {
      get: async (k) => {
        const want = typeof k === "string" ? [k] : k;
        const out = {};
        for (const key of want) if (key in stored) out[key] = stored[key];
        return out;
      },
      set: async (obj) => Object.assign(stored, obj),
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    i18n: { getUILanguage: () => "fr-FR" },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    getManifest: () => ({ version: manifest?.version ?? "0.0" }),
  },
  // ne se résout JAMAIS : pire cas Edge MV3 pour une notification
  notifications: { create: () => new Promise(() => {}) },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
  alarms: { onAlarm: { addListener: () => {} }, create: () => {} },
};

const context = vm.createContext({
  chrome: chromeMock,
  console: { ...console, error: (...a) => consoleErrors.push(a.map(String).join(" ")) },
  fetch: async () => ({ ok: false, status: 401, redirected: false, url: "x" }),
  importScripts: (...paths) => {
    for (const p of paths) {
      const rel = p.startsWith("/") ? p.slice(1) : path.join("background", p);
      const full = path.join(EXT, rel);
      if (!existsSync(full)) throw new DOMException(`Failed to fetch dynamically imported module: ${p}`, "NetworkError");
      vm.runInContext(readFileSync(full, "utf8"), context, { filename: rel });
    }
  },
  TextDecoder,
  TextEncoder,
  AbortController,
  Date,
  setTimeout,
  clearTimeout,
});

let swThrew = null;
try {
  vm.runInContext(readFileSync(path.join(EXT, "background/background.js"), "utf8"), context, {
    filename: "background/background.js",
  });
} catch (err) {
  swThrew = err;
}
check("le service worker démarre sans exception", swThrew === null, swThrew ? String(swThrew) : "");
check("importScripts du SW ne loggue aucune erreur", consoleErrors.length === 0,
  consoleErrors.join(" | ").slice(0, 200));
check("NetstralI18n chargé dans le SW", vm.runInContext("typeof NetstralI18n", context) === "object");
check("tFor traduit err_session_http (fr)",
  vm.runInContext("tFor({lang:'fr'})('err_session_http',{status:401})", context) ===
    "Session Mistral absente/expirée (HTTP 401).");
check("tFor traduit err_session_http (en)",
  vm.runInContext("tFor({lang:'en'})('err_session_http',{status:401})", context) ===
    "Mistral session missing/expired (HTTP 401).");

// ---------- 5. refreshBudget répond toujours ----------

function send(msg) {
  return new Promise((resolve) => {
    const killer = setTimeout(() => resolve({ hung: true }), 3000);
    for (const listener of messageListeners)
      listener(msg, {}, (resp) => { clearTimeout(killer); resolve({ hung: false, resp }); });
  });
}

const r = await send({ type: "refreshBudget" });
check("refreshBudget -> sendResponse appelé même si notifications.create ne répond jamais",
  !r.hung, r.hung ? "HANG (régression spinner)" : "");

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
