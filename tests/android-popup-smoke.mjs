// Smoke test de la détection Android de la pop-up (fix "pop-up toute petite"
// sur Firefox for Android, 2026-11-16) :
// popup.js pose html.android si l'UA contient "Android" OU si
// chrome.runtime.getPlatformInfo().os === "android" (l'UA de la pop-up Fenix
// peut être réduit et ne plus contenir "Android").
// 1. UA desktop + getPlatformInfo "win"   -> PAS de classe android
// 2. UA réduit (sans "Android") + os "android" -> classe android posée
// 3. UA "Android" + os "win" (incohérent) -> classe android posée (l'UA gagne)
// Usage : node tests/android-popup-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/popup/popup.js", import.meta.url),
  "utf8"
);

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

function makeEl() {
  const el = {
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
    style: {},
    children: [],
    addEventListener() {},
    append(...n) { this.children.push(...n); },
    replaceChildren(...n) { this.children = n; },
    setAttribute() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    contains() { return false; },
    focus() {},
    click() {},
  };
  return el;
}

function runPopup({ userAgent, os }) {
  const documentElement = makeEl();
  const body = makeEl();
  const document = {
    documentElement,
    body,
    getElementById: () => makeEl(),
    createElement: () => makeEl(),
    createDocumentFragment: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const chrome = {
    runtime: {
      getPlatformInfo: (cb) => cb({ os }),
      getManifest: () => ({ version: "1.0.0" }),
      sendMessage: async () => ({ lang: "fr", settings: {} }),
      lastError: null,
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener() {} },
    },
    tabs: { create: async () => {} },
  };
  const sandbox = {
    document,
    chrome,
    navigator: { userAgent },
    window: {
      screen: { height: 2400 },
      outerHeight: 2337,
      NetstralChangelog: [],
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return {
    android: documentElement.classList.contains("android"),
    minHeight: body.style.minHeight || "",
  };
}

// 1. Desktop Windows : rien ne doit être appliqué.
{
  const r = runPopup({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/145.0",
    os: "win",
  });
  check("desktop (UA win + os win) -> pas de classe android", !r.android);
}

// 2. Fenix Android avec UA réduit : getPlatformInfo doit sauver le coup.
{
  const r = runPopup({
    userAgent: "Mozilla/5.0 (Mobile; rv:145.0) Gecko/145.0 Firefox/145.0",
    os: "android",
  });
  check(
    "UA réduit + os android -> classe android posée",
    r.android,
    `minHeight=${r.minHeight}`
  );
  // Le min-height JS a été supprimé : la hauteur plein écran vient uniquement
  // du CSS (html.android body { min-height: 100vh }), jamais d'un style inline
  // (un min-height > viewport poussait le footer .links sous le pli Fenix).
  check("aucun min-height inline posé sur body", r.minHeight === "", r.minHeight);
}

// 3. UA Android explicite : la classe est posée même si os est incohérent.
{
  const r = runPopup({
    userAgent: "Mozilla/5.0 (Android 16; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0",
    os: "win",
  });
  check("UA Android -> classe android posée", r.android);
}

if (results.some((r) => !r)) process.exit(1);
console.log("OK android-popup-smoke");
