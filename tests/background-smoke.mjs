// Smoke test du service worker hors navigateur : mock chrome.* + mock fetch
// SSE dont les chunks sont découpés arbitrairement, pour valider le parsing
// du streaming et le relais des deltas + usage final.
// Usage : node tests/background-smoke.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(
  new URL("../extension/background/background.js", import.meta.url),
  "utf8"
);

const connectListeners = [];
const sent = [];
const stored = { apiKey: "test-key" };

const chromeMock = {
  storage: {
    local: {
      get: async (k) => ({ [k]: stored[k] }),
      set: async (obj) => Object.assign(stored, obj),
    },
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onConnect: { addListener: (fn) => connectListeners.push(fn) },
    onMessage: { addListener: () => {} },
  },
  sidePanel: { setPanelBehavior: async () => {} },
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

const fetches = [];
globalThis.fetch = async (url, opts) => {
  fetches.push({ url, opts });
  const chunks = sseChunks(
    ssePayload([
      { choices: [{ delta: { content: "Bon" } }] },
      { choices: [{ delta: { content: "jour **mon" } }] },
      { choices: [{ delta: { content: "de** 42" } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 7, completion_tokens: 5 } },
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
});
vm.runInContext(code, context);

const portMock = {
  name: "webstral-chat",
  onMessage: { addListener: (fn) => (portMock._onMessage = fn) },
  postMessage: (m) => sent.push(m),
};
connectListeners[0](portMock);

await portMock._onMessage({
  type: "chat",
  payload: {
    model: "mistral-small-latest",
    messages: [{ role: "user", content: "salut" }],
  },
});

const deltas = sent
  .filter((m) => m.type === "delta")
  .map((m) => m.content)
  .join("");
const done = sent.find((m) => m.type === "done");
const errors = sent.filter((m) => m.type === "error");
const req = fetches[0];

console.log("URL:", req.url);
console.log("Texte reconstitué:", JSON.stringify(deltas));
console.log("Usage final:", JSON.stringify(done?.usage));

const pass =
  deltas === "Bonjour **monde** 42" &&
  done?.usage?.prompt_tokens === 7 &&
  errors.length === 0 &&
  req.url === "https://api.mistral.ai/v1/chat/completions" &&
  JSON.parse(req.opts.body).stream === true;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
