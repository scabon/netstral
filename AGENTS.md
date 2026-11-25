# AGENTS.md — netstral

Browser extension (Chrome/Firefox) companion for a Mistral account: badge
with the real usage on the toolbar icon, one-click chat.mistral.ai. Source
in `extension/`.

## Core rules

1. **Privacy stance**: the extension reads billing data only from
   `console.mistral.ai` / `admin.mistral.ai` with the browser's Mistral
   session cookie. Never store an API key, never call `api.mistral.ai`,
   no analytics, no third-party backend.
2. **Cross-browser**: one manifest for Chrome/Chromium (MV3) and Firefox
   (`sidebar_action`). On Firefox MV3, host permissions are opt-in — keep
   the network-permission button in the UI.
3. **i18n**: fr + en in `extension/i18n.js`; every user-facing string in
   both languages (parity checked by `tests/i18n-smoke.mjs`).
4. All extension code lives in `extension/`.
5. **Tests**: `node tests/*-smoke.mjs` and `python tests/e2e/netstral_e2e.py`
   must stay green.
6. Add-on ID is `netstral@cabon14.com` (owned domain, unchangeable after
   first publication).

## Build & test

- Lint: `npx web-ext lint --source-dir extension`
- Firefox package: `npx web-ext build --source-dir extension --artifacts-dir dist`
- The store release/upload tooling is maintained privately by the author.
