// Smoke test du mode Firefox : pas de chrome.sidePanel — l'icône doit ouvrir
// la sidebar via chrome.sidebarAction.open (enregistré sur action.onClicked).
// Usage : node tests/ff-sidebar-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const installedListeners = [];
const clickListeners = [];
const sidebarOpens = [];
const badgeCalls = [];

const chromeMock = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    onInstalled: { addListener: (fn) => installedListeners.push(fn) },
    onStartup: { addListener: (fn) => installedListeners.push(fn) },
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} },
  },
  // mode Firefox : pas de sidePanel
  sidePanel: undefined,
  sidebarAction: {
    open: (opts) => {
      sidebarOpens.push(opts);
      return Promise.resolve();
    },
  },
  action: {
    onClicked: { addListener: (fn) => clickListeners.push(fn) },
    setBadgeText: async ({ text }) => badgeCalls.push(["text", text]),
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {},
  },
};

const context = vm.createContext({
  chrome: chromeMock,
  console,
  fetch: async () => ({ ok: false, status: 401 }),
  TextDecoder,
  TextEncoder,
  AbortController,
  setTimeout,
  clearTimeout,
  Date,
});
vm.runInContext(code, context);

// onInstalled doit brancher la sidebar sans jamais toucher sidePanel
await installedListeners[0]();
console.log("sidebar branchée:", clickListeners.length === 1);

// clic simulé → sidebarAction.open
await clickListeners[0]({ windowId: 42 });
console.log("opens:", JSON.stringify(sidebarOpens));
await new Promise((r) => setTimeout(r, 100));

const pass =
  clickListeners.length === 1 &&
  sidebarOpens.length === 1 &&
  sidebarOpens[0].windowId === 42;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
