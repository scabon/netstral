// Smoke test du service worker hors navigateur : mock chrome.* + mock fetch
// SSE dont les chunks sont découpés arbitrairement, pour valider le parsing
// du streaming, le relais des deltas + usage final, le cumul mensuel du
// compteur d'usage et le badge (texte + couleur selon les seuils).
// Usage : node tests/background-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const connectListeners = [];
const storageListeners = [];
const sent = [];
const badgeCalls = [];
const stored = {
  apiKey: "test-key",
  settings: { monthlyBudgetTokens: 100, warnPct: 70, dangerPct: 90 },
};

const chromeMock = {
  storage: {
    local: {
      get: async (k) =>
        typeof k === "string" ? { [k]: stored[k] } : Object.fromEntries(k.map((x) => [x, stored[x]])),
      set: async (obj) => Object.assign(stored, obj),
    },
    onChanged: { addListener: (fn) => storageListeners.push(fn) },
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: (fn) => connectListeners.push(fn) },
    onMessage: { addListener: () => {} },
  },
  sidePanel: { setPanelBehavior: async () => {} },
  action: {
    setBadgeText: async ({ text }) => badgeCalls.push(["text", text]),
    setBadgeBackgroundColor: async ({ color }) => badgeCalls.push(["bg", color]),
    setTitle: async () => {},
  },
  alarms: {
    onAlarm: { addListener: () => {} },
    create: () => {},
  },
};

function ssePayload(events) {
  return (
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

// découpe le payload en morceaux de tailles données (cycles sur cutSizes)
function sseChunks(payload, cutSizes) {
  const chunks = [];
  let i = 0;
  let n = 0;
  while (i < payload.length) {
    const size = cutSizes[n % cutSizes.length];
    chunks.push(payload.slice(i, i + size));
    i += size;
    n++;
  }
  return chunks.map((s) => new TextEncoder().encode(s));
}

const usageTurn = { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 };

const fetches = [];
globalThis.fetch = async (url, opts) => {
  fetches.push({ url, opts });
  const chunks = sseChunks(
    ssePayload([
      { choices: [{ delta: { content: "Bon" } }] },
      { choices: [{ delta: { content: "jour **mon" } }] },
      { choices: [{ delta: { content: "de** 42" } }] },
      { choices: [{ delta: {} }], usage: usageTurn },
    ]),
    [3, 17, 5, 40, 1]
  );
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true },
      }),
    },
  };
};

const context = vm.createContext({
  chrome: chromeMock,
  console,
  fetch: globalThis.fetch,
  TextDecoder,
  TextEncoder,
  Date,
});
vm.runInContext(code, context);

const portMock = {
  name: "webstral-chat",
  onMessage: { addListener: (fn) => (portMock._onMessage = fn) },
  postMessage: (m) => sent.push(m),
};
connectListeners[0](portMock);

async function turn() {
  await portMock._onMessage({
    type: "chat",
    payload: {
      model: "mistral-small-latest",
      messages: [{ role: "user", content: "salut" }],
    },
  });
}

await turn();
await turn();

const deltas = sent
  .filter((m) => m.type === "delta")
  .map((m) => m.content)
  .join("");
const done = sent.find((m) => m.type === "done");
const errors = sent.filter((m) => m.type === "error");
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const req = fetches[0];

console.log("URL:", req.url);
console.log("Texte reconstitué (1 tour):", JSON.stringify(deltas.slice(0, 18)));
console.log("Usage final relayer:", JSON.stringify(done?.usage));
console.log("Compteur stocké:", JSON.stringify(stored.usage?.[month]));
console.log("Appels badge:", JSON.stringify(badgeCalls));

const cur = stored.usage?.[month];
const lastText = badgeCalls.filter((c) => c[0] === "text").pop()?.[1];

const pass =
  deltas === "Bonjour **monde** 42Bonjour **monde** 42" &&
  done?.usage?.prompt_tokens === 7 &&
  errors.length === 0 &&
  req.url === "https://api.mistral.ai/v1/chat/completions" &&
  JSON.parse(req.opts.body).stream === true &&
  cur?.prompt_tokens === 14 &&
  cur?.completion_tokens === 10 &&
  cur?.total_tokens === 24 &&
  lastText === "24%" &&
  badgeCalls.some((c) => c[0] === "bg" && c[1] === "#1a7f37") &&
  !badgeCalls.some((c) => c[1] === "#f9a825") &&
  !badgeCalls.some((c) => c[1] === "#b3261e");
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
