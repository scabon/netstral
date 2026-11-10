// Smoke test du moteur i18n embarqué : resolveLang (system/fr/en + UI language),
// makeT (fr/en, interpolation {name}, fallback clé inconnue).
// Usage : node tests/i18n-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/i18n.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({ globalThis: {}, console });
vm.runInContext(code, context);
const { resolveLang, makeT, I18N_MESSAGES } = context.globalThis.NetstralI18n;

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

check("system + UI fr-FR -> fr", resolveLang("system", "fr-FR") === "fr");
check("system + UI en-US -> en", resolveLang("system", "en-US") === "en");
check("system + UI vide -> en", resolveLang("system", "") === "en");
check("fr forcé -> fr", resolveLang("fr", "en-US") === "fr");
check("en forcé -> en", resolveLang("en", "fr-FR") === "en");

const tfr = makeT("fr");
const ten = makeT("en");
check("fr menu_openChat", tfr("menu_openChat") === "Ouvrir le chat");
check("en menu_openChat", ten("menu_openChat") === "Open chat");
check("fr interpolation", tfr("ago_min", { n: 5 }) === "il y a 5 min");
check("en interpolation", ten("reset_in_days", { n: 3 }) === "in 3 days");
check("clé inconnue -> clé", tfr("nope") === "nope");
check("parité fr/en", Object.keys(I18N_MESSAGES.fr).length === Object.keys(I18N_MESSAGES.en).length,
  `fr=${Object.keys(I18N_MESSAGES.fr).length} en=${Object.keys(I18N_MESSAGES.en).length}`);
I18N_MESSAGES.fr.test_only = "valeur-fr";
check("clé présente en fr seul -> fallback fr", ten("test_only") === "valeur-fr");

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
