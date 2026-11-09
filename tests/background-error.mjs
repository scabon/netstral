// Smoke test du chemin d'erreur : fetch répond 401 avec un corps JSON
// {message}; le service worker doit le relayer au side panel.
// Usage : node tests/background-error.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const connectListeners = [];
const sent = [];
const chromeMock = {
  storage: {
    local: { get: async (k) => ({ apiKey: "bad-key" }) },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: (fn) => connectListeners.push(fn) },
    onMessage: { addListener: () => {} },
  },
  sidePanel: { setPanelBehavior: async () => {} },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {},
  },
};

globalThis.fetch = async () => ({
  ok: false,
  status: 401,
  statusText: "Unauthorized",
  json: async () => ({ message: "Unauthorized: invalid API key" }),
});

const context = vm.createContext({
  chrome: chromeMock,
  console,
  fetch: globalThis.fetch,
  TextDecoder,
  TextEncoder,
});
vm.runInContext(code, context);

const port = {
  name: "webstral-chat",
  onMessage: { addListener: (fn) => (port._onMessage = fn) },
  postMessage: (m) => sent.push(m),
};
connectListeners[0](port);
await port._onMessage({
  type: "chat",
  payload: { model: "m", messages: [{ role: "user", content: "x" }] },
});

console.log("messages:", JSON.stringify(sent));
const err = sent.find((m) => m.type === "error");
const pass =
  sent.length === 1 &&
  err &&
  err.message.startsWith("Mistral API :") &&
  err.message.includes("invalid API key");
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
