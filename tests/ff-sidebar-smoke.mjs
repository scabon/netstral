// Smoke test de l'ouverture du panneau de chat depuis la pop-up :
// le message "openChat" doit ouvrir le side panel (Chrome : sidePanel.open)
// ou la sidebar (Firefox : sidebarAction.open, pas de chrome.sidePanel).
// Usage : node tests/ff-sidebar-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

function makeContext({ withSidePanel }) {
  const messageListeners = [];
  const opens = [];
  const chromeMock = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      i18n: { getUILanguage: () => "fr-FR" },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      getManifest: () => ({ version: "0.3.0" }),
    },
    windows: { getLastFocused: async () => ({ id: 42 }) },
    sidePanel: withSidePanel
      ? { open: async (opts) => opens.push(["sidePanel", opts]) }
      : undefined,
    sidebarAction: !withSidePanel
      ? {
          open: (opts) => {
            opens.push(["sidebar", opts]);
            return Promise.resolve();
          },
        }
      : undefined,
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    alarms: { onAlarm: { addListener: () => {} }, create: () => {} },
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
  vm.runInContext(readFileSync(new URL("../extension/i18n.js", import.meta.url), "utf8") + "\n" + code, context);
  const send = (msg) =>
    new Promise((resolve) => {
      for (const l of messageListeners) l(msg, {}, resolve);
    });
  return { send, opens };
}

async function scenario(name, withSidePanel, expectedApi, msg, expectedWindowId) {
  const { send, opens } = makeContext({ withSidePanel });
  const res = await send(msg);
  const ok =
    res?.ok === true &&
    opens.length === 1 &&
    opens[0][0] === expectedApi &&
    opens[0][1].windowId === expectedWindowId;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: res=${JSON.stringify(res)} opens=${JSON.stringify(opens)}`
  );
  return ok;
}

const results = [];
results.push(
  await scenario("Chrome, windowId explicite -> sidePanel.open", true, "sidePanel", { type: "openChat", windowId: 7 }, 7)
);
results.push(
  await scenario("Chrome, sans windowId -> getLastFocused (42)", true, "sidePanel", { type: "openChat" }, 42)
);
results.push(
  await scenario("Firefox, windowId explicite -> sidebarAction.open", false, "sidebar", { type: "openChat", windowId: 7 }, 7)
);
results.push(
  await scenario("Firefox, sans windowId -> getLastFocused (42)", false, "sidebar", { type: "openChat" }, 42)
);

const pass = results.every(Boolean);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
